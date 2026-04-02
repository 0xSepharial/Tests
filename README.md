# Canvas Trading Terminal

A zero-dependency, pure HTML5 Canvas crypto trading terminal demo. Every pixel is drawn programmatically — no charting libraries, no frameworks, no build step.

## Features

- **Live Candlestick Chart** — OHLC rendering with animated live candle, smooth pan (with momentum) and scroll-wheel zoom
- **Bollinger Bands** — 20-period, 2σ, drawn natively with canvas fill between bands
- **Volume Profile Heatmap** — animated side strip showing where price has spent most time, colour-coded by density
- **Multi-timeframe Overlay** — toggle MULTI to see 5m and 1h candle outlines overlaid on 1m data (temporal nesting)
- **Order Book Depth Chart** — live bid/ask cumulative curves with gradient fills, animated walls and radar-ping spawns
- **MACD + RSI sub-panels** — computed entirely in JS (EMA, Wilder smoothing), rendered on canvas with no external dependencies
- **5 candle colour palettes** — Classic · Slate · Monochrome · Coral · Sage
- **Dark / light theme** toggle

## Running locally

Because ES modules are used, a local server is required (browsers block `file://` module imports):

```bash
# Python 3
python3 -m http.server 8080

# Node (npx)
npx serve .
```

Then open `http://localhost:8080` in any modern browser.

## Controls

| Action | Result |
|---|---|
| Drag | Pan chart left / right |
| Scroll wheel | Zoom in / out around cursor |
| Hover | Crosshair + OHLCV tooltip |
| 1M / 5M / 1H buttons | Switch timeframe |
| MULTI button | Toggle multi-timeframe overlay |
| Palette swatches | Change candle colours |
| BB / MACD / RSI / VOL PROFILE | Toggle individual indicators |
| ◐ button | Toggle dark / light theme |

## Architecture

```
js/
  data.js         — DataEngine: GBM + GARCH price simulation, order book, volume profile
  utils.js        — Pure helpers: coord mapping, formatting, colour interpolation
  candlestick.js  — Main chart: candles, volume bars, BB, heatmap strip, pan/zoom
  orderbook.js    — Depth chart: cumulative curves, wall animations
  indicators.js   — MACD + RSI sub-panels
  main.js         — Single RAF loop, resize handler, UI event wiring
```

All simulation is local — no network calls are made beyond loading the `IBM Plex Mono` font from Google Fonts.
