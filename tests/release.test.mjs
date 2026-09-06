import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { nextVersion, prepare, publish } from '../.github/scripts/release.mjs';

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
