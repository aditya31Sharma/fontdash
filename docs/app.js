// The dashboard. Runs from github.io or from the local agent - the only
// difference is where the API lives.

import { describe } from './fontlib.js';

const LOCAL = location.hostname === '127.0.0.1' || location.hostname === 'localhost';
const AGENT = LOCAL ? '' : 'http://127.0.0.1:8777';
const START_CMD =
  'git clone https://github.com/aditya31Sharma/fontdash.git ~/fontdash 2>/dev/null; python3 ~/fontdash/fontdash.py --agent';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const short = p => String(p).replace(/^\/Users\/[^/]+/, '~');
const fmt = n => Number(n).toLocaleString();

let DATA = null, picked = new Set(), retryTimer = null;

async function api(path, opts) {
  const r = await fetch(AGENT + path, opts);
  if (!r.ok) throw new Error('agent returned ' + r.status);
  return r.json();
}

// ---------- connect ----------

async function connect({ quiet = false } = {}) {
  if (!quiet) $('#stage').innerHTML = `<div class="card"><p class="muted">Looking for the helper…</p></div>`;
  try {
    const ping = await api('/api/ping');
    clearInterval(retryTimer); retryTimer = null;
    $('#status').innerHTML = `<span class="dot ok"></span>connected · ${esc(short(ping.install_dir))}`;
    return scan();
  } catch (err) {
    $('#status').innerHTML = `<span class="dot"></span>helper not running`;
    setup(err);
    if (!retryTimer) retryTimer = setInterval(() => connect({ quiet: true }).catch(() => {}), 3000);
    throw err;
  }
}

function setup() {
  $('#stage').innerHTML = `
    <div class="card setup">
      <h3>Start the helper once</h3>
      <p>A web page cannot read your Adobe cache or write to your Fonts folder on its
         own, so a small helper does that part. It runs only on your machine and only
         while this page is open in front of you.</p>
      <div class="cmd"><code id="cmd">${esc(START_CMD)}</code>
        <button id="copy" class="primary">Copy</button></div>
      <p class="muted">Paste it into Terminal. This page connects by itself the moment
         it is running - nothing else to do.</p>
      <p class="muted">Prefer not to use a browser at all?
         <code>python3 ~/fontdash/fontdash.py --install-new</code> does the whole job
         from the terminal.</p>
    </div>`;
  $('#copy').onclick = async () => {
    await navigator.clipboard.writeText(START_CMD);
    $('#copy').textContent = 'Copied';
    setTimeout(() => ($('#copy').textContent = 'Copy'), 1400);
  };
}

// ---------- scan + render ----------

async function scan() {
  $('#stage').innerHTML = `<div class="card"><p class="muted">Checking your machine…</p></div>`;
  DATA = await api('/api/scan');
  picked.clear();
  for (const c of DATA.candidates) if (!c.installed && c.recommended) picked.add(c.id);
  render();
}

function groups() {
  const showAll = $('#showall')?.checked;
  const map = new Map();
  for (const c of DATA.candidates) {
    if (c.installed && !showAll) continue;
    const k = c.family || c.psname;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(c);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function render() {
  const newOnes = DATA.candidates.filter(c => !c.installed && c.recommended);
  const gs = groups();

  $('#stage').innerHTML = `
    <div class="toolbar">
      <div class="stats">
        <b>${fmt(newOnes.length)}</b> new
        <span class="sep">·</span> ${fmt(DATA.installed_count)} installed
        <span class="sep">·</span> ${fmt(DATA.candidates.length)} files seen
        ${DATA.adobe_dir ? '<span class="tag ok">Adobe cache found</span>' : ''}
      </div>
      <label class="chk"><input type="checkbox" id="showall"> show installed</label>
      <button id="rescan">Rescan</button>
      <button id="go" class="primary">Install</button>
    </div>
    <div id="log"></div>
    <div id="list">${gs.length ? gs.map(groupHtml).join('')
      : `<div class="card empty">Nothing new. Everything found is already installed.<br>
         <span class="muted">Tick <em>show installed</em> to see the lot.</span></div>`}</div>`;

  $('#rescan').onclick = () => scan().catch(() => connect());
  $('#go').onclick = install;
  $('#showall').onchange = render;
  $('#list').querySelectorAll('input[data-id]').forEach(cb => {
    cb.onchange = () => { cb.checked ? picked.add(cb.dataset.id) : picked.delete(cb.dataset.id); sync(); };
  });
  sync();
}

const groupHtml = ([fam, rows]) => {
  const anyNew = rows.some(r => !r.installed);
  return `<details class="grp" ${anyNew ? 'open' : ''}>
    <summary><span class="fam">${esc(fam)}</span>
      <span class="muted">${rows.length} file${rows.length > 1 ? 's' : ''}</span>
      ${anyNew ? '' : '<span class="tag ok">installed</span>'}</summary>
    <table><thead><tr><th style="width:32px"></th><th>Style</th><th>Format</th>
      <th class="num">Glyphs</th><th>Notes</th><th>Source</th></tr></thead><tbody>
    ${rows.map(rowHtml).join('')}</tbody></table></details>`;
};

const tagCls = f => f === 'incomplete' ? 'bad' : (f === 'demo' || f === 'mislabelled') ? 'warn' : '';

const rowHtml = r => `<tr>
  <td>${r.installed ? '' : `<input type="checkbox" data-id="${r.id}" ${picked.has(r.id) ? 'checked' : ''}>`}</td>
  <td><div>${esc(r.style || 'Regular')}</div><div class="sub">${esc(r.suggested)}</div></td>
  <td>${esc(r.outlines)}${r.recommended && r.alternatives ? ' <span class="tag ok">best</span>' : ''}</td>
  <td class="num">${fmt(r.chars)}</td>
  <td>${r.installed ? '<span class="tag ok">installed</span>' : ''}
      ${r.flags.map(f => `<span class="tag ${tagCls(f)}">${esc(f)}</span>`).join('')}
      ${r.missing.length ? `<span class="tag bad">no ${esc(r.missing.join(', '))}</span>` : ''}</td>
  <td><div>${r.source === 'adobe' ? 'Adobe CC' : r.source === 'zip' ? 'in a zip' : 'file'}</div>
      <div class="sub">${esc(short(r.member || r.origin))}</div></td></tr>`;

const sync = () => {
  const go = $('#go'); if (!go) return;
  go.disabled = !picked.size;
  go.textContent = picked.size ? `Install ${picked.size}` : 'Install';
};

async function install() {
  const go = $('#go');
  go.disabled = true; go.textContent = 'Installing…';
  const { results } = await api('/api/install', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: [...picked] }),
  });
  const ok = results.filter(r => r.ok).length;
  await scan();
  $('#log').innerHTML = `<div class="card log"><b>${ok} installed</b>, ${results.length - ok} skipped.
    ${results.map(r => `<div>${r.ok ? '✓' : '·'} ${esc(r.name || r.id)} — ${esc(r.msg)}</div>`).join('')}
    <div class="muted" style="margin-top:8px">Restart Figma or Illustrator to pick them up.</div></div>`;
}

// ---------- offline inspector ----------

const FONT_RE = /\.(otf|ttf|ttc|otc)$/i;

export async function inspect(files) {
  const rows = [];
  for (const f of files) {
    try {
      if (/\.zip$/i.test(f.name)) {
        for (const m of await unzip(f))
          rows.push({ ...describe(m.buffer, m.name), from: `${f.name} › ${m.path}` });
      } else if (FONT_RE.test(f.name)) {
        rows.push({ ...describe(await f.arrayBuffer(), f.name), from: f.name });
      }
    } catch (err) {
      rows.push({ family: f.name, style: '', outlines: '—', chars: 0, missing: [],
        flags: ['unreadable'], from: f.name });
    }
  }
  return rows;
}

async function unzip(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(buf.buffer);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--)
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('unreadable zip');
  const count = dv.getUint16(eocd + 10, true);
  let ptr = dv.getUint32(eocd + 16, true);
  const out = [];
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(ptr, true) !== 0x02014b50) break;
    const method = dv.getUint16(ptr + 10, true), csize = dv.getUint32(ptr + 20, true);
    const nlen = dv.getUint16(ptr + 28, true), elen = dv.getUint16(ptr + 30, true);
    const clen = dv.getUint16(ptr + 32, true), lho = dv.getUint32(ptr + 42, true);
    const name = new TextDecoder().decode(buf.subarray(ptr + 46, ptr + 46 + nlen));
    ptr += 46 + nlen + elen + clen;
    const base = name.split('/').pop();
    if (!FONT_RE.test(base) || base.startsWith('._') || name.includes('__MACOSX')) continue;
    const ln = dv.getUint16(lho + 26, true), le = dv.getUint16(lho + 28, true);
    const raw = buf.subarray(lho + 30 + ln + le, lho + 30 + ln + le + csize);
    let data;
    if (method === 0) data = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length);
    else if (method === 8) data = await new Response(
      new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
    else continue;
    out.push({ name: base, path: name, buffer: data });
  }
  return out;
}

connect().catch(() => {});
