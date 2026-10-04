// web/static/lib/trash.js
// "Recently deleted", at the bottom of the takes list: what's in the Pi's
// trash, with Restore on each, Delete forever, and Empty. Deleted and pruned
// takes wait here for a week, or until the disk runs low.

const fmtLen = (s) => {
  if (!isFinite(s) || s <= 0) return '0:00';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s % 60) % 60).padStart(2, '0')}`;
};

/** ago says how long ago t was, coarsely: "just now", "5 min", "3 h", "2 days". */
export function ago(t, now = Date.now()) {
  const s = Math.max(0, (now - new Date(t).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

/** stampOf is what an unnamed take is called: its timestamp. */
const stampOf = (name) => name.replace(/^jam_|\.wav$/g, '');

export async function restoreTake(name) {
  const res = await fetch(`/api/trash/restore?file=${encodeURIComponent(name)}`, { method: 'POST' });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(b.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export class TrashList {
  /**
   * root: the <details> section; it holds .trash-count, .trash-list,
   * .trash-keep and .trash-empty. onRestored(name) runs after a restore;
   * onConfirm(title, name) resolves true to go ahead with a permanent delete.
   */
  constructor(root, { onToast, onRestored, onConfirm }) {
    this.root = root;
    this.list = root.querySelector('.trash-list');
    this.count = root.querySelector('.trash-count');
    this.keep = root.querySelector('.trash-keep');
    this.onToast = onToast;
    this.onRestored = onRestored;
    this.onConfirm = onConfirm;
    this.busy = false;
    root.querySelector('.trash-empty').addEventListener('click', () => this.emptyAll());
  }

  async refresh() {
    let body;
    try {
      const res = await fetch('/api/trash', { cache: 'no-store' });
      if (!res.ok) return;
      body = await res.json();
    } catch { return; }
    this.render(body.takes || [], body.keep_days || 7);
  }

  render(takes, keepDays) {
    this.root.hidden = takes.length === 0;
    this.count.textContent = takes.length ? `(${takes.length})` : '';
    this.keep.textContent = `Kept ${keepDays} days, or until the disk runs low.`;
    this.list.replaceChildren(...takes.map((t) => this.row(t)));
  }

  row(t) {
    const li = document.createElement('li');
    li.className = 'trash-row';
    const name = document.createElement('span');
    name.className = `trash-name${t.label ? '' : ' unlabelled'}`;
    name.textContent = t.label || stampOf(t.name);
    const meta = document.createElement('span');
    meta.className = 'trash-meta';
    meta.textContent = `${fmtLen(t.duration_seconds)} · ${t.reason === 'pruned' ? 'pruned' : 'deleted'} ${ago(t.deleted_at)}`;
    const text = document.createElement('span');
    text.className = 'trash-text';
    text.append(name, meta);
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'icon-btn';
    restore.textContent = 'Restore';
    restore.dataset.tip = 'restore';
    restore.addEventListener('click', () => this.restore(t, restore));
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'icon-btn danger';
    del.textContent = '×';
    del.setAttribute('aria-label', 'Delete forever');
    del.dataset.tip = 'delete-forever';
    del.addEventListener('click', () => this.purge(t));
    li.append(text, restore, del);
    return li;
  }

  async restore(t, btn) {
    if (btn) btn.disabled = true;
    try {
      await restoreTake(t.name);
      this.onToast?.(`Restored ${t.label || stampOf(t.name)}, starred`);
      await this.onRestored?.(t.name);
    } catch (e) {
      this.onToast?.(`Could not restore: ${e.message}`, 'bad');
    }
    await this.refresh();
  }

  async purge(t) {
    const ok = await this.onConfirm?.('Delete this take for good?', t.label || stampOf(t.name));
    if (!ok) return;
    try {
      const res = await fetch(`/api/trash?file=${encodeURIComponent(t.name)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      this.onToast?.(`Could not delete: ${e.message}`, 'bad');
    }
    await this.refresh();
  }

  async emptyAll() {
    const n = this.list.children.length;
    const ok = await this.onConfirm?.('Empty the trash?', `${n} take${n === 1 ? '' : 's'} will be gone for good.`);
    if (!ok) return;
    try {
      const res = await fetch('/api/trash?all=1', { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      this.onToast?.(`Could not empty the trash: ${e.message}`, 'bad');
    }
    await this.refresh();
  }
}
