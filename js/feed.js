// cat svg avatars
function catSVG(fur, inner, pupil = '#111116') {
  return `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
    <polygon points="4,17 8,4 14,15" fill="${fur}"/>
    <polygon points="28,17 24,4 18,15" fill="${fur}"/>
    <polygon points="6.5,15.5 9,7 13,14" fill="${inner}"/>
    <polygon points="25.5,15.5 23,7 19,14" fill="${inner}"/>
    <circle cx="16" cy="19" r="12" fill="${fur}"/>
    <ellipse cx="12" cy="18" rx="2.2" ry="2.8" fill="${pupil}"/>
    <ellipse cx="20" cy="18" rx="2.2" ry="2.8" fill="${pupil}"/>
    <circle cx="12.9" cy="16.8" r="0.9" fill="rgba(255,255,255,0.75)"/>
    <circle cx="20.9" cy="16.8" r="0.9" fill="rgba(255,255,255,0.75)"/>
    <polygon points="16,21.5 14.8,23.2 17.2,23.2" fill="#c07878"/>
    <path d="M14.8,23.2 Q16,24.8 17.2,23.2" fill="none" stroke="#c07878" stroke-width="0.7"/>
    <line x1="4.5" y1="20.5" x2="12" y2="21.8" stroke="rgba(255,255,255,0.45)" stroke-width="0.7"/>
    <line x1="4.5" y1="22.5" x2="12" y2="23"   stroke="rgba(255,255,255,0.45)" stroke-width="0.7"/>
    <line x1="27.5" y1="20.5" x2="20" y2="21.8" stroke="rgba(255,255,255,0.45)" stroke-width="0.7"/>
    <line x1="27.5" y1="22.5" x2="20" y2="23"   stroke="rgba(255,255,255,0.45)" stroke-width="0.7"/>
  </svg>`;
}

// account definitions
export const ACCOUNTS = {
  azi:      { handle: '@azi',      avatar: catSVG('#d4834a','#f0a868'), color: '#d4834a' },
  dennis:   { handle: '@dennis',   avatar: catSVG('#282830','#383840'), color: '#8888a0' },
  insilico: { handle: '@insilico', avatar: catSVG('#6888a0','#8aaec4'), color: '#6888a0' },
  pain:     { handle: '@pain',     avatar: catSVG('#887888','#a89ab0'), color: '#887888' },
  jim:      { handle: '@jim',      avatar: catSVG('#b07830','#d49848'), color: '#b07830' },
};

// tweet content pools
const TWEETS = {
  azi: [
    '43.2k is the line. holding above = bullish. lose it = pain zone.',
    'that CVD divergence on the 1h is actually wild rn',
    'bid wall at 42.8k getting absorbed. watching closely.',
    'volume profile shows heavy HVN at 43k–43.5k. confluence.',
    '1h RSI reset, ready to go again imo',
    'watching the order flow. big size accumulating quietly at these levels.',
    'breaker block holding perfectly. textbook.',
    'three touches on that trend line. respect it.',
    'VWAP reclaim on the daily. structure shift.',
    'funding rate cooling off — healthy reset before continuation.',
    'order book looks thin above 44.2k. fast move if it breaks.',
    'that imbalance from last week finally got filled. clean.',
  ],
  dennis: [
    'WE ARE SO BACK',
    'bro the chart is literally going up wtf',
    'called this at 42k check my history 📈',
    'if you didn\'t buy the dip you hate money (joking) (mostly)',
    'up only (trust me bro)',
    'my portfolio is green again i might actually cry',
    'bought the dip. again. this is just my life now.',
    'the chart does not care about my feelings and that\'s fair',
    'i have no idea what i\'m doing and i\'m up 40% somehow',
    'when the bid wall disappears 💀',
    'bro just zoom out and relax',
    'every dip is a gift if you think about it',
  ],
  insilico: [
    'model output: 71% probability of upside continuation in next 4h window.',
    'realized vol drifting below implied. classic pre-move compression.',
    'deploying mean-reversion strategy. backtest sharpe: 2.1.',
    'on-chain metrics diverging from spot price. watching.',
    'funding rate normalization incoming per regime model.',
    'correlation matrix shifted overnight. adjusting portfolio weights.',
    'Kelly criterion says 12% position size. running 8% to be safe.',
    'LSTM flagging potential regime change. reducing gross exposure.',
    'implied vol surface is telling an interesting story today.',
    'basis trade looking attractive again. spreads widening.',
    'running Monte Carlo on current setup. P90 outcome: range-bound.',
    'open interest spike without price follow-through. suspicious.',
  ],
  pain: [
    'liquidated again.',
    'i am the exit liquidity.',
    'bought the top. sold the bottom. both in the same day.',
    'stop loss hit. pumped immediately after. every single time.',
    'why do i even look at charts',
    'down bad but make it poetic',
    'the market knows exactly where my stop is. it always does.',
    'closed for a loss. it\'s now up 8%. great.',
    'this is fine 🔥🔥🔥',
    'i should have just held. i always should have just held.',
    'i don\'t want to talk about my PnL',
    'opened a short. instant green candle. you\'re welcome everyone.',
  ],
  jim: [
    'zoom out.',
    'patience is the edge.',
    'seen this before. 2017. 2021. same story, different cycle.',
    'first rule: don\'t lose money. second rule: see rule one.',
    'the trend is your friend until the bend at the end.',
    'everyone\'s a genius in a bull market. wait for the bear.',
    'cash is a position.',
    '25 years in these markets. still learning every day.',
    'respect the tape.',
    'cut losses short. let winners run. simple. not easy.',
    'the market will humble you eventually. always does.',
    'if you can\'t sleep holding a position, the size is wrong.',
  ],
};

export class FeedManager {
  constructor() {
    this.tweets = [];          // all historical tweets, newest first
    this._popupEl = null;      // popup container DOM element
    this._feedEl = null;       // feed panel DOM element
    this._nextPopup = Date.now() + 4000 + Math.random() * 4000;  // stagger first popup so it's not instant on load
    this._popupQueue = [];       // active popup elements

    this._buildInitialFeed();
  }

  // Generate a backlog of tweets so the feed isn't empty on load
  _buildInitialFeed() {
    const users = Object.keys(TWEETS);
    const count = 30;
    let t = Date.now() - count * 45_000;
    for (let i = 0; i < count; i++) {
      const user = users[Math.floor(Math.random() * users.length)];
      this.tweets.push(this._make(user, t));
      t += 40_000 + Math.random() * 20_000;
    }
    // newest first
    this.tweets.reverse();
  }

  _make(user, time = Date.now()) {
    const pool = TWEETS[user];
    return {
      user,
      text: pool[Math.floor(Math.random() * pool.length)],
      time,
      id:   time + Math.random(),
    };
  }

  mount(popupContainer, feedPanel) {
    this._popupEl = popupContainer;
    this._feedEl  = feedPanel;
    this._renderFeed();
  }

  tick() {
    if (Date.now() < this._nextPopup) return;
    this._nextPopup = Date.now() + 8_000 + Math.random() * 16_000;

    const users = Object.keys(TWEETS);
    const user  = users[Math.floor(Math.random() * users.length)];
    const tweet = this._make(user);

    this.tweets.unshift(tweet);
    if (this.tweets.length > 200) this.tweets.pop();

    this._spawnPopup(tweet);
    this._prependToFeed(tweet);
  }

  // feed panel
  _renderFeed() {
    if (!this._feedEl) return;
    this._feedEl.innerHTML = '';
    for (const t of this.tweets) {
      this._feedEl.appendChild(this._tweetEl(t));
    }
  }

  _prependToFeed(tweet) {
    if (!this._feedEl) return;
    const el = this._tweetEl(tweet);
    el.style.opacity = '0';
    el.style.transform = 'translateY(-8px)';
    this._feedEl.prepend(el);
    requestAnimationFrame(() => {
      el.style.transition = 'opacity 0.3s, transform 0.3s';
      el.style.opacity    = '1';
      el.style.transform  = 'translateY(0)';
    });
  }

  _tweetEl(t) {
    const acc  = ACCOUNTS[t.user];
    const age  = this._age(t.time);
    const div  = document.createElement('div');
    div.className = 'tweet-item';
    div.innerHTML = `
      <div class="tweet-avatar">${acc.avatar}</div>
      <div class="tweet-body">
        <div class="tweet-meta">
          <span class="tweet-handle" style="color:${acc.color}">${acc.handle}</span>
          <span class="tweet-age">${age}</span>
        </div>
        <div class="tweet-text">${this._escape(t.text)}</div>
      </div>`;
    return div;
  }

  // popups
  _spawnPopup(tweet) {
    if (!this._popupEl) return;
    if (this._popupQueue.length >= 3) {
      // cap at 3 — more than that gets annoying fast
      const old = this._popupQueue.shift();
      old.remove();
    }

    const acc = ACCOUNTS[tweet.user];
    const el  = document.createElement('div');
    el.className = 'feed-popup';
    el.style.setProperty('--accent-color', acc.color);
    el.innerHTML = `
      <div class="popup-avatar">${acc.avatar}</div>
      <div class="popup-body">
        <span class="popup-handle" style="color:${acc.color}">${acc.handle}</span>
        <span class="popup-now">now</span>
        <div class="popup-text">${this._escape(tweet.text)}</div>
      </div>`;

    this._popupEl.appendChild(el);
    this._popupQueue.push(el);

    // Auto-dismiss after 7s
    setTimeout(() => {
      el.classList.add('popup-fade-out');
      setTimeout(() => {
        el.remove();
        const i = this._popupQueue.indexOf(el);
        if (i !== -1) this._popupQueue.splice(i, 1);
      }, 400);
    }, 7000);
  }

  // helpers
  _age(time) {
    const s = Math.floor((Date.now() - time) / 1000);
    if (s < 60)  return s + 's';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    return Math.floor(s / 3600) + 'h';
  }

  _escape(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
}
