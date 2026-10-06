import { expect, test } from '@playwright/test';
import { call, down, env, up } from './harness';

test.beforeAll(up);
test.afterAll(down);

function extensionId(): string {
  return new URL(env.sw.url()).host;
}

test('shows connected once the bridge is up, and the token field round-trips a save', async () => {
  const p = await env.context.newPage();
  await p.goto(`chrome-extension://${extensionId()}/popup.html`);

  await expect(p.locator('#dot')).toHaveClass(/\bon\b/, { timeout: 10_000 });
  await expect(p.locator('#status')).toContainText('Connected to MCP server');
  await p.locator('summary').click();
  await p.locator('#token').fill('secret-123');
  await p.locator('#save').click();
  await expect(p.locator('#saved')).toHaveClass(/\bshow\b/);

  const stored = await env.sw.evaluate(() => chrome.storage.local.get('token'));
  expect(stored.token).toBe('secret-123');
  await setToken(''); // leave settings clean for later specs/tests
  await p.close();
});

test('regression: typing in a settings field is never clobbered by a background storage update', async () => {
  const p = await env.context.newPage();
  await p.goto(`chrome-extension://${extensionId()}/popup.html`);
  await p.locator('summary').click();

  const token = p.locator('#token');
  await token.click();
  await token.type('typing-while-'); // partial, still focused — simulates a slow typist
  // A storage write from elsewhere (e.g. the background worker logging an audit entry) must not
  // touch a focused field: this is exactly what the popup used to clobber every 2s.
  await env.sw.evaluate(() => chrome.storage.local.set({ audit: [{ t: Date.now(), method: 'page_info', host: 'example.com', ok: true }] }));
  await new Promise((r) => setTimeout(r, 400));
  await token.type('editing');
  await expect(token).toHaveValue('typing-while-editing');

  await token.blur(); // once focus leaves, it's fine to sync from storage again
  await env.sw.evaluate(() => chrome.storage.local.set({ token: 'synced-elsewhere' }));
  await expect(token).toHaveValue('synced-elsewhere', { timeout: 3000 });

  await setToken('');
  await p.close();
});

test('a new audit entry appears in the list without any user interaction (no polling needed)', async () => {
  const p = await env.context.newPage();
  await p.goto(`chrome-extension://${extensionId()}/popup.html`);
  await expect(p.locator('#audit li.empty, #audit li')).toHaveCount(1); // whatever's there already (empty or from earlier tests)

  await env.sw.evaluate(() =>
    chrome.storage.local.set({ audit: [{ t: Date.now(), method: 'page_extract', host: 'shop.example.com', ok: true }] }),
  );
  await expect(p.locator('#audit li')).toContainText('page_extract shop.example.com');

  await env.sw.evaluate(() =>
    chrome.storage.local.set({
      audit: [
        { t: Date.now(), method: 'page_extract', host: 'shop.example.com', ok: true },
        { t: Date.now(), method: 'page_info', host: 'blocked.example.com', ok: false, code: 'BLOCKED' },
      ],
    }),
  );
  const failed = p.locator('#audit li.bad');
  await expect(failed).toContainText('BLOCKED');
  await p.close();
});

test('the kill switch toggles immediately and survives a reopen', async () => {
  const p1 = await env.context.newPage();
  await p1.goto(`chrome-extension://${extensionId()}/popup.html`);
  await expect(p1.locator('#enabled')).toBeChecked();
  await p1.locator('.switch-row label').click(); // clicking the label toggles the associated checkbox
  await expect(p1.locator('#enabled')).not.toBeChecked();
  await p1.close();

  const p2 = await env.context.newPage();
  await p2.goto(`chrome-extension://${extensionId()}/popup.html`);
  await expect(p2.locator('#enabled')).not.toBeChecked();
  await p2.locator('.switch-row label').click();
  await expect(p2.locator('#enabled')).toBeChecked(); // restored for the rest of the suite
  await p2.close();
});

async function setToken(value: string) {
  await env.sw.evaluate((v) => chrome.storage.local.set({ token: v }), value);
}
