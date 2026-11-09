import { esc, money, moneyShort } from './util.js';

// ======================= 图表（SVG，属性着色，兼容 CSP） =======================
function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 3 ? 3 : n <= 5 ? 5 : 10) * p;
}
export function lineChart(points, { valueLabel = '销售额' } = {}) {
  const W = 680, H = 260, L = 56, Rr = 16, T = 18, B = 34;
  const max = niceMax(Math.max(...points.map(p => p.amount), 0) * 1.1);
  const x = i => L + (points.length === 1 ? (W - L - Rr) / 2 : (i * (W - L - Rr)) / (points.length - 1));
  const y = v => T + (H - T - B) * (1 - v / max);
  const ticks = [0, 1, 2, 3, 4, 5].map(i => (max * i) / 5);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.amount).toFixed(1)}`).join('');
  const area = `${line}L${x(points.length - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`;
  const step = Math.ceil(points.length / 12);
  return `<svg class="chart line-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${valueLabel}趋势图" data-points='${esc(JSON.stringify(points.map((p, i) => [x(i), y(p.amount), p.label, p.amount])))}'>
    <defs><linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="stop-a"/><stop offset="1" class="stop-b"/></linearGradient></defs>
    ${ticks.map(t => `<line class="grid" x1="${L}" x2="${W - Rr}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${moneyShort(t)}</text>`).join('')}
    ${points.map((p, i) => (i % step === 0 || i === points.length - 1 ? `<text class="axis" x="${x(i)}" y="${H - 10}" text-anchor="middle">${esc(p.label)}</text>` : '')).join('')}
    <path class="area" d="${area}" fill="url(#areaGrad)"/><path class="line" d="${line}"/>
    ${points.length <= 31 ? points.map((p, i) => `<circle class="dot" cx="${x(i)}" cy="${y(p.amount)}" r="3.5"/>`).join('') : ''}
    <g class="tip" transform="translate(0,0)"><line class="tip-line" x1="0" x2="0" y1="${T}" y2="${H - B}"/><circle class="tip-dot" r="6"/><g class="tip-box"><rect x="10" y="-44" width="150" height="50" rx="8"/><text class="tip-l" x="22" y="-24"></text><text class="tip-v" x="22" y="-6"></text></g></g>
  </svg>`;
}
export function bindLineChart(svg, valueLabel = '销售额') {
  if (!svg) return;
  const pts = JSON.parse(svg.dataset.points);
  const tip = svg.querySelector('.tip'), W = svg.viewBox.baseVal.width, H = svg.viewBox.baseVal.height;
  const show = i => {
    const [px, py, label, v] = pts[i];
    tip.setAttribute('transform', `translate(${px},0)`);
    tip.querySelector('.tip-dot').setAttribute('cy', py);
    const box = tip.querySelector('.tip-box');
    const flip = px > W - 180;
    box.setAttribute('transform', `translate(${flip ? -170 : 0},${Math.max(56, Math.min(H - 40, py))})`);
    tip.querySelector('.tip-l').textContent = `${label} ${valueLabel}`;
    tip.querySelector('.tip-v').textContent = money(v);
  };
  let last = pts.length - 1;
  for (let i = pts.length - 1; i >= 0; i--) if (pts[i][3] > 0) { last = i; break; }
  show(last);
  svg.addEventListener('mousemove', e => {
    const r = svg.getBoundingClientRect(), vx = ((e.clientX - r.left) / r.width) * W;
    let best = 0; pts.forEach((p, i) => { if (Math.abs(p[0] - vx) < Math.abs(pts[best][0] - vx)) best = i; });
    show(best);
  });
}
export function barChart(points, key = 'contractAmount', labelKey = 'label') {
  const W = 680, H = 260, L = 56, T = 24, B = 34, Rr = 12;
  const max = niceMax(Math.max(...points.map(p => p[key]), 0) * 1.1);
  const bw = Math.min(42, ((W - L - Rr) / Math.max(1, points.length)) * 0.55);
  const x = i => L + ((i + 0.5) * (W - L - Rr)) / Math.max(1, points.length);
  const y = v => T + (H - T - B) * (1 - v / max);
  return `<svg class="chart bar-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="柱状图">
    ${[0, 1, 2, 3, 4, 5].map(i => (max * i) / 5).map(t => `<line class="grid" x1="${L}" x2="${W - Rr}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${moneyShort(t)}</text>`).join('')}
    ${points.map((p, i) => `<rect class="bar" x="${x(i) - bw / 2}" y="${y(p[key])}" width="${bw}" height="${Math.max(0, y(0) - y(p[key]))}" rx="4"><title>${esc(p[labelKey])}：${money(p[key])}</title></rect>
      ${p[key] ? `<text class="bar-v" x="${x(i)}" y="${y(p[key]) - 6}" text-anchor="middle">${moneyShort(p[key])}</text>` : ''}
      <text class="axis" x="${x(i)}" y="${H - 10}" text-anchor="middle">${esc(p[labelKey])}</text>`).join('')}
  </svg>`;
}
export function donut(items, centerLabel) {
  const total = items.reduce((a, x) => a + x.count, 0);
  const C = 2 * Math.PI * 60;
  let offset = 0;
  const arcs = total ? items.map((x, i) => { const len = (x.count / total) * C; const s = `<circle class="arc c${i % 8}" cx="90" cy="90" r="60" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-offset}"><title>${esc(x.name)}：${x.count}</title></circle>`; offset += len; return s; }).join('') : '<circle class="arc empty" cx="90" cy="90" r="60"/>';
  return `<div class="donut-wrap"><svg class="donut" viewBox="0 0 180 180" role="img" aria-label="${esc(centerLabel)}分布"><g transform="rotate(-90 90 90)">${arcs}</g><text x="90" y="84" text-anchor="middle" class="d-l">${esc(centerLabel)}</text><text x="90" y="108" text-anchor="middle" class="d-v">${total}</text></svg>
    <ul class="legend">${items.map((x, i) => `<li><i class="sw c${i % 8}"></i>${esc(x.name)}<b>${total ? Math.round((x.count / total) * 100) : 0}%</b></li>`).join('') || '<li class="muted">暂无数据</li>'}</ul></div>`;
}
export function funnel(stages) {
  const W = 220, rowH = 34, gap = 5;
  const shown = stages.filter(s => s.stage !== '输单');
  const widths = shown.map((_, i) => W - i * ((W * 0.55) / Math.max(1, shown.length - 1)));
  return `<svg class="funnel" viewBox="0 0 ${W} ${shown.length * (rowH + gap)}" role="img" aria-label="商机销售漏斗">
    ${shown.map((s, i) => {
      const top = widths[i], bot = widths[i + 1] ?? widths[i] * 0.82, yy = i * (rowH + gap);
      return `<path class="fs f${i}" d="M${(W - top) / 2},${yy}H${(W + top) / 2}L${(W + bot) / 2},${yy + rowH}H${(W - bot) / 2}Z"/><text class="fs-t" x="${W / 2}" y="${yy + rowH / 2 + 5}" text-anchor="middle">${esc(s.stage)}  ${s.count}</text>`;
    }).join('')}
  </svg>`;
}
