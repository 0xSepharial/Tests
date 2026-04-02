import { DataEngine } from './data.js';
import { CandlestickChart } from './candlestick.js';
import { OrderbookChart } from './orderbook.js';
import { IndicatorPanel } from './indicators.js';
import { DrawingToolManager } from './tools.js';
import { FeedManager } from './feed.js';
import { formatPrice, formatVolume } from './utils.js';

// ── DOM references ────────────────────────────────────────────────────────

const mainCanvas    = document.getElementById('canvas-main');
const overlayCanvas = document.getElementById('canvas-overlay');
const obCanvas      = document.getElementById('canvas-orderbook');
const indCanvas     = document.getElementById('canvas-indicators');
const mainCol       = document.getElementById('main-column');

const elPrice  = document.getElementById('live-price');
const elChange = document.getElementById('price-change');
const elVol    = document.getElementById('stat-vol');
const elHigh   = document.getElementById('stat-high');
const elLow    = document.getElementById('stat-low');
const elSpread = document.getElementById('stat-spread');

// ── Initialise ────────────────────────────────────────────────────────────

const engine     = new DataEngine();
const chart      = new CandlestickChart(mainCanvas, overlayCanvas, engine);
const orderbook  = new OrderbookChart(obCanvas, engine);
const indicators = new IndicatorPanel(indCanvas, engine);
const tools      = new DrawingToolManager(engine);
const feed       = new FeedManager();

chart.setToolManager(tools);
feed.mount(
  document.getElementById('popup-container'),
  document.getElementById('feed-panel')
);

// ── Canvas sizing ─────────────────────────────────────────────────────────

function setSize(canvas, w, h) {
  const dpr     = window.devicePixelRatio || 1;
  canvas.width  = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas._lw = w;
  canvas._lh = h;
}

function resizeAll() {
  const mr = mainCol.getBoundingClientRect();
  setSize(mainCanvas,    mr.width, mr.height);
  setSize(overlayCanvas, mr.width, mr.height);
  chart.onResize(mr.width, mr.height);

  const or = obCanvas.getBoundingClientRect();
  setSize(obCanvas, or.width, or.height);
  orderbook.onResize(or.width, or.height);

  const ir = indCanvas.getBoundingClientRect();
  setSize(indCanvas, ir.width, ir.height);
  indicators.onResize(ir.width, ir.height);
}

window.addEventListener('resize', resizeAll);
document.fonts.ready.then(() => { resizeAll(); requestAnimationFrame(loop); });

// ── Order book tick ───────────────────────────────────────────────────────

setInterval(() => engine.tickOrderBook(), 200);

// ── Header update ─────────────────────────────────────────────────────────

let _prevPrice = null, _openPrice = null;

function updateHeader() {
  const price = engine.getCurrentPrice();
  const stats = engine.get24hStats();
  if (_openPrice === null) _openPrice = stats.open;

  if (_prevPrice !== null && price !== _prevPrice) {
    const cls = price > _prevPrice ? 'flash-up' : 'flash-down';
    elPrice.classList.remove('flash-up', 'flash-down');
    void elPrice.offsetWidth;
    elPrice.classList.add(cls);
    setTimeout(() => elPrice.classList.remove(cls), 400);
  }
  elPrice.textContent = formatPrice(price);
  _prevPrice = price;

  const changePct = ((price - _openPrice) / _openPrice) * 100;
  elChange.textContent = (changePct >= 0 ? '+' : '') + changePct.toFixed(2) + '%';
  elChange.className   = changePct >= 0 ? 'up' : 'down';

  elVol.textContent  = formatVolume(stats.volume);
  elHigh.textContent = formatPrice(stats.high);
  elLow.textContent  = formatPrice(stats.low);

  const book = engine.orderBook;
  if (book.asks.length && book.bids.length) {
    const spread    = book.asks[0].price - book.bids[0].price;
    const spreadBps = (spread / price * 10000).toFixed(1);
    elSpread.textContent = formatPrice(spread) + ' (' + spreadBps + 'bp)';
  }
}

// ── RAF loop ──────────────────────────────────────────────────────────────

function loop(timestamp) {
  engine.tick(timestamp);
  updateHeader();
  chart.render(timestamp);
  orderbook.render(timestamp);
  indicators.render(timestamp);
  feed.tick();
  requestAnimationFrame(loop);
}

// ── Sidebar — drawing tools ───────────────────────────────────────────────

const sbBtns    = document.querySelectorAll('.sb-btn[data-tool]');
const magnetBtn = document.getElementById('magnet-btn');
const clearBtn  = document.getElementById('clear-btn');
const textInput = document.getElementById('text-input');

sbBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const tool = btn.dataset.tool;

    if (tool === 'text') {
      // Show floating text input at current cursor position
      activateTool(btn, tool);
      return;
    }

    activateTool(btn, tool);
    mainCanvas.style.cursor = tool === 'pointer' ? 'default' : 'crosshair';
  });
});

function activateTool(btn, tool) {
  sbBtns.forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  tools.setTool(tool);
}

// Magnet toggle (not a drawing tool, separate button)
if (magnetBtn) {
  magnetBtn.addEventListener('click', () => {
    const on = tools.toggleMagnet();
    magnetBtn.classList.toggle('magnet-on', on);
  });
}

// Clear all drawings
if (clearBtn) {
  clearBtn.addEventListener('click', () => {
    tools.clearAll();
  });
}

// Text annotation: show floating input where user clicks on chart
mainCanvas.addEventListener('click', e => {
  if (tools.activeTool !== 'text') return;
  const r    = mainCanvas.getBoundingClientRect();
  const dpr  = window.devicePixelRatio || 1;

  textInput.style.display = 'block';
  textInput.style.left    = (e.clientX + 4) + 'px';
  textInput.style.top     = (e.clientY - 16) + 'px';
  textInput.value         = '';
  textInput.focus();

  const clickX = e.clientX - r.left;
  const clickY = e.clientY - r.top;

  const onCommit = () => {
    const text = textInput.value.trim();
    if (text) {
      // Place drawing directly with the text
      const cW   = mainCol.getBoundingClientRect().width - 74 - 68; // approx chart width
      const cH   = mainCol.getBoundingClientRect().height - 22;
      const time  = chart.vp.timeStart + (clickX / cW) * (chart.vp.timeEnd - chart.vp.timeStart);
      const price = chart.vp.priceMin  + ((cH - clickY) / cH) * (chart.vp.priceMax - chart.vp.priceMin);
      const pt    = { x: clickX, y: clickY, time, price };
      const d     = { tool: 'text', p1: pt, p2: pt, p3: pt, text };
      tools.drawings.push(d);
    }
    textInput.style.display = 'none';
    textInput.removeEventListener('keydown', onKey);
    textInput.removeEventListener('blur', onCommit);
  };

  const onKey = e => {
    if (e.key === 'Enter' || e.key === 'Escape') onCommit();
  };

  textInput.addEventListener('keydown', onKey);
  textInput.addEventListener('blur', onCommit);
});

// Keyboard shortcuts for common tools
window.addEventListener('keydown', e => {
  if (e.target === textInput) return;
  const map = { v: 'pointer', c: 'crosshair', t: 'trendline', h: 'hline', f: 'fib', r: 'rect', m: 'measure' };
  const tool = map[e.key.toLowerCase()];
  if (!tool) return;
  const btn = document.querySelector(`.sb-btn[data-tool="${tool}"]`);
  if (btn) btn.click();
});

// ── Orderbook / Feed tab toggle ───────────────────────────────────────────

document.querySelectorAll('.ob-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.ob-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    obCanvas.style.display      = tab === 'depth' ? 'block' : 'none';
    document.getElementById('feed-panel').classList.toggle('visible', tab === 'feed');
  });
});

// ── Footprint toggle ──────────────────────────────────────────────────────

const footprintBtn = document.getElementById('footprint-btn');
if (footprintBtn) {
  footprintBtn.addEventListener('click', () => {
    footprintBtn.classList.toggle('active');
    chart.setFootprintMode(footprintBtn.classList.contains('active'));
  });
}

// ── Theme toggle ──────────────────────────────────────────────────────────

document.getElementById('theme-toggle').addEventListener('click', () => {
  const isLight = document.documentElement.classList.toggle('light');
  engine.setTheme(isLight ? 'light' : 'dark');
});

// ── Timeframe buttons ─────────────────────────────────────────────────────

document.querySelectorAll('.tf-btn[data-tf]').forEach(btn => {
  btn.addEventListener('click', () => {
    const tf = btn.dataset.tf;
    if (tf === 'multi') {
      btn.classList.toggle('active');
      chart.toggleMultiframe();
      return;
    }
    document.querySelectorAll('.tf-btn[data-tf]').forEach(b => {
      if (b.dataset.tf !== 'multi') b.classList.remove('active');
    });
    btn.classList.add('active');
    engine.currentTimeframe = tf;
    chart.setTimeframe(tf);
  });
});

// ── Palette buttons ───────────────────────────────────────────────────────

document.querySelectorAll('.pal-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.pal-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    engine.setPalette(btn.dataset.pal);
  });
});

// ── Indicator toggles ─────────────────────────────────────────────────────

document.querySelectorAll('.ind-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    btn.classList.toggle('active');
    const on  = btn.classList.contains('active');
    const ind = btn.dataset.ind;
    chart.setIndicator(ind, on);
    indicators.setIndicator(ind, on);
  });
});
