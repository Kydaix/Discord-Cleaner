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
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'fr-FR' });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      const item = id => ({ id, bytes: 1024 * 1024, paths: [`C:/Mock/${id}`] });
      window.applyCalls = 0;
      window.__TAURI_INTERNALS__ = {
        invoke: async cmd => {
          if (cmd === 'scan') return {
            root: 'C:/Users/Example/AppData/Local/Discord', running: true,
            versions: ['app-1.0.9200'], latest_exe: 'C:/Mock/Discord.exe',
            service: 'running', helper_exes: ['C:/Mock/helper.exe'],
            run_entries: [{ hive: 'HKCU', name: 'Discord', value: 'C:/Mock/Update.exe' }],
            updater: item('updater'),
            modules: ['discord_desktop_core', 'discord_voice', 'discord_krisp', 'discord_overlay2', 'discord_media'].map(item),
            locales: ['en-US', 'fr', 'de', 'es'].map(item), extras: [item('debug_log')],
          };
          if (cmd === 'plugin:app|version') return '0.1.0';
          if (cmd === 'apply') window.applyCalls++;
          throw new Error(`Unexpected IPC: ${cmd}`);
        },
      };
    });
    await page.goto('http://127.0.0.1:1421');
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
    assert.deepEqual(errors, []);
    console.log('UX checks passed: keyboard focus, module disclosure, profiles, updater warning, confirmation, FR/EN, responsive layout.');
    console.log(`Screenshots: ${join(tmpdir(), 'discord-cleaner-ux-{desktop,narrow}.png')}`);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.httpServer.close(resolve));
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
