import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const semver = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const asset = 'DiscordCleaner.exe';
const command = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const lines = text => text.split(/\r?\n/).filter(Boolean);

export function nextVersion(tag, log) {
  if (!tag) return '0.1.0';
  const parts = semver.exec(tag);
  if (!parts) throw new Error(`Invalid version tag: ${tag}`);
  const [major, minor, patch] = parts.slice(1).map(BigInt);
  if (/^[a-z]+(?:\(.+\))?!:|^BREAKING[ -]CHANGE:/m.test(log)) return `${major + 1n}.0.0`;
  if (/^feat(?:\(.+\))?:/m.test(log)) return `${major}.${minor + 1n}.0`;
  return `${major}.${minor}.${patch + 1n}`;
}

function release(repo, tag, run) {
  try {
    return JSON.parse(run('gh', ['api', `repos/${repo}/releases/tags/${tag}`]));
  } catch (error) {
    if (String(error.stderr).includes('(HTTP 404)')) return null;
    throw error;
  }
}

function complete(value) {
  // Existing releases predate the checksum file; their uploaded executable is sufficient.
  return value && !value.draft && value.assets.some(a => a.name === asset && a.state === 'uploaded' && a.size > 0);
}

function checkTarget(env, tag, existing, run) {
  if (env.GITHUB_REF !== 'refs/heads/main') throw new Error('Releases are restricted to main.');
  if (!semver.test(tag)) throw new Error(`Invalid version tag: ${tag}`);
  const target = run('git', ['tag', '--list', tag])
    ? run('git', ['rev-parse', `${tag}^{commit}`]) : existing?.target_commitish;
  if (target && target !== env.GITHUB_SHA) {
    throw new Error(`${tag} already points to a different commit.`);
  }
}

export function prepare(env, run = command) {
  if (env.GITHUB_EVENT_NAME === 'pull_request') return { version: '0.0.0', build: true };
  const tags = lines(run('git', ['tag', '--points-at', 'HEAD', '--list', 'v*'])).filter(tag => semver.test(tag));
  if (tags.length > 1) throw new Error('Multiple release tags point at HEAD.');
  const last = lines(run('git', ['tag', '--merged', 'HEAD', '--list', 'v*', '--sort=-version:refname'])).find(tag => semver.test(tag));
  const version = tags[0]?.slice(1) ?? nextVersion(last, last ? run('git', ['log', '--format=%s%n%b', `${last}..HEAD`]) : '');
  const tag = `v${version}`;
  const existing = release(env.GITHUB_REPOSITORY, tag, run);
  checkTarget(env, tag, existing, run);
  return { version, build: !complete(existing) };
}

export function publish(env, run = command) {
  const tag = `v${env.RELEASE_VERSION}`;
  const repo = env.GITHUB_REPOSITORY;
  const existing = release(repo, tag, run);
  checkTarget(env, tag, existing, run);
  if (complete(existing)) return;

  const digest = createHash('sha256').update(readFileSync(asset)).digest('hex');
  if (readFileSync(`${asset}.sha256`, 'utf8').trim() !== `${digest} *${asset}`) {
    throw new Error('Release executable does not match its SHA-256 checksum.');
  }
  if (!existing) {
    run('gh', ['release', 'create', tag, '--repo', repo, '--target', env.GITHUB_SHA,
      '--title', `Discord Cleaner ${tag}`, '--generate-notes', '--draft']);
  }
  run('gh', ['release', 'upload', tag, asset, `${asset}.sha256`, '--repo', repo, '--clobber']);
  run('gh', ['release', 'edit', tag, '--repo', repo, '--draft=false']);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv[2] === 'prepare') {
      const result = prepare(process.env);
      appendFileSync(process.env.GITHUB_OUTPUT, `version=${result.version}\nbuild=${result.build}\n`);
      console.log(result.build ? `Build v${result.version}` : `v${result.version} is already published with its executable.`);
    } else if (process.argv[2] === 'publish') {
      publish(process.env);
    } else {
      throw new Error('Expected prepare or publish.');
    }
  } catch (error) {
    console.error(error.stderr?.toString() || error.message);
    process.exitCode = 1;
  }
}
