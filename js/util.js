/* ============ util.js — RNG, noise, math helpers, binary heap ============ */
window.RTS = window.RTS || {};

RTS.util = (function () {
  'use strict';

  /* Deterministic PRNG (mulberry32). The simulation must only ever use
     the state-owned instance so multiplayer clients stay in sync. */
  function Mulberry32(seed) {
    this.s = seed >>> 0;
  }
  Mulberry32.prototype.next = function () {
    let t = (this.s += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  Mulberry32.prototype.range = function (a, b) { return a + this.next() * (b - a); };
  Mulberry32.prototype.int = function (a, b) { return Math.floor(this.range(a, b + 1)); };
  Mulberry32.prototype.pick = function (arr) { return arr[Math.floor(this.next() * arr.length)]; };

  /* Value-noise + fbm for terrain generation */
  function makeNoise(rng, size) {
    size = size || 256;
    const grid = new Float32Array(size * size);
    for (let i = 0; i < grid.length; i++) grid[i] = rng.next();
    const mask = size - 1;
    function smooth(t) { return t * t * (3 - 2 * t); }
    function at(x, y) { return grid[(y & mask) * size + (x & mask)]; }
    function noise2(x, y) {
      const xi = Math.floor(x), yi = Math.floor(y);
      const xf = x - xi, yf = y - yi;
      const u = smooth(xf), v = smooth(yf);
      const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    }
    function fbm(x, y, oct, lac, gain) {
      oct = oct || 4; lac = lac || 2; gain = gain || 0.5;
      let amp = 1, freq = 1, sum = 0, norm = 0;
      for (let o = 0; o < oct; o++) {
        sum += amp * noise2(x * freq, y * freq);
        norm += amp;
        amp *= gain; freq *= lac;
      }
      return sum / norm;
    }
    return { noise2: noise2, fbm: fbm };
  }

  /* Binary min-heap for A* */
  function Heap(scoreFn) {
    this.items = [];
    this.score = scoreFn;
  }
  Heap.prototype.push = function (item) {
    this.items.push(item);
    this._up(this.items.length - 1);
  };
  Heap.prototype.pop = function () {
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0) {
      this.items[0] = last;
      this._down(0);
    }
    return top;
  };
  Heap.prototype._up = function (i) {
    const item = this.items[i], s = this.score(item);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.score(this.items[p]) <= s) break;
      this.items[i] = this.items[p];
      i = p;
    }
    this.items[i] = item;
  };
  Heap.prototype._down = function (i) {
    const n = this.items.length, item = this.items[i], s = this.score(item);
    for (;;) {
      let c = i * 2 + 1;
      if (c >= n) break;
      if (c + 1 < n && this.score(this.items[c + 1]) < this.score(this.items[c])) c++;
      if (this.score(this.items[c]) >= s) break;
      this.items[i] = this.items[c];
      i = c;
    }
    this.items[i] = item;
  };
  Object.defineProperty(Heap.prototype, 'size', { get: function () { return this.items.length; } });

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }
  function dist(ax, ay, bx, by) { return Math.sqrt(dist2(ax, ay, bx, by)); }

  /* Uint8Array <-> base64 (for compact save files) */
  function u8ToB64(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }
  function b64ToU8(b64) {
    const s = atob(b64);
    const u8 = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
    return u8;
  }

  function fmtTime(sec) {
    sec = Math.floor(sec);
    const m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  return {
    Mulberry32: Mulberry32,
    makeNoise: makeNoise,
    Heap: Heap,
    clamp: clamp, lerp: lerp, dist: dist, dist2: dist2,
    u8ToB64: u8ToB64, b64ToU8: b64ToU8,
    fmtTime: fmtTime
  };
})();
