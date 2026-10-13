/**
 * Dependency-free SVG charts: line/area and bars, responsive, accessible
 * (title + table fallback via aria-label summary).
 */
import { h } from './dom.js';
import { number } from './format.js';

const COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)'];

/**
 * points: [{label, a: '10.00', b: ...}], series: [{key, label}]
 */
export function lineChart(points, series, { height = 220, type = 'line' } = {}) {
  const W = 640;
  const H = height;
  const pad = { l: 48, r: 12, t: 12, b: 28 };
  const vals = points.flatMap((p) => series.map((s) => Number(p[s.key] || 0)));
  const max = Math.max(1, ...vals);
  const min = Math.min(0, ...vals);
  const x = (i) => pad.l + (points.length <= 1 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (points.length - 1));
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - (v - min) / (max - min || 1));
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const v = min + (max - min) * f;
    return h('g', {},
      h('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: 'grid' }),
      h('text', { x: pad.l - 6, y: y(v) + 4, class: 'axis', 'text-anchor': 'end' }, short(v)));
  });
  const every = Math.ceil(points.length / 8);
  const labels = points.map((p, i) => (i % every === 0 ? h('text', { x: x(i), y: H - 8, class: 'axis', 'text-anchor': 'middle' }, p.label.slice(5) || p.label) : null));
  let marks;
  if (type === 'bar') {
    const bw = Math.max(2, ((W - pad.l - pad.r) / Math.max(1, points.length)) / (series.length + 1));
    marks = series.map((s, si) => points.map((p, i) => {
      const v = Number(p[s.key] || 0);
      const cx = pad.l + ((i + 0.5) * (W - pad.l - pad.r)) / points.length + (si - (series.length - 1) / 2) * bw;
      return h('rect', { x: cx - bw / 2, y: Math.min(y(v), y(0)), width: bw * 0.9, height: Math.abs(y(0) - y(v)), fill: COLORS[si], rx: 2 },
        h('title', {}, `${s.label} ${p.label}: ${number(String(v))}`));
    }));
  } else {
    marks = series.map((s, si) => {
      const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(Number(p[s.key] || 0)).toFixed(1)}`).join('');
      return h('g', {},
        h('path', { d, fill: 'none', stroke: COLORS[si], 'stroke-width': 2.5, 'stroke-linejoin': 'round' }),
        points.map((p, i) => h('circle', { cx: x(i), cy: y(Number(p[s.key] || 0)), r: points.length > 40 ? 0 : 3, fill: COLORS[si] },
          h('title', {}, `${s.label} ${p.label}: ${number(String(p[s.key] || 0))}`))));
    });
  }
  const summary = series.map((s) => `${s.label}: ${number(String(points.reduce((a, p) => a + Number(p[s.key] || 0), 0)))}`).join(', ');
  return h('figure', { class: 'chart' },
    h('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': summary, preserveAspectRatio: 'none' }, grid, labels, marks),
    h('figcaption', { class: 'legend' }, series.map((s, si) => h('span', {}, h('i', { style: { background: COLORS[si] } }), s.label))));
}

function short(v) {
  const a = Math.abs(v);
  if (a >= 1e7) return (v / 1e7).toFixed(1) + 'Cr';
  if (a >= 1e5) return (v / 1e5).toFixed(1) + 'L';
  if (a >= 1e3) return (v / 1e3).toFixed(1) + 'k';
  return String(Math.round(v));
}
