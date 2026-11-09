'use strict';
/**
 * 零依赖 .xlsx 读写（Office Open XML）。
 * 读：首个工作表 → 二维字符串数组（共享字符串、内联字符串、数字、布尔、日期格式单元格转 YYYY-MM-DD）。
 * 写：单工作表、内联字符串/数字，用于导入模板与列表导出。
 */
const zlib = require('node:zlib');

// ---------------- ZIP ----------------
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('不是有效的 xlsx 文件');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('xlsx 目录损坏');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    files.set(name, { method, csize, usize, dataStart });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return name => {
    const f = files.get(name);
    if (!f) return null;
    if (f.usize > 50 * 1024 * 1024) throw new Error('xlsx 内容过大');
    const raw = buf.subarray(f.dataStart, f.dataStart + f.csize);
    return (f.method === 0 ? raw : zlib.inflateRawSync(raw, { maxOutputLength: 50 * 1024 * 1024 })).toString('utf8');
  };
}

function zip(entries) {
  const locals = [], centrals = []; let offset = 0;
  for (const [name, content] of entries) {
    const data = Buffer.from(content, 'utf8'), comp = zlib.deflateRawSync(data), nameBuf = Buffer.from(name, 'utf8'), crc = zlib.crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameBuf.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameBuf, comp); centrals.push(ch, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const central = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}

// ---------------- XML helpers ----------------
const decode = s => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (m, e) => ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[e] ?? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))));
const encode = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`)); return m ? decode(m[1]) : null; };
/** 取 <t> 文本（忽略拼音注音 rPh） */
const textOf = xml => [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)].map(m => decode(m[1] || '')).join('');
const colIndex = ref => { let n = 0; for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

const BUILTIN_DATE_FMTS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
const isDateCode = code => /[ymdhs]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, ''));
const pad = n => String(n).padStart(2, '0');
function serialToDate(v, date1904) {
  const ms = Math.round((v + (date1904 ? 1462 : 0) - 25569) * 86400000);
  const d = new Date(ms);
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const secs = Math.round((v % 1) * 86400);
  return secs ? `${date} ${pad(Math.floor(secs / 3600))}:${pad(Math.floor(secs / 60) % 60)}` : date;
}

function readRows(buffer) {
  const get = unzip(buffer);
  const workbook = get('xl/workbook.xml');
  if (!workbook) throw new Error('不是有效的 Excel 工作簿');
  const date1904 = /date1904="(1|true)"/.test(workbook);
  const firstSheet = workbook.match(/<sheet\b[^>]*>/);
  if (!firstSheet) throw new Error('工作簿中没有工作表');
  const rid = attr(firstSheet[0], 'r:id');
  const rels = get('xl/_rels/workbook.xml.rels') || '';
  const relTag = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map(m => m[0]).find(t => attr(t, 'Id') === rid);
  let target = relTag ? attr(relTag, 'Target') : 'worksheets/sheet1.xml';
  target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
  const sheet = get(target);
  if (!sheet) throw new Error('无法读取工作表');

  const shared = [...(get('xl/sharedStrings.xml') || '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => textOf(m[1]));
  const styles = get('xl/styles.xml') || '';
  const customFmts = new Map([...styles.matchAll(/<numFmt\b[^>]*>/g)].map(m => [Number(attr(m[0], 'numFmtId')), attr(m[0], 'formatCode') || '']));
  const xfs = (styles.match(/<cellXfs\b[\s\S]*?<\/cellXfs>/) || [''])[0];
  const dateStyle = [...xfs.matchAll(/<xf\b[^>]*>/g)].map(m => {
    const id = Number(attr(m[0], 'numFmtId') || 0);
    return BUILTIN_DATE_FMTS.has(id) || (customFmts.has(id) && isDateCode(customFmts.get(id)));
  });

  const rows = [];
  for (const rm of sheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g)) {
    const r = [];
    for (const cm of (rm[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const tag = cm[1], inner = cm[2] || '', ref = attr(tag, 'r'), t = attr(tag, 't'), s = Number(attr(tag, 's') || 0);
      const vm = inner.match(/<v>([\s\S]*?)<\/v>/), v = vm ? decode(vm[1]) : '';
      let val;
      if (t === 's') val = shared[Number(v)] ?? '';
      else if (t === 'inlineStr') val = textOf(inner);
      else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
      else if (t === 'str' || t === 'e') val = v;
      else if (v !== '' && dateStyle[s]) val = serialToDate(Number(v), date1904);
      else val = v !== '' ? String(Number(v)) : '';
      const idx = ref ? colIndex(ref) : r.length;
      while (r.length < idx) r.push('');
      r[idx] = val;
    }
    rows.push(r);
  }
  return rows.filter(r => r.some(v => String(v).trim() !== ''));
}

/** 生成单工作表 xlsx。rows 为二维数组；数字写为数值，其余写为内联字符串 */
function writeWorkbook(headers, rows, sheetName = 'Sheet1') {
  const colName = i => { let s = ''; for (i++; i; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
  const cell = (v, ri, ci, header) => {
    const ref = colName(ci) + (ri + 1);
    if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
    if (v === null || v === undefined || v === '') return '';
    return `<c r="${ref}" t="inlineStr"${header ? ' s="1"' : ''}><is><t xml:space="preserve">${encode(v)}</t></is></c>`;
  };
  const all = [headers, ...rows];
  const widths = headers.map((h, i) => Math.min(60, Math.max(8, ...all.slice(0, 200).map(r => [...String(r[i] ?? '')].reduce((a, ch) => a + (ch.charCodeAt(0) > 255 ? 2 : 1), 0) + 2))));
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${all.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => cell(v, ri, ci, ri === 0)).join('')}</row>`).join('')}</sheetData></worksheet>`;
  return zip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${encode(sheetName.slice(0, 31).replace(/[\\/?*[\]:]/g, ''))}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ['xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="等线"/></font><font><b/><sz val="11"/><name val="等线"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'],
    ['xl/worksheets/sheet1.xml', sheet],
  ]);
}

module.exports = { readRows, writeWorkbook, unzip, zip, serialToDate };
