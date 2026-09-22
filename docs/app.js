// The dashboard. Runs from github.io or from the local agent - the only
// difference is where the API lives.

import { describe } from './fontlib.js';

// A page served over https cannot call http://127.0.0.1 - Chrome and Safari both
// block it as mixed content. So the dashboard only drives your machine when it is
// served BY your machine. On github.io this file just shows the one-line installer.
const LOCAL = location.hostname === '127.0.0.1' || location.hostname === 'localhost';
const INSTALL_CMD = 'curl -fsSL https://aditya31sharma.github.io/fontdash/install.sh | bash';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const short = p => String(p).replace(/^\/Users\/[^/]+/, '~');
const fmt = n => Number(n).toLocaleString();

let DATA = null, picked = new Set();

async function api(path, opts) {
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error('agent returned ' + r.status);
  return r.json();
}

// ---------- connect ----------

async function connect() {
  if (!LOCAL) return setup();
  try {
    const ping = await api('/api/ping');
    $('#status').innerHTML =
      `<span class="dot ok"></span>${esc(short(ping.install_dir))}
       <button id="quit" class="link">quit</button>`;
    $('#quit').onclick = async () => {
      await api('/api/quit', { method: 'POST' }).catch(() => {});
      document.body.innerHTML = '<div class="wrap" style="padding:80px 22px">' +
        '<p class="muted">Stopped. Close this tab.</p></div>';
    };
    return scan();
  } catch (err) {
    $('#status').innerHTML = `<span class="dot"></span>not responding`;
    $('#stage').innerHTML =
      `<div class="card"><h3>The dashboard stopped</h3>
       <p class="muted">Reopen Font Dashboard from your Applications folder.</p></div>`;
  }
}

function setup() {
  $('#status').innerHTML = `<span class="dot"></span>not installed yet`;
  $('#stage').innerHTML = `
    <div class="card setup">
      <h3>Install it once, then it runs itself</h3>
      <p>Paste this into Terminal. It sets up <b>Font Dashboard</b> in your
         Applications folder and opens it.</p>
      <div class="cmd"><code>${esc(INSTALL_CMD)}</code>
        <button id="copy" class="primary">Copy</button></div>
      <p class="muted">After that you double-click the app. It checks your Adobe
         Creative Cloud fonts and your download folders, shows what is new, and
         installs whatever you tick.</p>
      <p class="muted">This page cannot do that part itself: browsers block a website
         from reaching your own machine, which is the rule that stops any other site
         doing the same thing. The app is the same dashboard, served locally.</p>
    </div>`;
  $('#copy').onclick = async () => {
    await navigator.clipboard.writeText(INSTALL_CMD);
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
