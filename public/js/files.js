import { ENTITY_LABEL, icon } from './constants.js';
import { openModal } from './forms.js';
import { rerender } from './router.js';
import { $, me } from './state.js';
import { API, canEdit, canManage, esc, fileSize, fmtDateTime, toast } from './util.js';

// ======================= 附件 =======================
export async function filesPane(entity, id) {
  const { items } = await API.get(`/attachments?entity=${entity}&entityId=${encodeURIComponent(id)}`);
  return `<div class="files" data-entity="${entity}" data-id="${esc(id)}">
    <div class="sub-head">${canEdit() ? `<label class="btn light small">${icon('upload')}上传文件<input type="file" hidden multiple data-act-change="upload" data-entity="${entity}" data-id="${esc(id)}"></label>` : ''}<span class="muted small">支持 PDF、Office、图片、TXT/CSV、ZIP，单个不超过 20MB</span></div>
    ${items.length ? `<div class="tbl-wrap plain"><table><thead><tr><th>文件名</th><th>大小</th><th>上传人</th><th>上传时间</th><th class="ops">操作</th></tr></thead><tbody>${items.map(f => `<tr><td><a class="link" href="/api/attachments/${esc(f.id)}/download">${icon('clip')}${esc(f.name)}</a></td><td>${fileSize(f.size)}</td><td>${esc(f.createdByName || '—')}</td><td>${fmtDateTime(f.createdAt)}</td><td class="ops">${canManage() || f.createdBy === me.id ? `<button class="textbtn danger" data-act="file-del" data-id="${esc(f.id)}">删除</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty small">${icon('clip')}<p>暂无文件</p></div>`}</div>`;
}
export async function uploadFiles(input) {
  const { entity, id } = input.dataset, box = input.closest('.files');
  for (const f of input.files) {
    const r = await fetch(`/api/attachments?entity=${entity}&entityId=${encodeURIComponent(id)}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': f.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(f.name) }, body: f });
    if (!r.ok) { toast(`${f.name}：${(await r.json().catch(() => ({}))).error || '上传失败'}`, true); continue; }
    toast(`已上传 ${f.name}`);
  }
  box.outerHTML = await filesPane(entity, id);
}

// ======================= 批量导入 =======================
/** 读取导入文件：.xlsx → base64；CSV → 文本（UTF-8 失败时按 GBK 解码，兼容 Excel 默认另存） */
async function readImportFile(file) {
  const buf = await file.arrayBuffer();
  if (/\.xlsx$/i.test(file.name)) {
    let bin = ''; const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { xlsx: btoa(bin) };
  }
  if (/\.xls$/i.test(file.name)) throw new Error('不支持旧版 .xls，请在 Excel 中另存为 .xlsx 或 CSV');
  try { return { csv: new TextDecoder('utf-8', { fatal: true }).decode(buf) }; } catch { return { csv: new TextDecoder('gbk').decode(buf) }; }
}
export function importModal(type) {
  const dlg = openModal({
    title: `批量导入${ENTITY_LABEL[type]}`, wide: true, submitText: '确认导入',
    body: `<ol class="howto"><li>下载导入模板：<a class="link" href="/api/${type}/import?format=xlsx">Excel 模板</a> 或 <a class="link" href="/api/${type}/import">CSV 模板</a>，按表头填写（负责人填成员姓名${['contacts', 'opportunities'].includes(type) ? '；客户填系统中已有的客户名称' : ''}）。</li>
      <li>直接上传 .xlsx（读取第一个工作表）或 CSV，系统先逐行预检，全部通过才能导入。</li></ol>
      <label class="fld wide"><span>导入文件（.xlsx / .csv）</span><input class="field" type="file" accept=".xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" name="file" data-role="import-file"></label><div id="importResult"></div>`,
    onSubmit: async (fd, form) => {
      if (!form.payload) { toast('请先选择文件并完成预检', true); return false; }
      const r = await API.post(`/${type}/import`, { ...form.payload, commit: true });
      toast(`已导入 ${r.imported} 条${ENTITY_LABEL[type]}`); rerender();
    },
  });
  const form = dlg.querySelector('form'), submit = form.querySelector('[type=submit]');
  submit.disabled = true;
  form.querySelector('[data-role=import-file]').addEventListener('change', async e => {
    const file = e.target.files[0]; form.payload = null; submit.disabled = true;
    if (!file) return;
    const out = $('#importResult', dlg); out.innerHTML = '<div class="loading">预检中…</div>';
    try {
      if (file.size > 4 * 1024 * 1024) throw new Error('文件不能超过 4MB，请分批导入');
      const payload = await readImportFile(file);
      const r = await API.post(`/${type}/import`, payload);
      out.innerHTML = `<div class="import-sum"><span>共 <b>${r.total}</b> 行</span><span class="ok">可导入 <b>${r.valid}</b></span><span class="${r.errorCount ? 'neg' : ''}">错误 <b>${r.errorCount}</b></span></div>
        ${r.ignoredColumns.length ? `<p class="muted small">未识别的列（将忽略）：${r.ignoredColumns.map(esc).join('、')}</p>` : ''}
        ${r.errorCount ? `<div class="tbl-wrap plain"><table class="mini edit"><thead><tr><th>行号</th><th>错误</th></tr></thead><tbody>${r.errors.map(x => `<tr><td>${x.line}</td><td>${esc(x.error)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="ok">✓ 预检通过，可以导入</p>'}`;
      if (!r.errorCount && r.valid) { form.payload = payload; submit.disabled = false; }
    } catch (err) { out.innerHTML = `<p class="neg">${esc(err.message)}</p>`; }
  });
}
