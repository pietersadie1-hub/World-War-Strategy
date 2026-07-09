/* ============ sfx.js — synthesized sound effects (WebAudio, no assets) ============
   Gunfire, explosions, acknowledgements and alerts are generated with
   oscillators and filtered noise, routed through a lowpass + compressor
   master chain so the mix stays soft even in big battles. Sounds are
   distance-attenuated, stereo-panned by screen position and pitch-varied
   so repeated shots don't sound mechanical. Mute persists in localStorage. */
window.RTS = window.RTS || {};

RTS.sfx = (function () {
  'use strict';

  let ac = null;            // AudioContext, created on first user gesture
  let master = null;        // gain -> lowpass -> compressor -> destination
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
      master.gain.value = muted ? 0 : 0.45;
      const soften = ac.createBiquadFilter();
      soften.type = 'lowpass';
      soften.frequency.value = 6500;   // shave the harsh top end
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -22;
      comp.knee.value = 18;
      comp.ratio.value = 8;
      comp.attack.value = 0.004;
      comp.release.value = 0.2;
      master.connect(soften);
      soften.connect(comp);
      comp.connect(ac.destination);
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
    if (master) master.gain.value = m ? 0 : 0.45;
  }
  function isMuted() { return muted; }

  /* shared output leg: gain envelope -> stereo panner -> master */
  function leg(pan) {
    const g = ac.createGain();
    let tail = g;
    if (ac.createStereoPanner && pan) {
      const p = ac.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      tail = p;
    }
    tail.connect(master);
    return g;
  }

  function noise(dur, filterType, freq, q, vol, slideTo, pan, delay) {
    const t0 = ac.currentTime + (delay || 0);
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = ac.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(freq, t0);
    if (slideTo) f.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    f.Q.value = q || 1;
    const g = leg(pan);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f); f.connect(g);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  function tone(freq, dur, type, vol, slideTo, delay, pan) {
    const o = ac.createOscillator();
    o.type = type || 'triangle';
    const t0 = ac.currentTime + (delay || 0);
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    const g = leg(pan);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  /* throttled, distance-attenuated, panned play */
  function play(name, x, y) {
    if (muted || !ensureCtx()) return;
    const now = performance.now();
    const minGap = { shot: 80, cannon: 120, rocket: 140, boom: 100, ack: 130 }[name] || 70;
    if (lastPlay[name] && now - lastPlay[name] < minGap) return;
    lastPlay[name] = now;

    let vol = 1, pan = 0;
    if (x !== undefined && RTS.render) {
      const cam = RTS.render.camera;
      const d = Math.hypot(x - cam.x, y - cam.y);
      vol = Math.max(0, 1 - d / 34);
      if (vol <= 0.03) return;
      const sp = RTS.render.worldToScreen(x, y);
      const vw = RTS.render.viewSize.w || 1;
      pan = Math.max(-0.75, Math.min(0.75, (sp.x / vw) * 1.6 - 0.8));
    }
    const pv = 0.92 + Math.random() * 0.16; // pitch variation

    switch (name) {
      case 'shot':
        noise(0.08, 'bandpass', 1600 * pv, 2.2, 0.34 * vol, 500, pan);
        tone(300 * pv, 0.045, 'triangle', 0.12 * vol, 130, 0, pan);
        break;
      case 'cannon':
        noise(0.26, 'lowpass', 500 * pv, 0.8, 0.7 * vol, 80, pan);
        tone(110 * pv, 0.18, 'sine', 0.5 * vol, 40, 0, pan);
        break;
      case 'rocket':
        noise(0.38, 'bandpass', 700 * pv, 1.6, 0.4 * vol, 2000, pan);
        break;
      case 'boom':
        noise(0.7, 'lowpass', 260 * pv, 0.7, 0.9 * vol, 45, pan);
        tone(75 * pv, 0.55, 'sine', 0.65 * vol, 26, 0, pan);
        noise(0.25, 'bandpass', 900, 1, 0.2 * vol, 300, pan);
        break;
      case 'bigboom':
        noise(1.3, 'lowpass', 220 * pv, 0.7, 1.1 * vol, 34, pan);
        tone(60 * pv, 1.0, 'sine', 0.85 * vol, 22, 0, pan);
        noise(0.8, 'lowpass', 160, 0.7, 0.5 * vol, 40, pan, 0.18); // delayed rumble
        noise(0.3, 'bandpass', 1400, 1, 0.16 * vol, 400, pan);
        break;
      case 'ack':
        tone(700, 0.05, 'sine', 0.12);
        tone(1050, 0.07, 'sine', 0.1, 0, 0.055);
        break;
      case 'ready':
        tone(620, 0.1, 'triangle', 0.22);
        tone(930, 0.16, 'triangle', 0.2, 0, 0.11);
        break;
      case 'built':
        tone(520, 0.11, 'triangle', 0.22);
        tone(780, 0.11, 'triangle', 0.2, 0, 0.12);
        tone(1040, 0.2, 'triangle', 0.18, 0, 0.24);
        break;
      case 'alert':
        tone(560, 0.2, 'triangle', 0.4, 420);
        tone(560, 0.2, 'triangle', 0.4, 420, 0.27);
        break;
      case 'error':
        tone(200, 0.16, 'triangle', 0.24, 130);
        break;
      case 'capture':
        tone(440, 0.11, 'triangle', 0.22);
        tone(660, 0.11, 'triangle', 0.2, 0, 0.12);
        tone(880, 0.2, 'triangle', 0.18, 0, 0.24);
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
