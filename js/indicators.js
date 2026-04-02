import { lerp, clamp, niceAxis, formatPrice } from './utils.js';

export class IndicatorPanel {
  constructor(canvas, engine) {
    this.canvas  = canvas;
    this.ctx     = canvas.getContext('2d');
    this.engine  = engine;
    this.W = 0;
    this.H = 0;
    this.showMACD = true;
    this.showRSI  = true;
  }

  onResize(w, h) {
    this.W = w;
    this.H = h;
  }

  setIndicator(name, on) {
    if (name === 'macd') this.showMACD = on;
    if (name === 'rsi')  this.showRSI  = on;
  }

  render(timestamp) {
    if (!this.W || !this.H) return;

    const dpr = window.devicePixelRatio || 1;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const ctx   = this.ctx;
    const W = this.W, H = this.H;
    const theme = this.engine.theme;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, W, H);

    const tf      = this.engine.currentTimeframe;
    const candles = this.engine.getCandles(tf);
    if (candles.length < 26) return;
    const closes  = candles.map(c => c.close);

    // Panel division: left = MACD, right = RSI (or full width if one is off)
    const both = this.showMACD && this.showRSI;
    const macdW = both ? Math.floor(W / 2) : W;
    const rsiX  = both ? macdW : 0;
    const rsiW  = both ? W - macdW : W;

    if (this.showMACD) this._drawMACD(ctx, closes, 0, 0, macdW, H, theme);
    if (this.showRSI)  this._drawRSI(ctx, closes, rsiX, 0, rsiW, H, theme, timestamp);

    // Divider between panels
    if (both) {
      ctx.strokeStyle = theme.border;
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(macdW, 0);
      ctx.lineTo(macdW, H);
      ctx.stroke();
    }
  }

  // macd
  _drawMACD(ctx, closes, x0, y0, W, H, theme) {
    const PAD   = { top: 24, bottom: 18, left: 4, right: 60 };
    const cW    = W - PAD.left - PAD.right;
    const cH    = H - PAD.top  - PAD.bottom;

    const fast = 12, slow = 26, signal = 9;
    const emaFast   = this._ema(closes, fast);
    const emaSlow   = this._ema(closes, slow);
    const n         = Math.min(emaFast.length, emaSlow.length);
    const offset    = closes.length - n;

    const macd    = [];
    for (let i = 0; i < n; i++) macd.push(emaFast[emaFast.length - n + i] - emaSlow[i]);
    const sigLine = this._ema(macd, signal);
    const hist    = macd.slice(macd.length - sigLine.length).map((m, i) => m - sigLine[i]);

    if (!hist.length) return;

    const allVals = [...macd.slice(-sigLine.length), ...sigLine, ...hist];
    const vMin = Math.min(...allVals) * 1.1;
    const vMax = Math.max(...allVals) * 1.1;

    const vToY = (v) => y0 + PAD.top + cH - ((v - vMin) / (vMax - vMin)) * cH;
    const iToX = (i, total) => x0 + PAD.left + (i / (total - 1)) * cW;

    // Panel background & border
    ctx.fillStyle   = theme.surface;
    ctx.fillRect(x0, y0, W, H);
    ctx.strokeStyle = theme.macdLine;
    ctx.lineWidth   = 1;
    ctx.globalAlpha = 0.4;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + W, y0); ctx.stroke();
    ctx.globalAlpha = 1;

    // Zero line
    const zy = vToY(0);
    ctx.strokeStyle = theme.border;
    ctx.lineWidth   = 1;
    ctx.beginPath(); ctx.moveTo(x0 + PAD.left, zy); ctx.lineTo(x0 + PAD.left + cW, zy); ctx.stroke();

    // Histogram bars
    const barW = Math.max(1, cW / hist.length - 1);
    for (let i = 0; i < hist.length; i++) {
      const hx  = iToX(i, hist.length);
      const hy  = vToY(hist[i]);
      const top = Math.min(hy, zy);
      const bH  = Math.abs(hy - zy);
      const pos = hist[i] >= 0;
      ctx.fillStyle   = pos ? this.engine.palette.bull : this.engine.palette.bear;
      ctx.globalAlpha = 0.55;
      ctx.fillRect(hx - barW / 2, top, barW, Math.max(1, bH));
      ctx.globalAlpha = 1;
    }

    // MACD line
    const macdSlice = macd.slice(macd.length - sigLine.length);
    ctx.strokeStyle = theme.macdLine;
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    for (let i = 0; i < macdSlice.length; i++) {
      const lx = iToX(i, macdSlice.length);
      const ly = vToY(macdSlice[i]);
      i === 0 ? ctx.moveTo(lx, ly) : ctx.lineTo(lx, ly);
    }
    ctx.stroke();

    // Signal line
    ctx.strokeStyle = theme.signalLine;
    ctx.lineWidth   = 1;
    ctx.beginPath();
    for (let i = 0; i < sigLine.length; i++) {
      const lx = iToX(i, sigLine.length);
      const ly = vToY(sigLine[i]);
      i === 0 ? ctx.moveTo(lx, ly) : ctx.lineTo(lx, ly);
    }
    ctx.stroke();

    // Labels
    this._panelLabel(ctx, x0 + 6, y0 + 14, 'MACD (12,26,9)', theme);
    this._axisVal(ctx, x0 + W - PAD.right + 4, vToY(macd[macd.length - 1]), macd[macd.length - 1].toFixed(1), theme.macdLine, theme);
  }

  // rsi
  _drawRSI(ctx, closes, x0, y0, W, H, theme, timestamp) {
    const PAD = { top: 24, bottom: 18, left: 4, right: 60 };
    const cW  = W - PAD.left - PAD.right;
    const cH  = H - PAD.top  - PAD.bottom;

    const period = 14;
    const rsi    = this._rsi(closes, period);
    if (!rsi.length) return;

    const vToY  = (v) => y0 + PAD.top + cH - ((v - 0) / 100) * cH;
    const iToX  = (i, total) => x0 + PAD.left + (i / (total - 1)) * cW;

    // Panel background & border
    ctx.fillStyle   = theme.surface;
    ctx.fillRect(x0, y0, W, H);
    ctx.strokeStyle = theme.rsiLine;
    ctx.lineWidth   = 1;
    ctx.globalAlpha = 0.4;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + W, y0); ctx.stroke();
    ctx.globalAlpha = 1;

    // Overbought zone (70-100)
    ctx.fillStyle = theme.rsiOB;
    ctx.fillRect(x0 + PAD.left, vToY(100), cW, vToY(70) - vToY(100));

    // Oversold zone (0-30)
    ctx.fillStyle = theme.rsiOS;
    ctx.fillRect(x0 + PAD.left, vToY(30), cW, vToY(0) - vToY(30));

    // Zone lines
    ctx.strokeStyle = theme.border;
    ctx.lineWidth   = 1;
    ctx.setLineDash([3, 5]);
    for (const level of [70, 50, 30]) {
      const ly = vToY(level);
      ctx.beginPath(); ctx.moveTo(x0 + PAD.left, ly); ctx.lineTo(x0 + PAD.left + cW, ly); ctx.stroke();
    }
    ctx.setLineDash([]);

    // RSI line
    ctx.strokeStyle = theme.rsiLine;
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    for (let i = 0; i < rsi.length; i++) {
      const lx = iToX(i, rsi.length);
      const ly = vToY(rsi[i]);
      i === 0 ? ctx.moveTo(lx, ly) : ctx.lineTo(lx, ly);
    }
    ctx.stroke();

    // Current RSI value tag
    const cur   = rsi[rsi.length - 1];
    const curY  = vToY(cur);
    const tagX  = x0 + PAD.left + cW + 2;
    const color = cur > 70 ? this.engine.palette.bear : cur < 30 ? this.engine.palette.bull : theme.rsiLine;
    ctx.fillStyle    = color;
    ctx.globalAlpha  = 0.15;
    ctx.fillRect(tagX, curY - 8, W - PAD.left - cW - 4, 16);
    ctx.globalAlpha  = 1;
    ctx.fillStyle    = color;
    ctx.font         = '500 10px "IBM Plex Mono", monospace';
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(cur.toFixed(1), tagX + 4, curY);

    // Zone labels
    ctx.fillStyle    = theme.textSub;
    ctx.font         = '9px "IBM Plex Mono", monospace';
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'middle';
    for (const [level, label] of [[70, '70'], [50, '50'], [30, '30']]) {
      ctx.fillText(label, x0 + PAD.left - 2, vToY(level));
    }

    this._panelLabel(ctx, x0 + 6, y0 + 14, 'RSI (14)', theme);
  }

  // helpers
  _ema(data, period) {
    if (data.length < period) return [];
    const k   = 2 / (period + 1);
    const out = [];
    let val   = data.slice(0, period).reduce((s, v) => s + v, 0) / period;
    for (let i = period; i < data.length; i++) {
      val = data[i] * k + val * (1 - k);
      out.push(val);
    }
    return out;
  }

  _rsi(closes, period) {
    if (closes.length < period + 1) return [];
    const out = [];
    let avgGain = 0, avgLoss = 0;

    for (let i = 1; i <= period; i++) {
      const d = closes[i] - closes[i - 1];
      if (d > 0) avgGain += d; else avgLoss -= d;
    }
    avgGain /= period;
    avgLoss /= period;

    for (let i = period + 1; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      const g = d > 0 ? d : 0;
      const l = d < 0 ? -d : 0;
      avgGain = (avgGain * (period - 1) + g) / period;
      avgLoss = (avgLoss * (period - 1) + l) / period;
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      out.push(100 - 100 / (1 + rs));
    }
    return out;
  }

  _panelLabel(ctx, x, y, text, theme) {
    ctx.fillStyle    = theme.textSub;
    ctx.font         = '9px "IBM Plex Mono", monospace';
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
  }

  _axisVal(ctx, x, y, text, color, theme) {
    ctx.fillStyle    = color;
    ctx.font         = '10px "IBM Plex Mono", monospace';
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha  = 0.8;
    ctx.fillText(text, x, y);
    ctx.globalAlpha  = 1;
  }
}
