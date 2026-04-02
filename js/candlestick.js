import {
  priceToY, yToPrice, timeToX, xToTime,
  niceAxis, niceTimeAxis,
  formatPrice, formatTime,
  drawRoundRect, lerp, clamp, heatColor,
} from './utils.js';

// Layout constants (logical pixels)
const PRICE_W  = 74;  // right price axis strip
const TIME_H   = 22;  // bottom time axis strip
const HEAT_W   = 68;  // volume profile strip (left of price axis)
const VOL_RATIO = 0.14; // fraction of chart height for volume bars

export class CandlestickChart {
  constructor(mainCanvas, overlayCanvas, engine) {
    this.canvas  = mainCanvas;
    this.ocanvas = overlayCanvas;
    this.engine  = engine;

    this.ctx  = mainCanvas.getContext('2d');
    this.octx = overlayCanvas.getContext('2d');

    this.W = 0;
    this.H = 0;

    // Viewport: time in ms, price in $
    this.vp = { timeStart: 0, timeEnd: 0, priceMin: 0, priceMax: 0 };

    // Pan state
    this.mouse       = { x: null, y: null };
    this.drag        = { active: false, startX: 0, startTime: 0 };
    this.panVelocity = 0; // ms/frame

    // Indicator toggles
    this.showBB       = true;
    this.showHeatmap  = true;
    this.multiframeOn = false;
    this.footprintMode = false;

    // Drawing tools (set by main.js after construction)
    this.toolManager = null;

    this._profileCache    = null;
    this._profileMinPrice = 0;
    this._profileMaxPrice = 0;
    this._barWidths       = null; // animated bar widths for heatmap

    this._bindEvents();
  }

  onResize(w, h) {
    this.W = w;
    this.H = h;
    this._initViewport();
  }

  setTimeframe(tf) {
    this._initViewport(tf);
  }

  toggleMultiframe() {
    this.multiframeOn = !this.multiframeOn;
  }

  setIndicator(name, on) {
    if (name === 'bb')      this.showBB      = on;
    if (name === 'heatmap') this.showHeatmap = on;
  }

  setToolManager(tm) { this.toolManager = tm; }
  setFootprintMode(on) { this.footprintMode = on; }

  // viewport initialisation
  _initViewport(tf) {
    const timeframe = tf || this.engine.currentTimeframe;
    const candles   = this.engine.getCandles(timeframe);
    if (!candles.length) return;

    // Show last ~80 candles
    const visible = Math.min(80, candles.length);
    const last    = candles[candles.length - 1];
    const first   = candles[candles.length - visible];
    const candleMs = this._candleMs(candles);

    this.vp.timeStart = first.time - candleMs;
    this.vp.timeEnd   = last.time  + candleMs * 2;
    this._fitPrice(candles);
  }

  _fitPrice(candles) {
    const { timeStart, timeEnd } = this.vp;
    const visible = candles.filter(c => c.time >= timeStart - 1 && c.time <= timeEnd + 1);
    if (!visible.length) return;
    const hi = Math.max(...visible.map(c => c.high));
    const lo = Math.min(...visible.map(c => c.low));
    const pad = (hi - lo) * 0.06;
    this.vp.priceMin = lo - pad;
    this.vp.priceMax = hi + pad;
  }

  _candleMs(candles) {
    for (let i = 1; i < candles.length; i++) {
      if (candles[i].time !== candles[i-1].time) return candles[i].time - candles[i-1].time;
    }
    return 60_000;
  }

  // event binding
  _bindEvents() {
    const el = this.canvas;
    el.addEventListener('mousedown',  e => this._onMouseDown(e));
    el.addEventListener('mousemove',  e => this._onMouseMove(e));
    el.addEventListener('mouseup',    e => this._onMouseUp(e));
    el.addEventListener('mouseleave', e => this._onMouseLeave(e));
    el.addEventListener('wheel',      e => this._onWheel(e), { passive: false });
    el.addEventListener('touchstart',    e => this._onTouchStart(e), { passive: false });
    el.addEventListener('touchmove',     e => this._onTouchMove(e),  { passive: false });
    el.addEventListener('touchend',      e => this._onTouchEnd(e));
    el.addEventListener('contextmenu',   e => { e.preventDefault(); if (this.toolManager) this.toolManager.cancel(); });
  }

  _rect()     { return this.canvas.getBoundingClientRect(); }
  _chartW()   { return this.W - PRICE_W - HEAT_W; }
  _chartH()   { return this.H - TIME_H; }
  _candleH()  { return this._chartH() - Math.floor(this._chartH() * VOL_RATIO); }
  _volH()     { return Math.floor(this._chartH() * VOL_RATIO); }
  _pxPerMs()  { return this._chartW() / (this.vp.timeEnd - this.vp.timeStart); }

  _clientToLocal(e) {
    const r = this._rect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _onMouseDown(e) {
    const { x, y } = this._clientToLocal(e);
    if (this.toolManager && this.toolManager.activeTool !== 'pointer') {
      const time  = xToTime(x, this.vp.timeStart, this.vp.timeEnd, 0, this._chartW());
      const rawP  = yToPrice(y, this.vp.priceMin, this.vp.priceMax, 0, this._candleH());
      const price = this.toolManager.snap(rawP, this.engine.getCandles(this.engine.currentTimeframe));
      this.toolManager.onMouseDown(x, y, time, price);
      return;
    }
    this.drag = { active: true, startX: x, startTime: this.vp.timeStart };
    this.panVelocity = 0;
    this.canvas.style.cursor = 'grabbing';
  }

  _onMouseMove(e) {
    const { x, y } = this._clientToLocal(e);
    this.mouse = { x, y };

    if (this.toolManager) {
      const time  = xToTime(x, this.vp.timeStart, this.vp.timeEnd, 0, this._chartW());
      const rawP  = yToPrice(y, this.vp.priceMin, this.vp.priceMax, 0, this._candleH());
      const price = this.toolManager.snap(rawP, this.engine.getCandles(this.engine.currentTimeframe));
      this.toolManager.onMouseMove(x, y, time, price);
    }

    if (this.drag.active) {
      const pxPerMs = this._pxPerMs();
      const dt = (this.drag.startX - x) / pxPerMs;
      const range = this.vp.timeEnd - this.vp.timeStart;
      this.vp.timeStart = this.drag.startTime + dt;
      this.vp.timeEnd   = this.vp.timeStart + range;
      const tf = this.engine.currentTimeframe;
      this._fitPrice(this.engine.getCandles(tf));
      this.panVelocity = dt / 8;
    }
  }

  _onMouseUp() {
    this.drag.active = false;
    this.canvas.style.cursor = 'crosshair';
  }

  _onMouseLeave() {
    this.drag.active = false;
    this.mouse = { x: null, y: null };
    this.canvas.style.cursor = 'default';
  }

  _onWheel(e) {
    e.preventDefault();
    const { x } = this._clientToLocal(e);
    const pivotTime = xToTime(x, this.vp.timeStart, this.vp.timeEnd, 0, this._chartW());
    // clamp deltaY so trackpad and mouse wheel don't zoom at wildly different speeds
    const delta = clamp(e.deltaY, -120, 120) / 120;
    const factor = 1 + delta * 0.06;
    const range = (this.vp.timeEnd - this.vp.timeStart) * factor;
    const minRange = 10_000;
    const maxRange = 200 * 3600_000;
    const clampedRange = clamp(range, minRange, maxRange);
    const frac = (pivotTime - this.vp.timeStart) / (this.vp.timeEnd - this.vp.timeStart);
    this.vp.timeStart = pivotTime - frac * clampedRange;
    this.vp.timeEnd   = this.vp.timeStart + clampedRange;
    const tf = this.engine.currentTimeframe;
    this._fitPrice(this.engine.getCandles(tf));
  }

  // Touch pan/zoom (pinch)
  _onTouchStart(e) {
    e.preventDefault();
    if (e.touches.length === 1) {
      const t = e.touches[0];
      this.drag = { active: true, startX: t.clientX - this._rect().left, startTime: this.vp.timeStart };
      this.panVelocity = 0;
    }
    if (e.touches.length === 2) {
      this._pinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      this._pinchStart = { ...this.vp };
    }
  }

  _onTouchMove(e) {
    e.preventDefault();
    if (e.touches.length === 1 && this.drag.active) {
      const x = e.touches[0].clientX - this._rect().left;
      const dt = (this.drag.startX - x) / this._pxPerMs();
      const range = this.vp.timeEnd - this.vp.timeStart;
      this.vp.timeStart = this.drag.startTime + dt;
      this.vp.timeEnd   = this.vp.timeStart + range;
      this._fitPrice(this.engine.getCandles(this.engine.currentTimeframe));
    }
    if (e.touches.length === 2 && this._pinchDist) {
      const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      const factor = this._pinchDist / dist;
      const ps = this._pinchStart;
      const mid = (ps.timeStart + ps.timeEnd) / 2;
      const half = (ps.timeEnd - ps.timeStart) / 2 * factor;
      this.vp.timeStart = mid - half;
      this.vp.timeEnd   = mid + half;
      this._fitPrice(this.engine.getCandles(this.engine.currentTimeframe));
    }
  }

  _onTouchEnd(e) {
    this.drag.active = false;
    this._pinchDist = null;
  }

  // main render
  render(timestamp) {
    if (!this.W || !this.H) return;

    const dpr = window.devicePixelRatio || 1;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.octx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // momentum pan — 0.88 decay felt the best after playing with it for a while
    if (!this.drag.active && Math.abs(this.panVelocity) > 0.5) {
      const range = this.vp.timeEnd - this.vp.timeStart;
      this.vp.timeStart += this.panVelocity;
      this.vp.timeEnd    = this.vp.timeStart + range;
      this.panVelocity  *= 0.88;
      this._fitPrice(this.engine.getCandles(this.engine.currentTimeframe));
    }

    const tf      = this.engine.currentTimeframe;
    const candles = this.engine.getCandles(tf);
    const theme   = this.engine.theme;
    const W = this.W, H = this.H;
    const cW = this._chartW();
    const cH = this._chartH();
    const cndH = this._candleH();
    const volH = this._volH();
    const pxPerMs = this._pxPerMs();
    const candleMs = this._candleMs(candles);
    const vp = this.vp;

    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, W, H);

    this._drawGrid(ctx, W, H, cW, cH, theme);
    if (this.showBB) this._drawBollinger(ctx, candles, cW, cndH, pxPerMs, vp, theme);
    if (this.multiframeOn) this._drawMultiframe(ctx, cW, cndH, pxPerMs, vp, theme);
    if (!this.footprintMode) this._drawVolumeBars(ctx, candles, cW, cH, cndH, volH, pxPerMs, vp, theme);
    if (this.footprintMode) {
      this._drawFootprint(ctx, candles, cW, cndH, pxPerMs, candleMs, vp);
    } else {
      this._drawCandles(ctx, candles, cW, cndH, pxPerMs, candleMs, vp, timestamp);
    }
    if (this.showHeatmap) this._drawHeatmap(ctx, W, cH, HEAT_W, PRICE_W, vp, theme);
    this._drawPriceAxis(ctx, W, H, cH, PRICE_W, TIME_H, vp, theme);
    this._drawTimeAxis(ctx, W, H, cW, TIME_H, vp, candleMs, theme);

    // Overlay (crosshair + live price line)
    const octx = this.octx;
    octx.clearRect(0, 0, W, H);
    this._drawLivePriceLine(octx, W, cW, cH, cndH, PRICE_W, HEAT_W, TIME_H, vp, theme, timestamp);
    if (this.mouse.x !== null) {
      this._drawCrosshair(octx, W, H, cW, cH, TIME_H, vp, theme);
      if (!this.footprintMode) this._drawTooltip(octx, candles, cW, cndH, pxPerMs, candleMs, vp, theme);
    }

    // Drawing tools overlay
    if (this.toolManager) {
      this.toolManager.draw(octx, vp, cW, cndH);
    }
  }

  // grid
  _drawGrid(ctx, W, H, cW, cH, theme) {
    ctx.strokeStyle = theme.grid;
    ctx.lineWidth   = 1;

    const priceTicks = niceAxis(this.vp.priceMin, this.vp.priceMax, 7);
    for (const p of priceTicks) {
      const y = priceToY(p, this.vp.priceMin, this.vp.priceMax, 0, cH);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W - PRICE_W, y);
      ctx.stroke();
    }

    const { ticks } = niceTimeAxis(this.vp.timeStart, this.vp.timeEnd, 7);
    for (const t of ticks) {
      const x = timeToX(t, this.vp.timeStart, this.vp.timeEnd, 0, cW);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, cH);
      ctx.stroke();
    }
  }

  // bollinger bands
  _drawBollinger(ctx, candles, cW, cndH, pxPerMs, vp, theme) {
    const period = 20, mult = 2;
    const closes = candles.map(c => c.close);
    if (closes.length < period) return;

    const upper = [], middle = [], lower = [];
    for (let i = period - 1; i < closes.length; i++) {
      const slice = closes.slice(i - period + 1, i + 1);
      const mean  = slice.reduce((s, v) => s + v, 0) / period;
      const std   = Math.sqrt(slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period);
      upper.push({ x: timeToX(candles[i].time, vp.timeStart, vp.timeEnd, 0, cW), y: priceToY(mean + mult * std, vp.priceMin, vp.priceMax, 0, cndH) });
      middle.push({ x: timeToX(candles[i].time, vp.timeStart, vp.timeEnd, 0, cW), y: priceToY(mean,              vp.priceMin, vp.priceMax, 0, cndH) });
      lower.push({ x: timeToX(candles[i].time, vp.timeStart, vp.timeEnd, 0, cW), y: priceToY(mean - mult * std, vp.priceMin, vp.priceMax, 0, cndH) });
    }

    // Fill between bands
    ctx.beginPath();
    ctx.moveTo(upper[0].x, upper[0].y);
    for (const p of upper) ctx.lineTo(p.x, p.y);
    for (let i = lower.length - 1; i >= 0; i--) ctx.lineTo(lower[i].x, lower[i].y);
    ctx.closePath();
    ctx.fillStyle = theme.bbFill;
    ctx.fill();

    ctx.strokeStyle = theme.bbLine;
    ctx.lineWidth   = 1;
    ctx.setLineDash([3, 4]);
    for (const pts of [upper, middle, lower]) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (const p of pts) ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // multi-timeframe overlay
  _drawMultiframe(ctx, cW, cndH, pxPerMs, vp, theme) {
    const draw = (candles, color, bodyW) => {
      const cMs = this._candleMs(candles);
      ctx.strokeStyle = color;
      ctx.lineWidth   = bodyW;
      for (const c of candles) {
        const x = (c.time - vp.timeStart) * pxPerMs;
        const w = Math.max(bodyW + 2, cMs * pxPerMs * 0.85);
        if (x + w < 0 || x > cW) continue;
        const top = priceToY(Math.max(c.open, c.close), vp.priceMin, vp.priceMax, 0, cndH);
        const bot = priceToY(Math.min(c.open, c.close), vp.priceMin, vp.priceMax, 0, cndH);
        ctx.strokeRect(x, top, w, Math.max(1, bot - top));
      }
    };

    ctx.save();
    ctx.globalAlpha = 1;
    draw(this.engine.candles1h, theme.multi1h, 2.5);
    draw(this.engine.candles5m, theme.multi5m, 1);
    ctx.restore();
  }

  // volume bars
  _drawVolumeBars(ctx, candles, cW, cH, cndH, volH, pxPerMs, vp, theme) {
    const volTop    = cndH;
    const volBottom = cH;
    const maxVol    = Math.max(...candles.map(c => c.volume), 1);
    const pal       = this.engine.palette;

    for (const c of candles) {
      const cMs = this._candleMs(candles);
      const x   = (c.time - vp.timeStart) * pxPerMs;
      const w   = Math.max(1, cMs * pxPerMs * 0.85);
      if (x + w < 0 || x > cW) continue;

      const barH  = (c.volume / maxVol) * volH;
      const isBull = c.close >= c.open;
      ctx.fillStyle   = isBull ? pal.bull : pal.bear;
      ctx.globalAlpha = 0.35;
      ctx.fillRect(x, volBottom - barH, Math.max(1, w - 1), barH);
      ctx.globalAlpha = 1;
    }
  }

  // candles
  _drawCandles(ctx, candles, cW, cndH, pxPerMs, candleMs, vp, timestamp) {
    const pal = this.engine.palette;

    for (let i = 0; i < candles.length; i++) {
      const c    = candles[i];
      const cMs  = i < candles.length - 1 ? candles[i+1].time - c.time : candleMs;
      const x    = (c.time - vp.timeStart) * pxPerMs;
      const w    = Math.max(1, cMs * pxPerMs);
      if (x + w < -w || x > cW + w) continue;

      const isBull  = c.close >= c.open;
      const color   = isBull ? pal.bull : pal.bear;
      const openY   = priceToY(c.open,  vp.priceMin, vp.priceMax, 0, cndH);
      const closeY  = priceToY(c.close, vp.priceMin, vp.priceMax, 0, cndH);
      const highY   = priceToY(c.high,  vp.priceMin, vp.priceMax, 0, cndH);
      const lowY    = priceToY(c.low,   vp.priceMin, vp.priceMax, 0, cndH);
      const bodyTop = Math.min(openY, closeY);
      const bodyH   = Math.max(1, Math.abs(closeY - openY));
      const bodyW   = Math.max(1, w * 0.82);
      const bodyX   = x + (w - bodyW) / 2;

      ctx.strokeStyle = color;
      ctx.fillStyle   = color;
      ctx.lineWidth   = 1;

      // Wick
      ctx.globalAlpha = 0.65;
      const wickX = x + w / 2;
      ctx.beginPath();
      ctx.moveTo(wickX, highY);
      ctx.lineTo(wickX, lowY);
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Body
      if (bodyH < 2) {
        ctx.beginPath();
        ctx.moveTo(bodyX, bodyTop + 0.5);
        ctx.lineTo(bodyX + bodyW, bodyTop + 0.5);
        ctx.stroke();
      } else {
        ctx.fillRect(bodyX, bodyTop, bodyW, bodyH);
      }

      // Subtle pulse on live candle
      if (c.isLive) {
        const pulse = 0.25 + 0.15 * Math.sin(timestamp * 0.004);
        ctx.globalAlpha = pulse;
        ctx.fillStyle = color;
        ctx.fillRect(bodyX, bodyTop, bodyW, bodyH);
        ctx.globalAlpha = 1;
      }
    }
  }

  // volume profile / heatmap
  _drawHeatmap(ctx, W, cH, heatW, priceW, vp, theme) {
    const x0 = W - priceW - heatW;

    // Recompute profile if price range changed significantly
    if (
      !this._profileCache ||
      Math.abs(this._profileMinPrice - vp.priceMin) / vp.priceMin > 0.005 ||
      Math.abs(this._profileMaxPrice - vp.priceMax) / vp.priceMax > 0.005
    ) {
      this._profileCache    = this.engine.getVolumeProfile(vp.priceMin, vp.priceMax, 60);
      this._profileMinPrice = vp.priceMin;
      this._profileMaxPrice = vp.priceMax;

      // Initialise animated target bar widths
      if (!this._barWidths) {
        this._barWidths = this._profileCache.map(b => b.normalizedHeat);
      } else {
        this._barTargets = this._profileCache.map(b => b.normalizedHeat);
      }
    }

    // Animate bar widths toward targets
    if (this._barTargets) {
      for (let i = 0; i < this._barWidths.length; i++) {
        this._barWidths[i] = lerp(this._barWidths[i], this._barTargets[i], 0.06);
      }
    }

    const profile = this._profileCache;
    if (!profile.length) return;

    const bucketH = cH / profile.length;

    // Separator
    ctx.strokeStyle = theme.border;
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(x0, 0);
    ctx.lineTo(x0, cH);
    ctx.stroke();

    const maxW = heatW - 4;
    for (let i = 0; i < profile.length; i++) {
      const b = profile[i];
      const y = priceToY(b.price + (vp.priceMax - vp.priceMin) / 120,
                         vp.priceMin, vp.priceMax, 0, cH);
      const h = Math.max(1, bucketH);
      const t = this._barWidths ? this._barWidths[i] : b.normalizedHeat;
      const bW = Math.max(1, t * maxW);

      ctx.fillStyle = heatColor(t);
      ctx.globalAlpha = 0.72;
      ctx.fillRect(x0 + 2, y - h / 2, bW, h);
      ctx.globalAlpha = 1;
    }

    // Current price arrow
    const curY = priceToY(this.engine.getCurrentPrice(), vp.priceMin, vp.priceMax, 0, cH);
    ctx.fillStyle   = theme.text;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.moveTo(x0, curY - 3);
    ctx.lineTo(x0 + 5, curY);
    ctx.lineTo(x0, curY + 3);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // price axis
  _drawPriceAxis(ctx, W, H, cH, priceW, timeH, vp, theme) {
    const x0   = W - priceW;
    const ticks = niceAxis(vp.priceMin, vp.priceMax, 7);

    ctx.fillStyle   = theme.surface;
    ctx.fillRect(x0, 0, priceW, cH + timeH);
    ctx.strokeStyle = theme.border;
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(x0, 0);
    ctx.lineTo(x0, cH);
    ctx.stroke();

    ctx.fillStyle  = theme.textSub;
    ctx.font       = '10px "IBM Plex Mono", monospace';
    ctx.textAlign  = 'right';
    ctx.textBaseline = 'middle';

    for (const p of ticks) {
      const y = priceToY(p, vp.priceMin, vp.priceMax, 0, cH);
      if (y < 4 || y > cH - 4) continue;
      ctx.fillText(formatPrice(p), W - 4, y);

      // Tick mark
      ctx.strokeStyle = theme.axis;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x0 + 4, y);
      ctx.stroke();
    }

    // Live price tag
    const liveY = priceToY(this.engine.getCurrentPrice(), vp.priceMin, vp.priceMax, 0, cH);
    if (liveY > 2 && liveY < cH - 2) {
      const livePrice = this.engine.getCurrentPrice();
      const tagW = priceW - 4;
      const tagH = 16;
      ctx.fillStyle = theme.priceTag;
      ctx.strokeStyle = theme.text;
      ctx.lineWidth = 1;
      drawRoundRect(ctx, x0 + 2, liveY - tagH / 2, tagW, tagH, 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle    = theme.text;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.font         = '500 10px "IBM Plex Mono", monospace';
      ctx.fillText(formatPrice(livePrice), x0 + 2 + tagW / 2, liveY);
    }
  }

  // time axis
  _drawTimeAxis(ctx, W, H, cW, timeH, vp, candleMs, theme) {
    const y0 = H - timeH;
    ctx.fillStyle = theme.surface;
    ctx.fillRect(0, y0, W, timeH);

    ctx.strokeStyle = theme.border;
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(0, y0);
    ctx.lineTo(W - PRICE_W, y0);
    ctx.stroke();

    const { ticks, step } = niceTimeAxis(vp.timeStart, vp.timeEnd, 8);
    ctx.fillStyle    = theme.textSub;
    ctx.font         = '10px "IBM Plex Mono", monospace';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';

    for (const t of ticks) {
      const x = timeToX(t, vp.timeStart, vp.timeEnd, 0, cW);
      if (x < 30 || x > cW - 10) continue;
      ctx.fillText(formatTime(t, step), x, y0 + timeH / 2);

      ctx.strokeStyle = theme.axis;
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y0 + 4);
      ctx.stroke();
    }
  }

  // live price dashed line (overlay canvas)
  _drawLivePriceLine(octx, W, cW, cH, cndH, priceW, heatW, timeH, vp, theme, timestamp) {
    const price = this.engine.getCurrentPrice();
    const y     = priceToY(price, vp.priceMin, vp.priceMax, 0, cndH);
    if (y < 0 || y > cndH) return;

    const pulse = 0.35 + 0.2 * Math.sin(timestamp * 0.0028);
    octx.strokeStyle = theme.priceLine;
    octx.globalAlpha = pulse;
    octx.lineWidth   = 1;
    octx.setLineDash([4, 5]);
    octx.beginPath();
    octx.moveTo(0, y);
    octx.lineTo(W - priceW - heatW, y);
    octx.stroke();
    octx.setLineDash([]);
    octx.globalAlpha = 1;
  }

  // crosshair (overlay canvas)
  _drawCrosshair(octx, W, H, cW, cH, timeH, vp, theme) {
    const { x, y } = this.mouse;
    if (x > cW || y > cH) return;

    octx.strokeStyle = theme.crosshair;
    octx.lineWidth   = 1;
    octx.setLineDash([3, 4]);

    // Vertical
    octx.beginPath();
    octx.moveTo(x, 0);
    octx.lineTo(x, cH);
    octx.stroke();

    // Horizontal
    octx.beginPath();
    octx.moveTo(0, y);
    octx.lineTo(cW, y);
    octx.stroke();

    octx.setLineDash([]);

    // Price label on axis
    const price = yToPrice(y, vp.priceMin, vp.priceMax, 0, cH);
    const tagW  = PRICE_W - 4, tagH = 16;
    const tagX  = W - PRICE_W + 2;
    octx.fillStyle = theme.crosshair;
    drawRoundRect(octx, tagX, y - tagH / 2, tagW, tagH, 2);
    octx.fill();
    octx.fillStyle    = theme.bg;
    octx.font         = '10px "IBM Plex Mono", monospace';
    octx.textAlign    = 'center';
    octx.textBaseline = 'middle';
    octx.fillText(formatPrice(price), tagX + tagW / 2, y);
  }

  // ohlcv tooltip (overlay canvas)
  _drawTooltip(octx, candles, cW, cndH, pxPerMs, candleMs, vp, theme) {
    const { x, y } = this.mouse;
    if (x < 0 || x > cW || y > cndH) return;

    const time = xToTime(x, vp.timeStart, vp.timeEnd, 0, cW);
    let closest = candles[0], minDist = Infinity;
    for (const c of candles) {
      const cx = (c.time - vp.timeStart) * pxPerMs + (candleMs * pxPerMs) / 2;
      const d  = Math.abs(cx - x);
      if (d < minDist) { minDist = d; closest = c; }
    }

    const c     = closest;
    const isBull = c.close >= c.open;
    const pal   = this.engine.palette;

    const lines = [
      { label: 'O', val: formatPrice(c.open)   },
      { label: 'H', val: formatPrice(c.high)   },
      { label: 'L', val: formatPrice(c.low)    },
      { label: 'C', val: formatPrice(c.close)  },
      { label: 'V', val: this._fmtVol(c.volume) },
    ];

    const PAD = 10, ROW = 16;
    const tW  = 130, tH = PAD * 2 + lines.length * ROW;
    let tx = x + 14, ty = y - tH / 2;
    if (tx + tW > cW) tx = x - tW - 14;
    ty = clamp(ty, 2, cndH - tH - 2);

    octx.fillStyle = theme.tooltip;
    octx.strokeStyle = theme.border;
    octx.lineWidth = 1;
    drawRoundRect(octx, tx, ty, tW, tH, 3);
    octx.fill();
    octx.stroke();

    // Color bar
    octx.fillStyle = isBull ? pal.bull : pal.bear;
    octx.globalAlpha = 0.7;
    octx.fillRect(tx, ty, 2, tH);
    octx.globalAlpha = 1;

    octx.font         = '10px "IBM Plex Mono", monospace';
    octx.textBaseline = 'middle';

    for (let i = 0; i < lines.length; i++) {
      const ly = ty + PAD + i * ROW + ROW / 2;
      octx.fillStyle = theme.textSub;
      octx.textAlign = 'left';
      octx.fillText(lines[i].label, tx + 10, ly);

      octx.fillStyle = theme.text;
      octx.textAlign = 'right';
      octx.fillText(lines[i].val, tx + tW - 8, ly);
    }
  }

  _fmtVol(v) {
    if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return v.toFixed(0);
  }

  // footprint chart
  _drawFootprint(ctx, candles, cW, cndH, pxPerMs, candleMs, vp) {
    const theme = this.engine.theme;
    const bull  = this.engine.palette.bull;
    const bear  = this.engine.palette.bear;

    for (const c of candles) {
      const x  = (c.time - vp.timeStart) * pxPerMs;
      const cW_ = Math.max(1, candleMs * pxPerMs);
      if (x + cW_ < -cW_ || x > cW + cW_) continue;

      const highY  = priceToY(c.high, vp.priceMin, vp.priceMax, 0, cndH);
      const lowY   = priceToY(c.low,  vp.priceMin, vp.priceMax, 0, cndH);
      const totalH = lowY - highY;
      if (totalH < 3) continue;

      const numRows = Math.max(3, Math.min(24, Math.floor(totalH / 9)));
      const rowH    = totalH / numRows;
      const rows    = this.engine.getFootprintData(c, numRows);
      if (!rows.length) continue;

      const maxVol  = Math.max(...rows.map(r => r.bid + r.ask), 1);
      const half    = cW_ / 2;

      // POC = row with highest total volume
      let pocIdx = 0;
      for (let i = 1; i < rows.length; i++) {
        if (rows[i].bid + rows[i].ask > rows[pocIdx].bid + rows[pocIdx].ask) pocIdx = i;
      }

      // Outer border
      ctx.strokeStyle = theme.border;
      ctx.lineWidth   = 0.5;
      ctx.strokeRect(x, highY, cW_ - 1, totalH);

      for (let i = 0; i < numRows; i++) {
        // rows[0] = lowest price, drawn at bottom
        const row  = rows[i];
        const ry   = highY + (numRows - 1 - i) * rowH;
        const dAbs = Math.abs(row.delta);

        // Cell background: subtle green/red tint by delta intensity
        const alpha = Math.min(0.30, (dAbs / maxVol) * 1.2);
        ctx.fillStyle   = row.delta >= 0
          ? `rgba(74,148,99,${alpha})`
          : `rgba(192,57,43,${alpha})`;
        ctx.fillRect(x, ry, cW_ - 1, rowH);

        // Row separator
        ctx.strokeStyle = theme.border;
        ctx.lineWidth   = 0.5;
        ctx.beginPath(); ctx.moveTo(x, ry); ctx.lineTo(x + cW_ - 1, ry); ctx.stroke();

        // Volume bars (bid left of centre, ask right of centre)
        if (cW_ > 30) {
          const barH_   = Math.max(1, rowH * 0.55);
          const barY_   = ry + (rowH - barH_) / 2;
          const bidW    = (row.bid / maxVol) * (half - 2);
          const askW    = (row.ask / maxVol) * (half - 2);
          ctx.globalAlpha = 0.55;
          ctx.fillStyle   = bear;
          ctx.fillRect(x + half - bidW, barY_, bidW, barH_);
          ctx.fillStyle   = bull;
          ctx.fillRect(x + half, barY_, askW, barH_);
          ctx.globalAlpha = 1;
        }

        // Text (only when rows are tall enough)
        if (rowH >= 11 && cW_ > 48) {
          const fs  = Math.min(10, rowH - 2);
          const midY = ry + rowH / 2;
          ctx.font         = `${fs}px "IBM Plex Mono", monospace`;
          ctx.textBaseline = 'middle';
          ctx.globalAlpha  = 0.75;

          const bidTxt = row.bid >= 1000 ? (row.bid / 1000).toFixed(1) + 'K' : Math.round(row.bid).toString();
          const askTxt = row.ask >= 1000 ? (row.ask / 1000).toFixed(1) + 'K' : Math.round(row.ask).toString();

          ctx.fillStyle = bear; ctx.textAlign = 'right';
          ctx.fillText(bidTxt, x + half - 2, midY);
          ctx.fillStyle = bull; ctx.textAlign = 'left';
          ctx.fillText(askTxt, x + half + 2, midY);
          ctx.globalAlpha = 1;
        }
      }

      // POC highlight
      const pocY = highY + (numRows - 1 - pocIdx) * rowH;
      ctx.strokeStyle = theme.text;
      ctx.lineWidth   = 1;
      ctx.globalAlpha = 0.45;
      ctx.strokeRect(x, pocY, cW_ - 1, rowH);
      ctx.globalAlpha = 1;
    }
  }
}
