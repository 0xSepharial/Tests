// ── Math helpers ──────────────────────────────────────────────────────────

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

export function easeOutCubic(t) {
  return 1 - Math.pow(1 - clamp(t, 0, 1), 3);
}

// Box-Muller standard normal variate
export function randn() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ── Coordinate mapping ────────────────────────────────────────────────────

export function priceToY(price, priceMin, priceMax, top, bottom) {
  if (priceMax === priceMin) return (top + bottom) / 2;
  return bottom - ((price - priceMin) / (priceMax - priceMin)) * (bottom - top);
}

export function yToPrice(y, priceMin, priceMax, top, bottom) {
  if (bottom === top) return (priceMin + priceMax) / 2;
  return priceMin + ((bottom - y) / (bottom - top)) * (priceMax - priceMin);
}

export function timeToX(ts, timeStart, timeEnd, left, right) {
  if (timeEnd === timeStart) return (left + right) / 2;
  return left + ((ts - timeStart) / (timeEnd - timeStart)) * (right - left);
}

export function xToTime(x, timeStart, timeEnd, left, right) {
  if (right === left) return (timeStart + timeEnd) / 2;
  return timeStart + ((x - left) / (right - left)) * (timeEnd - timeStart);
}

// ── Axis ticking ──────────────────────────────────────────────────────────

function niceStep(roughStep) {
  const exp = Math.floor(Math.log10(roughStep));
  const frac = roughStep / Math.pow(10, exp);
  let nice;
  if      (frac <= 1)   nice = 1;
  else if (frac <= 2)   nice = 2;
  else if (frac <= 2.5) nice = 2.5;
  else if (frac <= 5)   nice = 5;
  else                  nice = 10;
  return nice * Math.pow(10, exp);
}

export function niceAxis(min, max, targetCount = 6) {
  const range = max - min;
  if (range === 0) return [min];
  const step = niceStep(range / (targetCount - 1));
  const start = Math.ceil(min / step) * step;
  const ticks = [];
  for (let v = start; v <= max + step * 0.001; v += step) {
    ticks.push(parseFloat(v.toPrecision(10)));
  }
  return ticks;
}

export function niceTimeAxis(timeStart, timeEnd, targetCount = 8) {
  // Returns array of timestamps at "nice" time intervals
  const range = timeEnd - timeStart;
  const intervals = [
    1000, 2000, 5000, 10000, 15000, 30000,
    60000, 120000, 300000, 600000, 900000, 1800000,
    3600000, 7200000, 14400000, 21600000, 43200000, 86400000
  ];
  let step = intervals[0];
  for (const iv of intervals) {
    if (range / iv <= targetCount) { step = iv; break; }
    step = iv;
  }
  const start = Math.ceil(timeStart / step) * step;
  const ticks = [];
  for (let t = start; t <= timeEnd; t += step) ticks.push(t);
  return { ticks, step };
}

// ── Formatting ────────────────────────────────────────────────────────────

export function formatPrice(p) {
  if (p >= 10000) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1000)  return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1)     return p.toFixed(4);
  return p.toFixed(6);
}

export function formatVolume(v) {
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return v.toFixed(0);
}

export function formatTime(ts, step) {
  const d = new Date(ts);
  if (step >= 86400000) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (step >= 3600000)  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: step < 10000 ? '2-digit' : undefined, hour12: false });
}

// ── Canvas helpers ────────────────────────────────────────────────────────

export function drawRoundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ── Color helpers ─────────────────────────────────────────────────────────

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

export function rgbLerp(a, b, t) {
  return [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t)),
  ];
}

// Multi-stop heat color: 0=cold, 1=hot
export function heatColor(t) {
  t = clamp(t, 0, 1);
  const stops = [
    [0,    [20,  30,  48 ]],
    [0.25, [38,  65,  110]],
    [0.55, [160, 90,  35 ]],
    [1.0,  [230, 195, 40 ]],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (t >= t0 && t <= t1) {
      const f = (t - t0) / (t1 - t0);
      const [r, g, b] = rgbLerp(c0, c1, f);
      return `rgb(${r},${g},${b})`;
    }
  }
  return 'rgb(230,195,40)';
}
