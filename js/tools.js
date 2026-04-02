import { priceToY, yToPrice, xToTime, formatPrice, drawRoundRect } from './utils.js';

// fib level definitions
const FIB_LEVELS = [
  { t: 0,     label: '0',     rgba: [160,156,150] },
  { t: 0.236, label: '0.236', rgba: [100,148,210] },
  { t: 0.382, label: '0.382', rgba: [80, 170,110] },
  { t: 0.5,   label: '0.5',   rgba: [180,148, 80] },
  { t: 0.618, label: '0.618', rgba: [80, 170,110] },
  { t: 0.786, label: '0.786', rgba: [100,148,210] },
  { t: 1.0,   label: '1',     rgba: [160,156,150] },
];

const FIB_EXT_LEVELS = [
  { t: 0,     label: '0'     },
  { t: 0.618, label: '0.618' },
  { t: 1.0,   label: '1'     },
  { t: 1.618, label: '1.618' },
  { t: 2.0,   label: '2'     },
  { t: 2.618, label: '2.618' },
];

// Tools that complete on a single click
const ONE_CLICK = new Set(['hline', 'vline', 'long', 'short']);
// Tools that need a third point
const THREE_PT  = new Set(['channel', 'pitchfork', 'fib-ext']);

// drawingtoolmanager
export class DrawingToolManager {
  constructor(engine) {
    this.engine = engine;
    this.activeTool = 'pointer';
    this.magnetMode = false;
    this.drawings = [];
    this._wip = null;   // work-in-progress drawing
    this._phase = 0;    // 0=idle  1=awaiting p2  2=awaiting p3
    this._cursor = { x: 0, y: 0, time: 0, price: 0 };
  }

  setTool(name) {
    this.activeTool = name;
    this._wip   = null;
    this._phase = 0;
  }

  toggleMagnet() {
    this.magnetMode = !this.magnetMode;
    return this.magnetMode;
  }

  clearAll() {
    this.drawings = [];
    this._wip   = null;
    this._phase = 0;
  }

  // Snap price/time to nearest OHLC value when magnet is on
  snap(price, candles) {
    if (!this.magnetMode || !candles.length) return price;
    let nearest = price, minDist = Infinity;
    for (const c of candles) {
      for (const v of [c.open, c.high, c.low, c.close]) {
        const d = Math.abs(v - price);
        if (d < minDist && d / price < 0.003) { minDist = d; nearest = v; }
      }
    }
    return nearest;
  }

  // mouse event handlers
  // Returns true if the tool consumed the event (chart should NOT pan)

  onMouseDown(x, y, time, price) {
    if (this.activeTool === 'pointer') return false;
    const pt = { x, y, time, price };

    if (this.activeTool === 'eraser') {
      this._erase(x, y);
      return true;
    }

    if (this._phase === 0) {
      if (ONE_CLICK.has(this.activeTool)) {
        this._commit(this._make(pt));
      } else {
        this._wip   = this._make(pt);
        this._phase = 1;
      }
    } else if (this._phase === 1) {
      this._wip.p2 = pt;
      if (THREE_PT.has(this.activeTool)) {
        this._phase = 2;
      } else {
        this._commit(this._wip);
      }
    } else if (this._phase === 2) {
      this._wip.p3 = pt;
      this._commit(this._wip);
    }
    return true;
  }

  onMouseMove(x, y, time, price) {
    this._cursor = { x, y, time, price };
    if (this._phase === 1 && this._wip) this._wip.p2 = { x, y, time, price };
    if (this._phase === 2 && this._wip) this._wip.p3 = { x, y, time, price };
  }

  // Cancel in-progress drawing (right-click)
  cancel() {
    this._wip   = null;
    this._phase = 0;
  }

  _commit(d) {
    if (d) this.drawings.push(d);
    this._wip   = null;
    this._phase = 0;
  }

  _make(p1) {
    const dummy = { ...p1 };
    const base  = { tool: this.activeTool, p1, p2: dummy, p3: dummy };
    if (this.activeTool === 'long') {
      base.stopLoss   = p1.price * 0.99;
      base.takeProfit = p1.price * 1.02;
    }
    if (this.activeTool === 'short') {
      base.stopLoss   = p1.price * 1.01;
      base.takeProfit = p1.price * 0.98;
    }
    return base;
  }

  _erase(x, y) {
    const THRESH = 14;
    for (let i = this.drawings.length - 1; i >= 0; i--) {
      const d = this.drawings[i];
      // Test proximity to p1 and p2 in last-known screen coords
      if (
        Math.hypot(d.p1.x - x, d.p1.y - y) < THRESH ||
        Math.hypot(d.p2.x - x, d.p2.y - y) < THRESH
      ) {
        this.drawings.splice(i, 1);
        return;
      }
    }
  }

  // main render
  draw(ctx, vp, chartW, candleH) {
    if (!vp.timeEnd || vp.timeEnd === vp.timeStart) return;

    const toX = t => (t - vp.timeStart) / (vp.timeEnd - vp.timeStart) * chartW;
    const toY = p => priceToY(p, vp.priceMin, vp.priceMax, 0, candleH);

    const all = [...this.drawings];
    if (this._wip) all.push(this._wip);

    for (const d of all) {
      const isWip = d === this._wip;
      ctx.save();
      ctx.globalAlpha = isWip ? 0.68 : 0.90;
      this._render(ctx, d, toX, toY, chartW, candleH, vp, isWip);
      ctx.restore();
    }

    // Magnet indicator ring around cursor
    if (this.magnetMode && this.activeTool !== 'pointer') {
      const th = this.engine.theme;
      ctx.save();
      ctx.strokeStyle = th.text;
      ctx.lineWidth   = 1;
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.arc(this._cursor.x, this._cursor.y, 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // per-drawing renderer dispatch
  _render(ctx, d, toX, toY, chartW, candleH, vp, isWip) {
    const th  = this.engine.theme;
    const col = th.text;     // all drawings use the theme text colour

    const x1 = toX(d.p1.time), y1 = toY(d.p1.price);
    const x2 = toX(d.p2.time), y2 = toY(d.p2.price);
    const x3 = d.p3 ? toX(d.p3.time) : x2;
    const y3 = d.p3 ? toY(d.p3.price) : y2;

    // Update screen coords so eraser hit-test stays accurate
    d.p1.x = x1; d.p1.y = y1;
    d.p2.x = x2; d.p2.y = y2;

    ctx.strokeStyle = col;
    ctx.fillStyle   = col;
    ctx.lineWidth   = 1;

    switch (d.tool) {
      case 'trendline': this._trendline(ctx, x1, y1, x2, y2, chartW, candleH, isWip); break;
      case 'ray':       this._ray(ctx, x1, y1, x2, y2, chartW, candleH, isWip); break;
      case 'hline':     this._hline(ctx, y1, x1, chartW, d, th); break;
      case 'vline':     this._vline(ctx, x1, y1, candleH, d, th); break;
      case 'fib':       this._fib(ctx, x1, y1, x2, y2, chartW, d, th); break;
      case 'fib-ext':   this._fibExt(ctx, x1, y1, x2, y2, x3, y3, chartW, d, th); break;
      case 'fib-fan':   this._fibFan(ctx, x1, y1, x2, y2, chartW, candleH); break;
      case 'fib-tz':    this._fibTZ(ctx, x1, x2, candleH, th); break;
      case 'rect':      this._rect(ctx, x1, y1, x2, y2); break;
      case 'circle':    this._circle(ctx, x1, y1, x2, y2); break;
      case 'channel':   this._channel(ctx, x1, y1, x2, y2, x3, y3, chartW, candleH); break;
      case 'pitchfork': this._pitchfork(ctx, x1, y1, x2, y2, x3, y3, chartW, candleH); break;
      case 'long':      this._position(ctx, x1, y1, chartW, candleH, d, toY, th, true); break;
      case 'short':     this._position(ctx, x1, y1, chartW, candleH, d, toY, th, false); break;
      case 'measure':   this._measure(ctx, x1, y1, x2, y2, d, th); break;
      case 'text':      if (d.text) this._text(ctx, x1, y1, d, th); break;
    }
  }

  // individual drawing renderers
  _dot(ctx, x, y, r = 3) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  _trendline(ctx, x1, y1, x2, y2, chartW, candleH, isWip) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    if (!isWip) { this._dot(ctx, x1, y1); this._dot(ctx, x2, y2); }
  }

  _ray(ctx, x1, y1, x2, y2, chartW, candleH, isWip) {
    if (x1 === x2) {
      ctx.beginPath(); ctx.moveTo(x1, 0); ctx.lineTo(x1, candleH); ctx.stroke();
    } else {
      const slope = (y2 - y1) / (x2 - x1);
      const ex = x2 >= x1 ? chartW : 0;
      const ey = y1 + slope * (ex - x1);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(ex, ey); ctx.stroke();
    }
    if (!isWip) this._dot(ctx, x1, y1);
  }

  _hline(ctx, y, x0, chartW, d, th) {
    ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(chartW, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '9px "IBM Plex Mono", monospace';
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText(formatPrice(d.p1.price), 4, y - 2);
  }

  _vline(ctx, x, y, candleH, d, th) {
    ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, candleH); ctx.stroke();
    ctx.setLineDash([]);
    const label = new Date(d.p1.time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    ctx.font = '9px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(label, x, 4);
  }

  _fib(ctx, x1, y1, x2, y2, chartW, d, th) {
    const range    = d.p2.price - d.p1.price; // signed
    const left     = Math.min(x1, x2);
    const rightEdge = chartW - 76;

    ctx.font = '9px "IBM Plex Mono", monospace';
    for (const { t, label, rgba } of FIB_LEVELS) {
      const price = d.p1.price + range * t;
      const fy    = priceToY(price, this.engine.theme === th ? 0 : 0, 0, 0, 0); // recalc via y already done
      // Use stored canvas y
      const cy = y1 + (y2 - y1) * t;
      const c  = `rgba(${rgba[0]},${rgba[1]},${rgba[2]},0.65)`;
      ctx.strokeStyle = c;
      ctx.fillStyle   = c;
      ctx.lineWidth   = 1;
      ctx.beginPath(); ctx.moveTo(left, cy); ctx.lineTo(rightEdge, cy); ctx.stroke();
      ctx.globalAlpha = 0.55;
      ctx.textAlign   = 'right'; ctx.textBaseline = 'bottom';
      ctx.fillText(label + '  ' + formatPrice(price), left - 2, cy);
      ctx.globalAlpha = 0.90;
    }
    // Shaded golden zone
    const cy382 = y1 + (y2 - y1) * 0.382;
    const cy618 = y1 + (y2 - y1) * 0.618;
    ctx.fillStyle   = 'rgba(80,160,100,0.05)';
    ctx.fillRect(left, Math.min(cy382, cy618), rightEdge - left, Math.abs(cy618 - cy382));
    // Anchor line
    ctx.strokeStyle = th.text; ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.setLineDash([]);
    this._dot(ctx, x1, y1); this._dot(ctx, x2, y2);
  }

  _fibExt(ctx, x1, y1, x2, y2, x3, y3, chartW, d, th) {
    const baseRange = y2 - y1; // in pixels (signed)
    const rightEdge = chartW - 76;
    ctx.font = '9px "IBM Plex Mono", monospace';
    for (const { t, label } of FIB_EXT_LEVELS) {
      const fy = y3 - baseRange * t;
      ctx.strokeStyle = th.textSub; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(Math.min(x1, x3), fy); ctx.lineTo(rightEdge, fy); ctx.stroke();
      ctx.fillStyle = th.textSub; ctx.globalAlpha = 0.6;
      ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillText(label, Math.min(x1, x3) + 2, fy);
      ctx.globalAlpha = 0.90;
    }
    ctx.strokeStyle = th.text; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.stroke();
    this._dot(ctx, x1, y1); this._dot(ctx, x2, y2); this._dot(ctx, x3, y3);
  }

  _fibFan(ctx, x1, y1, x2, y2, chartW, candleH) {
    const dir = x2 >= x1 ? 1 : -1;
    for (const level of [0.382, 0.5, 0.618]) {
      const fy     = y1 + (y2 - y1) * level;
      const slope  = x2 !== x1 ? (fy - y1) / (x2 - x1) : 0;
      const ex     = dir > 0 ? chartW : 0;
      const ey     = y1 + slope * (ex - x1);
      ctx.globalAlpha = 0.55; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.font = '9px "IBM Plex Mono", monospace';
      ctx.fillStyle = ctx.strokeStyle;
      ctx.textAlign = dir > 0 ? 'right' : 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(level.toString(), ex + dir * (-4), ey);
      ctx.globalAlpha = 0.90;
    }
    this._dot(ctx, x1, y1);
  }

  _fibTZ(ctx, x1, x2, candleH, th) {
    const fib = [1, 1, 2, 3, 5, 8, 13, 21, 34];
    const dx  = x2 - x1;
    ctx.font = '9px "IBM Plex Mono", monospace';
    for (let i = 0; i < fib.length; i++) {
      const x = x1 + dx * fib[i];
      if (x < -20 || x > 9999) continue;
      ctx.globalAlpha = 0.40; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, candleH); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.55; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(fib[i], x, 5);
      ctx.globalAlpha = 0.90;
    }
  }

  _rect(ctx, x1, y1, x2, y2) {
    const rx = Math.min(x1, x2), ry = Math.min(y1, y2);
    const rw = Math.abs(x2 - x1), rh = Math.abs(y2 - y1);
    ctx.globalAlpha = 0.07; ctx.fill();  // use current fillStyle
    ctx.fillRect(rx, ry, rw, rh);
    ctx.globalAlpha = 0.90;
    ctx.strokeRect(rx, ry, rw, rh);
    this._dot(ctx, x1, y1); this._dot(ctx, x2, y2);
  }

  _circle(ctx, x1, y1, x2, y2) {
    const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
    const rx = Math.max(1, Math.abs(x2 - x1) / 2);
    const ry = Math.max(1, Math.abs(y2 - y1) / 2);
    ctx.globalAlpha = 0.06; ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.90;
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
    this._dot(ctx, x1, y1); this._dot(ctx, x2, y2);
  }

  _channel(ctx, x1, y1, x2, y2, x3, y3, chartW, candleH) {
    const slope = x2 !== x1 ? (y2 - y1) / (x2 - x1) : 0;
    const yOnLine = y1 + slope * (x3 - x1);
    const dy = y3 - yOnLine;
    const yl0 = y1 + slope * (0 - x1), ylR = y1 + slope * (chartW - x1);
    const yu0 = yl0 + dy, yuR = ylR + dy;
    ctx.beginPath(); ctx.moveTo(0, yl0); ctx.lineTo(chartW, ylR); ctx.stroke();
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(0, yu0); ctx.lineTo(chartW, yuR); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.04;
    ctx.beginPath(); ctx.moveTo(0, yl0); ctx.lineTo(chartW, ylR); ctx.lineTo(chartW, yuR); ctx.lineTo(0, yu0); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 0.90;
    this._dot(ctx, x1, y1); this._dot(ctx, x2, y2); this._dot(ctx, x3, y3);
  }

  _pitchfork(ctx, x1, y1, x2, y2, x3, y3, chartW, candleH) {
    const mx = (x2 + x3) / 2, my = (y2 + y3) / 2;
    const mSlope = mx !== x1 ? (my - y1) / (mx - x1) : 0;
    const ex = mx >= x1 ? chartW : 0;
    const ey = y1 + mSlope * (ex - x1);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(ex, ey); ctx.stroke();
    for (const [px, py] of [[x2, y2], [x3, y3]]) {
      const pex = ex, pey = py + mSlope * (ex - px);
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(pex, pey); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 0.30;
    ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x3, y3); ctx.stroke();
    ctx.globalAlpha = 0.90;
    this._dot(ctx, x1, y1); this._dot(ctx, x2, y2); this._dot(ctx, x3, y3);
  }

  _position(ctx, x1, y1, chartW, candleH, d, toY, th, isLong) {
    const slY  = toY(d.stopLoss);
    const tpY  = toY(d.takeProfit);
    const rw   = Math.min(chartW - x1 - 78, 200);
    if (rw < 10) return;

    const bull = this.engine.palette.bull, bear = this.engine.palette.bear;
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = isLong ? bear : bull;
    ctx.fillRect(x1, Math.min(y1, slY), rw, Math.abs(slY - y1));
    ctx.fillStyle = isLong ? bull : bear;
    ctx.fillRect(x1, Math.min(y1, tpY), rw, Math.abs(tpY - y1));
    ctx.globalAlpha = 0.90;

    ctx.strokeStyle = th.text;    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 + rw, y1); ctx.stroke();
    ctx.strokeStyle = bear; ctx.lineWidth = 1;
    ctx.setLineDash([3,3]); ctx.beginPath(); ctx.moveTo(x1, slY); ctx.lineTo(x1 + rw, slY); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = bull;
    ctx.setLineDash([3,3]); ctx.beginPath(); ctx.moveTo(x1, tpY); ctx.lineTo(x1 + rw, tpY); ctx.stroke(); ctx.setLineDash([]);

    ctx.font = '9px "IBM Plex Mono", monospace'; ctx.textBaseline = 'bottom'; ctx.textAlign = 'right';
    ctx.fillStyle = th.textSub; ctx.fillText(formatPrice(d.p1.price), x1 + rw - 2, y1 - 1);
    ctx.fillStyle = bear;       ctx.fillText('SL ' + formatPrice(d.stopLoss),   x1 + rw - 2, slY - 1);
    ctx.fillStyle = bull;       ctx.fillText('TP ' + formatPrice(d.takeProfit), x1 + rw - 2, tpY - 1);
  }

  _measure(ctx, x1, y1, x2, y2, d, th) {
    const rx = Math.min(x1, x2), ry = Math.min(y1, y2);
    const rw = Math.abs(x2 - x1), rh = Math.abs(y2 - y1);
    ctx.fillStyle = 'rgba(140,136,130,0.08)'; ctx.fillRect(rx, ry, rw, rh);
    ctx.setLineDash([3,4]); ctx.strokeRect(rx, ry, rw, rh); ctx.setLineDash([]);
    const pDiff = d.p2.price - d.p1.price;
    const pct   = ((pDiff / d.p1.price) * 100).toFixed(2);
    const bars  = Math.round(Math.abs(d.p2.time - d.p1.time) / 60000);
    const lbl   = `${pDiff >= 0 ? '+' : ''}${formatPrice(Math.abs(pDiff))}  (${pDiff >= 0 ? '+' : ''}${pct}%)  ${bars}b`;
    if (rw > 60 && rh > 16) {
      ctx.font = '10px "IBM Plex Mono", monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = th.text; ctx.globalAlpha = 0.75;
      ctx.fillText(lbl, rx + rw / 2, ry + rh / 2);
      ctx.globalAlpha = 0.90;
    }
    this._dot(ctx, x1, y1); this._dot(ctx, x2, y2);
  }

  _text(ctx, x, y, d, th) {
    ctx.font = '12px "IBM Plex Mono", monospace';
    ctx.fillStyle = th.text; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(d.text, x, y);
  }
}
