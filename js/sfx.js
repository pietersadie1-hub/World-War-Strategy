/* ============ sfx.js — synthesized sound effects (WebAudio, no assets) ============
   Gunfire, explosions, acknowledgements and alerts are generated with
   oscillators and filtered noise. Volume falls off with distance from the
   camera; a mute toggle persists in localStorage. */
window.RTS = window.RTS || {};

RTS.sfx = (function () {
  'use strict';

  let ac = null;            // AudioContext, created on first user gesture
  let master = null;
  let muted = false;
  let noiseBuf = null;
  const lastPlay = {};      // throttling per sound name

  try { muted = localStorage.getItem('wws_muted') === '1'; } catch (e) {}

  function ensureCtx() {
    if (ac) {
      if (ac.state === 'suspended') ac.resume();
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      ac = new AC();
      master = ac.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ac.destination);
      /* 1s of white noise, reused by every noise-based sound */
      noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) {
      ac = null;
      return false;
    }
    return true;
  }

  /* call from the first pointer/key event — browsers gate audio on a gesture */
  function unlock() { ensureCtx(); }

  function setMuted(m) {
    muted = m;
    try { localStorage.setItem('wws_muted', m ? '1' : '0'); } catch (e) {}
    if (master) master.gain.value = m ? 0 : 0.5;
  }
  function isMuted() { return muted; }

  function noise(dur, filterType, freq, q, vol, slideTo) {
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    const f = ac.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    if (slideTo) f.frequency.exponentialRampToValueAtTime(slideTo, ac.currentTime + dur);
    f.Q.value = q || 1;
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start();
    src.stop(ac.currentTime + dur);
  }

  function tone(freq, dur, type, vol, slideTo, delay) {
    const o = ac.createOscillator();
    o.type = type || 'square';
    const t0 = ac.currentTime + (delay || 0);
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  /* throttled, distance-attenuated play */
  function play(name, x, y) {
    if (muted || !ensureCtx()) return;
    const now = performance.now();
    const minGap = { shot: 70, cannon: 110, rocket: 120, boom: 90, ack: 120 }[name] || 60;
    if (lastPlay[name] && now - lastPlay[name] < minGap) return;
    lastPlay[name] = now;

    let vol = 1;
    if (x !== undefined && RTS.render) {
      const cam = RTS.render.camera;
      const d = Math.hypot(x - cam.x, y - cam.y);
      vol = Math.max(0, 1 - d / 34);
      if (vol <= 0.03) return;
    }

    switch (name) {
      case 'shot':
        noise(0.09, 'highpass', 1800, 1, 0.5 * vol);
        break;
      case 'cannon':
        noise(0.22, 'lowpass', 420, 1, 0.9 * vol, 90);
        tone(95, 0.14, 'sine', 0.5 * vol, 42);
        break;
      case 'rocket':
        noise(0.4, 'bandpass', 900, 2, 0.55 * vol, 2400);
        break;
      case 'boom':
        noise(0.6, 'lowpass', 300, 0.8, 1.1 * vol, 55);
        tone(70, 0.5, 'sine', 0.7 * vol, 30);
        break;
      case 'bigboom':
        noise(1.1, 'lowpass', 260, 0.8, 1.3 * vol, 40);
        tone(58, 0.9, 'sine', 0.9 * vol, 24);
        noise(0.5, 'highpass', 2400, 1, 0.3 * vol);
        break;
      case 'ack':
        tone(880, 0.05, 'square', 0.16);
        tone(1320, 0.06, 'square', 0.14, 0, 0.055);
        break;
      case 'ready':
        tone(660, 0.09, 'triangle', 0.3);
        tone(990, 0.14, 'triangle', 0.3, 0, 0.1);
        break;
      case 'built':
        tone(520, 0.1, 'triangle', 0.3);
        tone(780, 0.1, 'triangle', 0.3, 0, 0.11);
        tone(1040, 0.16, 'triangle', 0.3, 0, 0.22);
        break;
      case 'alert':
        tone(620, 0.16, 'sawtooth', 0.35, 470);
        tone(620, 0.16, 'sawtooth', 0.35, 470, 0.22);
        break;
      case 'error':
        tone(180, 0.15, 'square', 0.25, 120);
        break;
      case 'capture':
        tone(440, 0.1, 'triangle', 0.3);
        tone(660, 0.1, 'triangle', 0.3, 0, 0.11);
        tone(880, 0.18, 'triangle', 0.3, 0, 0.22);
        break;
    }
  }

  let lastAlert = 0;

  /* sim event bridge (called from the main loop dispatcher) */
  function onEvent(e) {
    const state = RTS.game.state;
    switch (e.t) {
      case 'muzzle':
        play(e.kind === 'bullet' ? 'shot' : e.kind === 'rocket' ? 'rocket' : 'cannon', e.x, e.y);
        break;
      case 'explosion':
        play(e.s && e.s > 1.2 ? 'bigboom' : 'boom', e.x, e.y);
        break;
      case 'trained':
        if (state && e.owner === state.localPlayer) play('ready');
        break;
      case 'complete':
        if (state && e.owner === state.localPlayer) play('built');
        break;
      case 'capture':
        if (state && e.owner === state.localPlayer) play('capture');
        break;
      case 'nofunds':
        play('error');
        break;
      case 'attacked':
        if (state && e.owner === state.localPlayer && performance.now() - lastAlert > 12000) {
          lastAlert = performance.now();
          play('alert');
        }
        break;
      case 'aiwave':
        play('alert');
        break;
    }
  }

  return { play: play, onEvent: onEvent, unlock: unlock, setMuted: setMuted, isMuted: isMuted };
})();
