// npm run build && npm run test:ux
// Uses installed Edge and simulated IPC: never runs the Windows cleaner.
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { chromium } = require('playwright');

(async () => {
  const { preview } = await import('vite');
  const server = await preview({ preview: { host: '127.0.0.1', port: 1421, strictPort: true, open: false } });
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'fr-FR', reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      const item = id => ({ id, bytes: 1024 * 1024, paths: [`C:/Mock/${id}`] });
      window.applyCalls = 0;
      window.installCalls = [];
      window.mock = { latest: '1.0.10000', installed: '1.0.9200', absent: false, checkError: '', installError: '' };
      const callbacks = new Map();
      let callbackId = 0;
      let progress;
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
      window.__TAURI_INTERNALS__ = {
        transformCallback(fn) { callbacks.set(++callbackId, fn); return callbackId; },
        invoke: async (cmd, args) => {
          if (cmd === 'scan') return {
            root: window.mock.installed ? 'C:/Users/Example/AppData/Local/Discord' : null, running: !!window.mock.installed,
            versions: window.mock.installed ? [`app-${window.mock.installed}`] : [], latest_exe: window.mock.installed ? `C:/Mock/app-${window.mock.installed}/Discord.exe` : null,
            service: 'running', helper_exes: ['C:/Mock/helper.exe'],
            run_entries: [{ hive: 'HKCU', name: 'Discord', value: 'C:/Mock/Update.exe' }],
            updater: window.mock.absent || !window.mock.installed ? { id: 'updater', bytes: 0, paths: [] } : item('updater'),
            modules: window.mock.absent || !window.mock.installed ? [] : ['discord_desktop_core', 'discord_voice', 'discord_krisp', 'discord_overlay2', 'discord_media'].map(item),
            locales: window.mock.installed ? ['en-US', 'fr', 'de', 'es'].map(item) : [], extras: window.mock.installed ? [item('debug_log')] : [],
          };
          if (cmd === 'plugin:app|version') return '0.1.0';
          if (cmd === 'check_discord_update') {
            if (window.mock.checkError) throw new Error(window.mock.checkError);
            return { latest: window.mock.latest };
          }
          if (cmd === 'plugin:event|listen') { progress = callbacks.get(args.handler); return 1; }
          if (cmd === 'plugin:event|unlisten') return;
          if (cmd === 'install_discord') {
            window.installCalls.push(structuredClone(args));
            await new Promise(resolve => setTimeout(resolve, 100));
            if (window.mock.installError) throw new Error(window.mock.installError);
            for (const step of ['download', 'signature', 'install', 'module:discord_overlay2', 'locale:de']) {
              progress({ payload: { step, status: 'ok', detail: '' } });
            }
            window.mock.installed = args.expectedVersion;
            return { freed: 1024, warnings: [] };
          }
          if (cmd === 'apply') window.applyCalls++;
          throw new Error(`Unexpected IPC: ${cmd}`);
        },
      };
    });
    await page.goto('http://127.0.0.1:1421');
    await page.getByRole('heading', { name: 'Une nouvelle version est disponible' }).waitFor();
    assert.equal(await page.locator('[data-page="dashboard"][aria-current="page"]').count(), 1);
    assert.equal(await page.locator('#review-button').count(), 0);
    await page.screenshot({ path: join(tmpdir(), 'discord-cleaner-ux-dashboard.png') });
    for (const width of [800, 390]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await page.locator('#app').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    }
    await page.screenshot({ path: join(tmpdir(), 'discord-cleaner-ux-dashboard-narrow.png') });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('[data-page="cleaner"]').first().click();
    await page.locator('#review-button').waitFor();
    assert.equal(await page.locator('[data-key="modules"]').getAttribute('open'), null);
    // Opening and changing an option in one event loop turn must not lose the open state.
    assert.equal(await page.evaluate(() => {
      document.querySelector('[data-key="modules"]').open = true;
      document.querySelector('[data-module="discord_overlay2"]').click();
      return document.querySelector('[data-key="modules"]').open;
    }), true);
    await page.locator('[data-preset="balanced"]').click();
    const krisp = page.getByRole('checkbox', { name: 'Suppression de bruit Krisp', exact: true });
    await krisp.focus();
    await page.keyboard.press('Space');
    assert.equal(await krisp.isChecked(), false);
    assert.equal(await krisp.evaluate(el => el === document.activeElement), true);
    assert.equal(await page.locator('[data-preset="custom"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('[data-key="modules"]').evaluate(el => el.open), true);
    await page.locator('[data-preset="aggressive"]').click();
    assert.equal(await page.locator('[data-opt="shortcut"]').isDisabled(), true);
    assert.equal(await page.locator('[data-opt="shortcut"]').isChecked(), true);
    await page.locator('#review-button').click();
    assert.equal(await page.getByRole('dialog', { name: 'Vérifiez avant de nettoyer' }).isVisible(), true);
    assert.equal(await page.locator('#review .note').count(), 1);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#review-button').evaluate(el => el === document.activeElement), true);
    await page.locator('[data-preset="balanced"]').click();
    await page.locator('[data-key="modules"] > summary').click();
    await page.locator('#app').evaluate(el => el.scrollTop = 0);
    await page.screenshot({ path: join(tmpdir(), 'discord-cleaner-ux-desktop.png') });
    for (const width of [1100, 800, 600, 390]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Overflow at ${width}px`);
      assert.equal(await page.locator('#app').evaluate(el => el.scrollWidth <= el.clientWidth), true, `Content overflow at ${width}px`);
      const button = await page.locator('#review-button').boundingBox();
      assert.ok(button && button.y >= 0 && button.y + button.height <= 900, `Footer outside viewport at ${width}px`);
    }
    await page.screenshot({ path: join(tmpdir(), 'discord-cleaner-ux-narrow.png') });
    await page.locator('[data-page="settings"]').click();
    await page.locator('[data-lang="en"]').click();
    await page.locator('[data-page="cleaner"]').click();
    assert.equal(await page.getByRole('button', { name: 'Review selection' }).isVisible(), true);
    assert.equal(await page.evaluate(() => window.applyCalls), 0);

    // Keep custom choices even after the selected files disappeared in a previous cleanup.
    await page.locator('[data-preset="aggressive"]').click();
    await page.locator('[data-key="modules"] > summary').click();
    await page.locator('[data-module="discord_krisp"]').uncheck();
    await page.reload();
    await page.getByRole('heading', { name: 'A new version is available' }).waitFor();
    await page.evaluate(() => { window.mock.absent = true; });
    await page.locator('[data-page="dashboard"]').click();
    await page.locator('[data-action="rescan"]').click();
    await page.locator('#install-discord').waitFor();
    await page.locator('[data-page="cleaner"]').first().click();
    assert.equal(await page.locator('[data-opt="updater"]').isChecked(), true);
    assert.equal(await page.locator('[data-opt="updater"]').isEnabled(), true);
    assert.equal(await page.locator('[data-module="discord_krisp"]').isChecked(), false);
    assert.equal(await page.locator('[data-module="discord_overlay2"]').isChecked(), true);
    await page.locator('[data-page="dashboard"]').click();
    await page.locator('#install-discord').click();
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => window.installCalls.length), 0);
    await page.locator('#install-discord').click();
    await page.locator('[data-action="confirm"]').click();
    await page.getByRole('heading', { name: 'Installation and optimizations complete' }).waitFor();
    const installation = await page.evaluate(() => window.installCalls[0]);
    assert.equal(installation.expectedVersion, '1.0.10000');
    assert.equal(installation.plan.updater, true);
    assert.equal(installation.plan.modules.includes('discord_krisp'), false);
    assert.equal(installation.plan.modules.includes('discord_overlay2'), true);
    assert.equal(installation.plan.keep_locales.includes('en-US'), true);
    assert.equal(installation.plan.keep_locales.includes('fr'), true);
    await page.locator('[data-page="dashboard"]').click();
    await page.getByRole('heading', { name: "Discord's application version is up to date" }).waitFor();

    // Offline, malformed feeds and older remote versions cannot initiate an update.
    await page.evaluate(() => { window.mock.checkError = 'Offline'; });
    await page.locator('#check-update').click();
    await page.getByRole('alert').filter({ hasText: 'Offline' }).waitFor();
    assert.equal(await page.locator('#install-discord').isDisabled(), true);
    await page.evaluate(() => { window.mock.checkError = ''; window.mock.latest = 'invalid'; });
    await page.locator('#check-update').click();
    await page.getByRole('alert').filter({ hasText: 'Invalid version' }).waitFor();
    assert.equal(await page.locator('#install-discord').isDisabled(), true);
    await page.evaluate(() => { window.mock.latest = '1.0.9999'; });
    await page.locator('#check-update').click();
    await page.getByRole('heading', { name: 'Your installed version is newer than the feed' }).waitFor();
    assert.equal(await page.locator('#install-discord').isDisabled(), true);

    // First installation works without an existing Discord folder; failures stay explicit.
    await page.evaluate(() => { window.mock.installed = null; window.mock.latest = '1.0.10000'; window.mock.installError = 'Signature rejected'; });
    await page.locator('[data-action="rescan"]').click();
    await page.locator('#check-update').click();
    await page.getByRole('heading', { name: 'Ready to install Discord' }).waitFor();
    await page.locator('[data-page="cleaner"]').first().click();
    assert.equal(await page.getByRole('button', { name: 'Go to installation' }).isVisible(), true);
    await page.getByRole('button', { name: 'Go to installation' }).click();
    await page.locator('#install-discord').click();
    await page.locator('[data-action="confirm"]').click();
    await page.getByRole('alert').filter({ hasText: 'Signature rejected' }).waitFor();
    assert.equal(await page.evaluate(() => window.applyCalls), 0, 'No separate cleanup after an installation failure');
    assert.deepEqual(errors, []);
    console.log('UX checks passed: dashboard, version checks, offline/errors, installation confirmation, persistent profile, progress, keyboard, FR/EN and responsive layout.');
    console.log(`Screenshots: ${join(tmpdir(), 'discord-cleaner-ux-{desktop,narrow}.png')}`);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.httpServer.close(resolve));
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
