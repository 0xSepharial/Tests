import { lerp, clamp, drawRoundRect, formatPrice } from './utils.js';

export class OrderbookChart {
  constructor(canvas, engine) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.engine = engine;
    this.W = 0;
    this.H = 0;

    // Smoothed cumulative arrays for animation
    this._smoothBidCum = null;
    this._smoothAskCum = null;
  }

  onResize(w, h) {
    this.W = w;
    this.H = h;
  }

  render(timestamp) {
    if (!this.W || !this.H) return;

    const dpr = window.devicePixelRatio || 1;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const W = this.W, H = this.H;
    const theme  = this.engine.theme;
    const book   = this.engine.orderBook;
    const ctx    = this.ctx;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, W, H);

    if (!book.bids.length || !book.asks.length) return;

    const mid    = this.engine.getCurrentPrice();
    const bids   = book.bids;
    const asks   = book.asks;

    // Build cumulative volumes
    const bidCum = [], askCum = [];
    let bs = 0, as_ = 0;
    for (const b of bids) { bs  += b.size;  bidCum.push(bs);  }
    for (const a of asks) { as_ += a.size;  askCum.push(as_); }

    // lerp toward target each frame so the curves animate smoothly instead of jumping
    if (!this._smoothBidCum) this._smoothBidCum = [...bidCum];
    if (!this._smoothAskCum) this._smoothAskCum = [...askCum];
    for (let i = 0; i < bidCum.length; i++) {
      this._smoothBidCum[i] = lerp(this._smoothBidCum[i], bidCum[i], 0.08);
    }
    for (let i = 0; i < askCum.length; i++) {
      this._smoothAskCum[i] = lerp(this._smoothAskCum[i], askCum[i], 0.08);
    }

    const maxCum = Math.max(
      this._smoothBidCum[this._smoothBidCum.length - 1] || 1,
      this._smoothAskCum[this._smoothAskCum.length - 1] || 1
    );

    // Price range for this panel
    const priceRange = bids[bids.length - 1]
      ? mid - bids[bids.length - 1].price
      : mid * 0.02;
    const priceMin = mid - priceRange * 1.05;
    const priceMax = mid + priceRange * 1.05;

    const PAD_TOP    = 30;
    const PAD_BOTTOM = 22;
    const PAD_LEFT   = 8;
    const PAD_RIGHT  = 8;
    const chartH = H - PAD_TOP - PAD_BOTTOM;
    const chartW = W - PAD_LEFT - PAD_RIGHT;

    const priceToX = (p) => PAD_LEFT + ((p - priceMin) / (priceMax - priceMin)) * chartW;
    const cumToY   = (c) => PAD_TOP + chartH - (c / maxCum) * chartH;

    // Mid X line
    const midX = priceToX(mid);

    // bid area (left of mid)
    {
      ctx.beginPath();
      ctx.moveTo(midX, PAD_TOP + chartH);
      for (let i = 0; i < bids.length; i++) {
        const px = priceToX(bids[i].price);
        const py = cumToY(this._smoothBidCum[i]);
        ctx.lineTo(px, py);
      }
      ctx.lineTo(priceToX(bids[bids.length - 1].price), PAD_TOP + chartH);
      ctx.closePath();

      const grad = ctx.createLinearGradient(PAD_LEFT, 0, midX, 0);
      grad.addColorStop(0,   theme.obBidFill.replace('0.18', '0.04'));
      grad.addColorStop(0.7, theme.obBidFill);
      grad.addColorStop(1,   theme.obBidFill.replace('0.18', '0.30'));
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.strokeStyle = theme.obBidLine;
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.moveTo(midX, PAD_TOP + chartH);
      for (let i = 0; i < bids.length; i++) {
        const px = priceToX(bids[i].price);
        const py = cumToY(this._smoothBidCum[i]);
        ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    // ask area (right of mid)
    {
      ctx.beginPath();
      ctx.moveTo(midX, PAD_TOP + chartH);
      for (let i = 0; i < asks.length; i++) {
        const px = priceToX(asks[i].price);
        const py = cumToY(this._smoothAskCum[i]);
        ctx.lineTo(px, py);
      }
      ctx.lineTo(priceToX(asks[asks.length - 1].price), PAD_TOP + chartH);
      ctx.closePath();

      const grad = ctx.createLinearGradient(midX, 0, W - PAD_RIGHT, 0);
      grad.addColorStop(0,   theme.obAskFill.replace('0.18', '0.30'));
      grad.addColorStop(0.3, theme.obAskFill);
      grad.addColorStop(1,   theme.obAskFill.replace('0.18', '0.04'));
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.strokeStyle = theme.obAskLine;
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.moveTo(midX, PAD_TOP + chartH);
      for (let i = 0; i < asks.length; i++) {
        const px = priceToX(asks[i].price);
        const py = cumToY(this._smoothAskCum[i]);
        ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    // walls
    this._drawWalls(ctx, bids, asks, priceToX, cumToY, timestamp, theme, PAD_TOP, chartH);

    // mid price line
    ctx.strokeStyle = theme.axis;
    ctx.lineWidth   = 1;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.moveTo(midX, PAD_TOP);
    ctx.lineTo(midX, PAD_TOP + chartH);
    ctx.stroke();
    ctx.setLineDash([]);

    // price axis labels
    this._drawPriceLabels(ctx, bids, asks, priceToX, priceMin, priceMax, W, H, PAD_TOP, PAD_BOTTOM, chartH, theme);

    // header
    this._drawHeader(ctx, mid, W, theme);
  }

  _drawWalls(ctx, bids, asks, priceToX, cumToY, timestamp, theme, padTop, chartH) {
    const drawWall = (level, cum, color) => {
      if (!level.isWall) return;
      const px = priceToX(level.price);
      const py = cumToY(cum);
      const pulse = 0.55 + 0.35 * Math.sin(timestamp * 0.004 + level.wallPhase);

      ctx.strokeStyle = color;
      ctx.lineWidth   = 2.5;
      ctx.globalAlpha = pulse;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px, padTop + chartH);
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Radar ping
      if (level.pingA > 0) {
        ctx.strokeStyle = color;
        ctx.lineWidth   = 1;
        ctx.globalAlpha = level.pingA * 0.6;
        ctx.beginPath();
        ctx.arc(px, py, level.pingR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    };

    let bidCum = 0;
    for (const b of bids) {
      bidCum += b.size;
      drawWall(b, bidCum, this.engine.theme.obBidLine);
    }
    let askCum = 0;
    for (const a of asks) {
      askCum += a.size;
      drawWall(a, askCum, this.engine.theme.obAskLine);
    }
  }

  _drawPriceLabels(ctx, bids, asks, priceToX, priceMin, priceMax, W, H, padTop, padBottom, chartH, theme) {
    ctx.font         = '9px "IBM Plex Mono", monospace';
    ctx.textBaseline = 'top';
    ctx.textAlign    = 'center';
    ctx.fillStyle    = theme.textSub;

    const labelCount = 5;
    for (let i = 0; i <= labelCount; i++) {
      const price = priceMin + (priceMax - priceMin) * (i / labelCount);
      const x     = priceToX(price);
      if (x < 24 || x > W - 24) continue;
      ctx.fillText(
        formatPrice(price).replace(/,/g, '').slice(-7),
        x,
        H - padBottom + 4
      );
    }
  }

  _drawHeader(ctx, mid, W, theme) {
    ctx.fillStyle    = theme.textSub;
    ctx.font         = '9px "IBM Plex Mono", monospace';
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('ORDER BOOK DEPTH', 8, 8);

    ctx.fillStyle    = theme.text;
    ctx.font         = '500 11px "IBM Plex Mono", monospace';
    ctx.textAlign    = 'right';
    ctx.fillText(formatPrice(mid), W - 8, 8);
  }
}
