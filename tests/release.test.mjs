import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { cleanup, nextVersion, prepare, publish } from '../.github/scripts/release.mjs';

test('cleanup protects the latest release, tags, drafts and active or newer runs', () => {
  const env = { GITHUB_REF: 'refs/heads/main', GITHUB_REPOSITORY: 'test/repo', GITHUB_SHA: 'abc', GITHUB_RUN_ID: '200', RELEASE_VERSION: '1.2.4' };
  const current = { id: 20, draft: false, published_at: '2026-09-06T12:00:00Z', assets: [{ name: 'DiscordCleaner.exe', state: 'uploaded', size: 100 }] };
  let latest = 20;
  let sha = 'abc';
  let failDelete = false;
  const deleted = [];
  let lists = 0;
  const jsonLines = values => values.map(value => JSON.stringify(value)).join('\n');
  const run = (cmd, args) => {
    if (cmd === 'git' && args[0] === 'tag') return 'v1.2.4';
    if (cmd === 'git' && args[0] === 'rev-parse') return 'abc';
    assert.equal(cmd, 'gh');
    assert.equal(args[0], 'api');
    if (args[1] === '--method') {
      assert.equal(args[2], 'DELETE');
      assert.equal(lists, 2, 'Both paginated lists must be collected before deleting');
      if (failDelete) throw new Error('Forbidden');
      deleted.push(args[3]);
      return '';
    }
    const path = args[1].replace('repos/test/repo/', '');
    if (path === 'releases/tags/v1.2.4') return JSON.stringify(current);
    if (path === 'releases/latest') return JSON.stringify({ id: latest });
    if (path === 'actions/runs/200') return JSON.stringify({ id: 200, head_sha: sha, created_at: '2026-09-06T11:00:00Z' });
    assert.ok(args.includes('--paginate'));
    assert.ok(args.includes('--jq'));
    lists++;
    if (path === 'releases?per_page=100') return jsonLines([
      current, { id: 19, draft: false, published_at: '2026-09-05T12:00:00Z' },
      { id: 18, draft: true, published_at: null }, { id: 21, draft: false, published_at: '2026-09-07T12:00:00Z' },
    ]);
    assert.equal(path, 'actions/runs?per_page=100');
    return jsonLines([
      { id: 199, status: 'completed', created_at: '2026-09-05T12:00:00Z' },
      { id: 198, status: 'in_progress', created_at: '2026-09-05T12:00:00Z' },
      { id: 197, status: 'queued', created_at: '2026-09-05T12:00:00Z' },
      { id: 200, status: 'completed', created_at: '2026-09-06T11:00:00Z' },
      { id: 201, status: 'completed', created_at: '2026-09-06T13:00:00Z' },
    ]);
  };
  cleanup(env, run);
  assert.deepEqual(deleted, ['repos/test/repo/releases/19', 'repos/test/repo/actions/runs/199']);
  deleted.length = 0;
  lists = 0;
  latest = 21;
  cleanup(env, run);
  assert.equal(lists, 0);
  latest = 20;
  current.draft = true;
  assert.throws(() => cleanup(env, run), /published release/);
  current.draft = false;
  current.assets = [];
  assert.throws(() => cleanup(env, run), /published release/);
  current.assets = [{ name: 'DiscordCleaner.exe', state: 'uploaded', size: 100 }];
  assert.throws(() => cleanup({ ...env, GITHUB_REF: 'refs/heads/topic' }, run), /restricted to main/);
  sha = 'different';
  assert.throws(() => cleanup(env, run), /does not match/);
  sha = 'abc';
  failDelete = true;
  assert.throws(() => cleanup(env, run), /Forbidden/);
  assert.deepEqual(deleted, []);
});

test('versioning and recovery after a release upload fails', () => {
  assert.equal(nextVersion(null, ''), '0.1.0');
  assert.equal(nextVersion('v1.2.3', 'fix: cleanup'), '1.2.4');
  assert.equal(nextVersion('v1.2.3', 'feat(ui): profiles'), '1.3.0');
  assert.equal(nextVersion('v1.2.3', 'feat!: remove a feature'), '2.0.0');
  assert.equal(nextVersion('v1.2.3', 'fix: change\n\nBREAKING CHANGE: migration required'), '2.0.0');
  assert.equal(nextVersion('v1.2.3', 'fix: change\n\nBREAKING-CHANGE: migration required'), '2.0.0');
  assert.throws(() => nextVersion('v1.2.3-beta', ''), /Invalid version/);

  const env = { GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main', GITHUB_REPOSITORY: 'test/repo', GITHUB_SHA: 'abc', RELEASE_VERSION: '1.2.4' };
  let value = null;
  let tag = '';
  let failUpload = true;
  const run = (cmd, args) => {
    if (cmd === 'git') {
      if (args.includes('--points-at')) return tag;
      if (args.includes('--merged')) return 'v1.2.3';
      if (args[0] === 'log') return 'fix: cleanup';
      if (args[0] === 'rev-parse') return 'abc';
      if (args.includes('--list')) return tag;
    }
    if (cmd === 'gh') {
      if (args[0] === 'api') {
        if (!value) throw Object.assign(new Error('Not found'), { stderr: 'gh: Not Found (HTTP 404)' });
        return JSON.stringify(value);
      }
      if (args[1] === 'create') { tag = args[2]; value = { draft: true, target_commitish: 'abc', assets: [] }; return ''; }
      if (args[1] === 'upload') {
        if (failUpload) throw new Error('Upload interrupted');
        value.assets = [{ name: 'DiscordCleaner.exe', state: 'uploaded', size: 100 }];
        return '';
      }
      if (args[1] === 'edit') { value.draft = false; return ''; }
    }
    throw new Error(`Unexpected command: ${cmd} ${args.join(' ')}`);
  };

  assert.deepEqual(prepare(env, run), { version: '1.2.4', build: true });
  assert.deepEqual(prepare({ ...env, GITHUB_EVENT_NAME: 'pull_request' }, () => assert.fail('PR must not query releases')), { version: '0.0.0', build: true });
  assert.throws(() => prepare({ ...env, GITHUB_REF: 'refs/heads/topic' }, run), /restricted to main/);
  assert.throws(() => prepare(env, (cmd, args) => {
    if (cmd === 'gh') throw Object.assign(new Error('Forbidden'), { stderr: 'gh: Forbidden (HTTP 403)' });
    return run(cmd, args);
  }), /Forbidden/);

  const original = process.cwd();
  const directory = mkdtempSync(join(tmpdir(), 'discord-cleaner-release-test-'));
  try {
    process.chdir(directory);
    writeFileSync('DiscordCleaner.exe', 'test artifact, never executed');
    writeFileSync('DiscordCleaner.exe.sha256', 'invalid');
    assert.throws(() => publish(env, run), /checksum/);
    assert.equal(value, null);
    const digest = createHash('sha256').update('test artifact, never executed').digest('hex');
    writeFileSync('DiscordCleaner.exe.sha256', `${digest} *DiscordCleaner.exe\n`);
    assert.throws(() => publish(env, run), /Upload interrupted/);
    assert.equal(value.draft, true);
    assert.deepEqual(prepare(env, run), { version: '1.2.4', build: true });
    // A draft can exist before GitHub creates its tag. Never attach another commit's binary to it.
    tag = '';
    assert.deepEqual(prepare(env, run), { version: '1.2.4', build: true });
    assert.throws(() => prepare({ ...env, GITHUB_SHA: 'different' }, run), /different commit/);
    tag = 'v1.2.4';
    failUpload = false;
    publish(env, run);
    assert.equal(value.draft, false);
    assert.deepEqual(prepare(env, run), { version: '1.2.4', build: false });
    publish(env, (cmd, args) => {
      assert.notEqual(args[0], 'release', 'A complete release must not be overwritten');
      return run(cmd, args);
    });
    value.assets = [];
    assert.deepEqual(prepare(env, run), { version: '1.2.4', build: true });
    publish(env, run);
    assert.deepEqual(prepare(env, run), { version: '1.2.4', build: false });
    assert.throws(() => prepare({ ...env, GITHUB_SHA: 'different' }, run), /different commit/);
  } finally {
    process.chdir(original);
    rmSync(directory, { recursive: true });
  }
});
