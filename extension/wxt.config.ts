import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'Scrapeline — eyes for Claude',
    description:
      'Local-first scraper that gives Claude (via MCP) cheap, token-efficient eyes on the pages you have open.',
    permissions: ['scripting', 'tabs', 'storage', 'alarms'],
    // Local dev build: broad access, gated by the popup kill switch + audit log.
    // The store build should switch to activeTab + optional_host_permissions.
    host_permissions: ['<all_urls>'],
    action: { default_title: 'Scrapeline' },
  },
});
