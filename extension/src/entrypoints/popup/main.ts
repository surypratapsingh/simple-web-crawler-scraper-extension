const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

type AuditEntry = { t: number; method: string; host: string; ok: boolean; code?: string };
interface Stored {
  enabled?: boolean;
  port?: number;
  token?: string;
  blocklist?: string[];
  audit?: AuditEntry[];
}

const portEl = $<HTMLInputElement>('port');
const tokenEl = $<HTMLInputElement>('token');
const blocklistEl = $<HTMLTextAreaElement>('blocklist');
const enabledEl = $<HTMLInputElement>('enabled');

/** True while the user is actively editing this field, so a storage update (ours or a sync from
 * elsewhere) never clobbers what they're typing mid-edit. */
const editing = () => document.activeElement === portEl || document.activeElement === tokenEl || document.activeElement === blocklistEl;

function renderSettings(s: Stored) {
  enabledEl.checked = s.enabled !== false;
  if (editing()) return;
  portEl.value = String(s.port ?? 8765);
  tokenEl.value = s.token ?? '';
  blocklistEl.value = (s.blocklist ?? []).join('\n');
}

function renderAudit(log: AuditEntry[] = []) {
  const ul = $('audit');
  ul.textContent = '';
  const recent = log.slice(-15).reverse();
  if (!recent.length) {
    ul.innerHTML = '<li class="empty">(none yet)</li>';
    return;
  }
  for (const e of recent) {
    const li = document.createElement('li');
    li.className = e.ok ? '' : 'bad';
    const time = document.createElement('span');
    time.className = 't';
    time.textContent = new Date(e.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const rest = document.createElement('span');
    rest.textContent = `${e.method}${e.host ? ' ' + e.host : ''}${e.ok ? '' : ' ✗ ' + (e.code ?? '')}`;
    li.append(time, rest);
    ul.append(li);
  }
}

async function refreshStatus() {
  try {
    const r = (await browser.runtime.sendMessage({ type: 'ui:status' })) as { connected: boolean } | undefined;
    $('dot').classList.toggle('on', !!r?.connected);
    $('status').innerHTML = r?.connected
      ? 'Connected to MCP server'
      : 'Waiting for MCP server<small>Start Claude with the scrapeline MCP configured</small>';
  } catch {
    $('status').textContent = 'Extension worker unavailable — try reloading the extension';
  }
}

async function loadAll() {
  const s = (await browser.storage.local.get(['enabled', 'port', 'token', 'blocklist', 'audit'])) as Stored;
  renderSettings(s);
  renderAudit(s.audit);
}

enabledEl.addEventListener('change', () => browser.storage.local.set({ enabled: enabledEl.checked }));

$('save').addEventListener('click', async () => {
  await browser.storage.local.set({
    port: Number(portEl.value) || 8765,
    token: tokenEl.value.trim(),
    blocklist: blocklistEl.value
      .split('\n')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  });
  const flash = $('saved');
  flash.classList.add('show');
  setTimeout(() => flash.classList.remove('show'), 1400);
  await refreshStatus();
});

// React to storage changes (ours, or the background worker's, e.g. a fresh audit entry) instead of
// polling and overwriting the form on a timer — that was clobbering whatever the user was typing.
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.enabled || changes.port || changes.token || changes.blocklist) {
    void loadAll();
  } else if (changes.audit) {
    renderAudit(changes.audit.newValue as AuditEntry[] | undefined);
  }
});

void loadAll();
void refreshStatus();
// Connection status has no text input to clobber, so a light poll is fine (and catches a
// reconnect the background worker made on its own, with no storage write to trigger the listener).
setInterval(() => void refreshStatus(), 3000);
