// Port of fontlib.py: enough sfnt parsing to name a font and measure what it
// really covers. Runs entirely in the browser, nothing is uploaded.

const UPPER = range(65, 90), LOWER = range(97, 122), DIGITS = range(48, 57);
const PUNCT = [...".,!?'\"-:;()"].map(c => c.charCodeAt(0));

function range(a, b) { const o = []; for (let i = a; i <= b; i++) o.push(i); return o; }

function tables(dv, offset = 0) {
  const tag = dv.getUint32(offset);
  if (tag === 0x74746366) return tables(dv, dv.getUint32(offset + 12)); // 'ttcf'
  if (![0x4f54544f, 0x00010000, 0x74727565, 0x74797031].includes(tag))
    throw new Error('not a font file');
  const count = dv.getUint16(offset + 4), out = {};
  for (let i = 0; i < count; i++) {
    const rec = offset + 12 + 16 * i;
    if (rec + 16 > dv.byteLength) break;
    let name = '';
    for (let j = 0; j < 4; j++) name += String.fromCharCode(dv.getUint8(rec + j));
    out[name] = [dv.getUint32(rec + 8), dv.getUint32(rec + 12)];
  }
  return out;
}

function names(dv, tabs) {
  if (!tabs.name) return {};
  const off = tabs.name[0];
  const count = dv.getUint16(off + 2), storage = off + dv.getUint16(off + 4);
  const best = {};
  for (let i = 0; i < count; i++) {
    const rec = off + 6 + 12 * i;
    if (rec + 12 > dv.byteLength) break;
    const pid = dv.getUint16(rec), nid = dv.getUint16(rec + 6);
    const len = dv.getUint16(rec + 8), noff = dv.getUint16(rec + 10);
    const bytes = new Uint8Array(dv.buffer, dv.byteOffset + storage + noff, len);
    let value = '';
    if (pid === 3) {
      for (let j = 0; j + 1 < len; j += 2) value += String.fromCharCode((bytes[j] << 8) | bytes[j + 1]);
    } else {
      for (let j = 0; j < len; j++) value += String.fromCharCode(bytes[j]);
    }
    value = value.replace(/\0/g, '').trim();
    if (!value) continue;
    if (!(nid in best) || pid === 3) best[nid] = value;
  }
  return best;
}

function coverage(dv, tabs) {
  if (!tabs.cmap) return new Set();
  const off = tabs.cmap[0], n = dv.getUint16(off + 2);
  let chosen = null, fallback = null;
  for (let i = 0; i < n; i++) {
    const rec = off + 4 + 8 * i;
    const pid = dv.getUint16(rec), eid = dv.getUint16(rec + 2), sub = dv.getUint32(rec + 4);
    if ((pid === 3 && eid === 10) || (pid === 0 && (eid === 4 || eid === 6))) { chosen = off + sub; break; }
    if ((pid === 3 && eid === 1) || (pid === 0 && eid === 3)) chosen = chosen ?? off + sub;
    else if (fallback === null) fallback = off + sub;
  }
  const start = chosen ?? fallback;
  if (start === null) return new Set();
  const fmt = dv.getUint16(start), chars = new Set();
  if (fmt === 4) {
    const segX2 = dv.getUint16(start + 6), segs = segX2 / 2;
    const endO = start + 14, startO = endO + segX2 + 2;
    for (let i = 0; i < segs; i++) {
      const end = dv.getUint16(endO + 2 * i), beg = dv.getUint16(startO + 2 * i);
      if (beg === 0xffff) continue;
      for (let c = beg; c <= Math.min(end, 0xfffe); c++) chars.add(c);
    }
  } else if (fmt === 12) {
    const groups = dv.getUint32(start + 12);
    for (let i = 0; i < groups; i++) {
      const rec = start + 16 + 12 * i;
      if (rec + 12 > dv.byteLength) break;
      const beg = dv.getUint32(rec), end = dv.getUint32(rec + 4);
      if (end - beg > 0x10ffff) continue;
      for (let c = beg; c <= Math.min(end, 0x10ffff); c++) chars.add(c);
    }
  } else if (fmt === 6) {
    const first = dv.getUint16(start + 6), cnt = dv.getUint16(start + 8);
    for (let c = first; c < first + cnt; c++) chars.add(c);
  } else if (fmt === 0) {
    for (let c = 0; c < 256; c++) if (dv.getUint8(start + 6 + c)) chars.add(c);
  }
  return chars;
}

export function describe(buffer, filename = '') {
  const dv = new DataView(buffer);
  const tabs = tables(dv);
  const nm = names(dv, tabs), chars = coverage(dv, tabs);
  const truetype = 'glyf' in tabs;
  const ext = filename.includes('.') ? filename.split('.').pop().toLowerCase() : '';
  const flags = [];
  if ((ext === 'ttf' && !truetype) || (ext === 'otf' && truetype)) flags.push('mislabelled');
  const missing = [];
  const has = set => set.every(c => chars.has(c));
  if (!has(UPPER)) missing.push('A-Z');
  if (!has(LOWER)) missing.push('a-z');
  if (!has(DIGITS)) missing.push('0-9');
  if (!has(PUNCT)) missing.push('punctuation');
  if (missing.length) flags.push('incomplete');
  const family = nm[16] || nm[1] || filename;
  const ps = nm[6] || '';
  const blob = `${ps} ${nm[4] || ''} ${family} ${filename}`.toLowerCase();
  if (/demo|personal use|trial/.test(blob)) flags.push('demo');
  return {
    filename, family, style: nm[17] || nm[2] || 'Regular', psname: ps,
    full: nm[4] || `${family} ${nm[2] || ''}`.trim(),
    outlines: truetype ? 'TrueType' : 'CFF',
    chars: chars.size, missing, flags, size: buffer.byteLength,
  };
}
