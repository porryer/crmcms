'use strict';
/** RFC 4180 CSV 解析/生成（支持 BOM、引号转义、单元格内换行、逗号/制表符/分号分隔自动识别） */

function detectDelimiter(firstLine) {
  const counts = [',', '\t', ';'].map(d => [d, firstLine.split(d).length]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 1 ? counts[0][0] : ',';
}

function parse(text) {
  text = String(text || '').replace(/^﻿/, '');
  const delim = detectDelimiter(text.split(/\r?\n/, 1)[0] || '');
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(v => String(v).trim() !== ''));
}

/** 防公式注入：以 = + - @ 制表/回车开头的单元格前加单引号 */
function stringify(headers, rows) {
  const esc = v => {
    let s = String(v === undefined || v === null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  return '﻿' + [headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\r\n');
}

module.exports = { parse, stringify };
