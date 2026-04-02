import { randn, lerp } from './utils.js';

// ── Theme definitions ─────────────────────────────────────────────────────

export const THEMES = {
  dark: {
    bg:           '#0e0e0e',
    surface:      '#141414',
    border:       '#242424',
    text:         '#dedad4',
    textSub:      '#4a4744',
    textDim:      '#2a2826',
    grid:         'rgba(255,255,255,0.04)',
    axis:         'rgba(255,255,255,0.18)',
    crosshair:    'rgba(255,255,255,0.28)',
    tooltip:      'rgba(18,17,16,0.96)',
    volume:       'rgba(140,136,130,0.28)',
    priceLine:    'rgba(200,196,190,0.45)',
    priceTag:     '#1e1d1c',
    obBidFill:    'rgba(74,148,99,0.18)',
    obAskFill:    'rgba(192,57,43,0.18)',
    obBidLine:    'rgba(74,148,99,0.7)',
    obAskLine:    'rgba(192,57,43,0.7)',
    bbFill:       'rgba(160,156,150,0.05)',
    bbLine:       'rgba(160,156,150,0.35)',
    macdLine:     '#8ba8c4',
    signalLine:   '#c4a87a',
    rsiLine:      '#a0946a',
    rsiOB:        'rgba(192,57,43,0.08)',
    rsiOS:        'rgba(74,148,99,0.08)',
    multi5m:      'rgba(100,130,180,0.30)',
    multi1h:      'rgba(140,100,170,0.22)',
  },
  light: {
    bg:           '#f2f0eb',
    surface:      '#e8e6e1',
    border:       '#cac8c2',
    text:         '#111110',
    textSub:      '#888480',
    textDim:      '#d0cec8',
    grid:         'rgba(0,0,0,0.05)',
    axis:         'rgba(0,0,0,0.25)',
    crosshair:    'rgba(0,0,0,0.30)',
    tooltip:      'rgba(242,240,235,0.97)',
    volume:       'rgba(80,76,72,0.22)',
    priceLine:    'rgba(40,38,36,0.45)',
    priceTag:     '#e0deda',
    obBidFill:    'rgba(58,122,82,0.12)',
    obAskFill:    'rgba(168,44,34,0.12)',
    obBidLine:    'rgba(58,122,82,0.65)',
    obAskLine:    'rgba(168,44,34,0.65)',
    bbFill:       'rgba(80,76,72,0.05)',
    bbLine:       'rgba(80,76,72,0.30)',
    macdLine:     '#4a6888',
    signalLine:   '#8a6030',
    rsiLine:      '#7a6840',
    rsiOB:        'rgba(168,44,34,0.08)',
    rsiOS:        'rgba(58,122,82,0.08)',
    multi5m:      'rgba(60,90,150,0.20)',
    multi1h:      'rgba(100,60,140,0.15)',
  },
};

// ── Candle palette definitions ────────────────────────────────────────────

export const PALETTES = {
  classic:  { bull: '#4a9463', bear: '#c0392b' },
  slate:    { bull: '#5b7fa6', bear: '#a0522d' },
  mono:     { bull: '#c8c4bc', bear: '#484644' },
  coral:    { bull: '#e08060', bear: '#6080e0' },
  sage:     { bull: '#7aab8a', bear: '#ab7a7a' },
};

// ── DataEngine ────────────────────────────────────────────────────────────

export class DataEngine {
  constructor() {
    this.themeName   = 'dark';
    this.paletteName = 'classic';
    this.theme       = THEMES.dark;
    this.palette     = PALETTES.classic;

    this.candles1m = [];
    this.candles5m = [];
    this.candles1h = [];
    this.currentTimeframe = '1m';

    this.orderBook = { bids: [], asks: [] };

    this._liveCandle      = null;
    this._candleStartTs   = null;
    this._vol             = 0.003;  // current per-candle volatility

    this._generate();
    this._initOrderBook();
  }

  // ── Theme / palette ────────────────────────────────────────────────────

  setTheme(name) {
    this.themeName = name;
    this.theme = THEMES[name];
  }

  setPalette(name) {
    this.paletteName = name;
    this.palette = PALETTES[name];
  }

  // ── Price simulation ───────────────────────────────────────────────────

  _generate() {
    const COUNT    = 520;
    const CANDLE_MS = 60_000;
    const drift    = 0.000008;
    const now      = Date.now();
    const t0       = now - COUNT * CANDLE_MS;

    let price = 43_200 + (Math.random() - 0.5) * 3000;
    let vol   = 0.003;

    this.candles1m = [];

    for (let i = 0; i < COUNT; i++) {
      const time = t0 + i * CANDLE_MS;
      const open = price;

      // GBM step
      const Z = randn();
      const logR = drift + vol * Z;
      const close = open * Math.exp(logR);

      // Intra-candle high/low excursions
      const excursion = Math.abs(randn()) * Math.abs(close - open) * (0.5 + Math.random());
      const high = Math.max(open, close) + excursion;
      const low  = Math.min(open, close) - excursion * (0.5 + Math.random() * 0.5);

      // Volume: log-normal, correlated with move size
      const lv = 7.5 + Math.random() * 2.0;
      const volume = Math.exp(lv) * (1 + Math.abs(logR) * 60);

      this.candles1m.push({ time, open, high, low: Math.max(1, low), close, volume });

      // GARCH-style vol update
      vol = 0.0001 + 0.84 * vol + 0.12 * Math.abs(logR);
      vol = clamp(vol, 0.0008, 0.018);
      this._vol = vol;

      price = close;
    }

    this.candles5m = this._aggregate(this.candles1m, 5);
    this.candles1h = this._aggregate(this.candles1m, 60);

    const last = this.candles1m[this.candles1m.length - 1];
    this._liveCandle = this._newLive(last.close, last.time + CANDLE_MS);
  }

  _aggregate(src, n) {
    const out = [];
    for (let i = 0; i + n <= src.length; i += n) {
      const slice = src.slice(i, i + n);
      out.push({
        time:   slice[0].time,
        open:   slice[0].open,
        high:   Math.max(...slice.map(c => c.high)),
        low:    Math.min(...slice.map(c => c.low)),
        close:  slice[slice.length - 1].close,
        volume: slice.reduce((s, c) => s + c.volume, 0),
      });
    }
    return out;
  }

  _newLive(price, time) {
    return { time, open: price, high: price, low: price, close: price, volume: 0, isLive: true };
  }

  // ── Per-frame tick (60fps) ─────────────────────────────────────────────

  tick(timestamp) {
    if (this._candleStartTs === null) this._candleStartTs = timestamp;

    const lc  = this._liveCandle;
    const dt  = 1 / 60;

    // Ornstein-Uhlenbeck process: mean-reverts toward open
    const theta = 0.04;
    const sigma = lc.open * this._vol * 0.4;
    const dW    = randn() * Math.sqrt(dt);
    const dp    = theta * (lc.open - lc.close) * dt + sigma * dW;

    lc.close = lc.close + dp;
    lc.high  = Math.max(lc.high, lc.close);
    lc.low   = Math.min(lc.low,  lc.close);
    lc.volume += Math.abs(dp / lc.open) * lc.open * 8000;

    // Finalize candle every ~5 seconds real-time (=300 frames)
    const CANDLE_FRAMES = 300;
    if (timestamp - this._candleStartTs > CANDLE_FRAMES * (1000 / 60)) {
      this._candleStartTs = timestamp;

      // Persist
      this.candles1m.push({ ...lc, isLive: false });
      if (this.candles1m.length > 600) this.candles1m.shift();

      // Re-aggregate (cheap for 600 candles)
      this.candles5m = this._aggregate(this.candles1m, 5);
      this.candles1h = this._aggregate(this.candles1m, 60);

      // New live candle
      this._liveCandle = this._newLive(lc.close, lc.time + 60_000);

      // Drift vol
      this._vol = clamp(this._vol * 0.95 + 0.003 * 0.05 + Math.abs(randn()) * 0.0002, 0.001, 0.015);
    }
  }

  // ── Accessors ──────────────────────────────────────────────────────────

  getCandles(tf) {
    const base = tf === '5m' ? this.candles5m : tf === '1h' ? this.candles1h : this.candles1m;
    return [...base, this._liveCandle];
  }

  getLiveCandle()    { return this._liveCandle; }
  getCurrentPrice()  { return this._liveCandle.close; }

  get24hStats() {
    const candles = this.candles1m;
    if (candles.length < 2) return { open: 0, high: 0, low: 0, volume: 0 };
    const open   = candles[0].open;
    const high   = Math.max(...candles.map(c => c.high));
    const low    = Math.min(...candles.map(c => c.low));
    const volume = candles.reduce((s, c) => s + c.volume, 0);
    return { open, high, low, volume };
  }

  // ── Order book ─────────────────────────────────────────────────────────

  _initOrderBook() {
    this._rebuildBook();
  }

  _rebuildBook() {
    const mid = this.getCurrentPrice();
    const bids = [], asks = [];

    for (let i = 1; i <= 50; i++) {
      const bp = mid * (1 - i * 0.00042);
      const ap = mid * (1 + i * 0.00042);
      const base = Math.exp(1.8 + Math.random() * 2.2) / Math.pow(i, 0.45);
      bids.push({ price: bp, size: base,                  targetSize: base,                  isWall: false, pingR: 0, pingA: 0, wallPhase: 0 });
      asks.push({ price: ap, size: base * (0.7 + Math.random() * 0.6), targetSize: base, isWall: false, pingR: 0, pingA: 0, wallPhase: 0 });
    }

    // Inject walls
    const wc = 3 + Math.floor(Math.random() * 4);
    for (let w = 0; w < wc; w++) {
      const side = Math.random() < 0.5 ? bids : asks;
      const idx  = 2 + Math.floor(Math.random() * 18);
      if (side[idx] && !side[idx].isWall) {
        side[idx].size       *= (10 + Math.random() * 22);
        side[idx].targetSize  = side[idx].size;
        side[idx].isWall      = true;
        side[idx].wallPhase   = Math.random() * Math.PI * 2;
        side[idx].wallLife    = 6000 + Math.random() * 14000;
        side[idx].wallBorn    = Date.now();
        side[idx].pingR       = 0;
        side[idx].pingA       = 1;
      }
    }

    this.orderBook.bids = bids;
    this.orderBook.asks = asks;
  }

  tickOrderBook() {
    const mid  = this.getCurrentPrice();
    const now  = Date.now();
    const book = this.orderBook;

    for (let i = 0; i < book.bids.length; i++) {
      book.bids[i].price = mid * (1 - (i + 1) * 0.00042);
      book.bids[i].size  = Math.max(5, book.bids[i].size * (0.96 + Math.random() * 0.08));
      if (book.bids[i].isWall && now - book.bids[i].wallBorn > book.bids[i].wallLife) {
        book.bids[i].isWall = false;
        book.bids[i].size   = Math.exp(1.8 + Math.random() * 2.2) / Math.pow(i + 1, 0.45);
      }
      if (book.bids[i].pingA > 0) {
        book.bids[i].pingR += 1.2;
        book.bids[i].pingA  = Math.max(0, book.bids[i].pingA - 0.035);
      }
    }

    for (let i = 0; i < book.asks.length; i++) {
      book.asks[i].price = mid * (1 + (i + 1) * 0.00042);
      book.asks[i].size  = Math.max(5, book.asks[i].size * (0.96 + Math.random() * 0.08));
      if (book.asks[i].isWall && now - book.asks[i].wallBorn > book.asks[i].wallLife) {
        book.asks[i].isWall = false;
        book.asks[i].size   = Math.exp(1.8 + Math.random() * 2.2) / Math.pow(i + 1, 0.45);
      }
      if (book.asks[i].pingA > 0) {
        book.asks[i].pingR += 1.2;
        book.asks[i].pingA  = Math.max(0, book.asks[i].pingA - 0.035);
      }
    }

    // Stochastically spawn new wall
    if (Math.random() < 0.06) {
      const side = Math.random() < 0.5 ? book.bids : book.asks;
      const idx  = 2 + Math.floor(Math.random() * 16);
      if (side[idx] && !side[idx].isWall) {
        side[idx].size      *= (12 + Math.random() * 20);
        side[idx].isWall     = true;
        side[idx].wallPhase  = Math.random() * Math.PI * 2;
        side[idx].wallLife   = 5000 + Math.random() * 10000;
        side[idx].wallBorn   = now;
        side[idx].pingR      = 0;
        side[idx].pingA      = 1;
      }
    }
  }

  // ── Volume profile ─────────────────────────────────────────────────────

  getVolumeProfile(priceMin, priceMax, buckets = 60) {
    if (priceMax <= priceMin) return [];
    const step    = (priceMax - priceMin) / buckets;
    const profile = new Float64Array(buckets);

    for (const c of this.candles1m) {
      const mid    = (c.high + c.low) / 2;
      const bucket = Math.floor((mid - priceMin) / step);
      if (bucket >= 0 && bucket < buckets) profile[bucket] += c.volume;
    }

    const max = Math.max(...profile);
    return Array.from(profile).map((vol, i) => ({
      price:          priceMin + (i + 0.5) * step,
      volume:         vol,
      normalizedHeat: max > 0 ? vol / max : 0,
    }));
  }

  // ── Footprint data ─────────────────────────────────────────────────────
  // Returns per-price-tick bid/ask volumes for a single candle.
  // Uses a seeded PRNG so the same candle always gives the same data.

  getFootprintData(candle, numRows = 12) {
    const rand     = this._seededRand(candle.time);
    const priceRange = candle.high - candle.low;
    if (priceRange < 0.0001) return [];
    const tickSize = priceRange / numRows;
    const isBull   = candle.close >= candle.open;
    const volRow   = candle.volume / numRows;
    const rows     = [];

    for (let i = 0; i < numRows; i++) {
      const price = candle.low + (i + 0.5) * tickSize;
      // More volume near the close level
      const dist    = 1 - Math.abs(price - candle.close) / priceRange;
      const rowVol  = volRow * Math.max(0.15, dist * 1.6 + rand() * 0.5);
      // Delta bias tilted by candle direction
      const bias    = isBull ? 0.54 : 0.46;
      const askRatio = clamp(bias + (rand() - 0.5) * 0.5, 0.12, 0.88);
      const ask = rowVol * askRatio;
      const bid = rowVol * (1 - askRatio);
      rows.push({ price, bid, ask, delta: ask - bid });
    }
    return rows;
  }

  // Park-Miller LCG seeded random generator
  _seededRand(seed) {
    let s = Math.abs(seed % 2147483647) || 1;
    return () => {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
