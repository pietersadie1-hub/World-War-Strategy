/* ============ net.js — WebSocket multiplayer (beta) ============
   Deterministic-lockstep-lite: both clients run the same fixed-step
   simulation from a shared seed; only player commands travel over the
   wire, scheduled a few ticks in the future. Pair it with the relay in
   server/server.js (node server/server.js). */
window.RTS = window.RTS || {};

RTS.net = (function () {
  'use strict';
  const C = RTS.config;

  let ws = null;
  let isHost = false;
  let playerIdx = 0;
  let room = '';
  let onStart = null;
  let onStatus = null;
  let active = false;

  function connect(url, roomCode, callbacks) {
    onStart = callbacks.onStart;
    onStatus = callbacks.onStatus;
    room = roomCode;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      status('Bad server address');
      return;
    }
    ws.onopen = function () {
      status('Connected — joining room "' + room + '"…');
      send({ t: 'join', room: room });
    };
    ws.onerror = function () { status('Connection failed. Is the relay server running?'); };
    ws.onclose = function () {
      if (active) {
        active = false;
        RTS.events.push({ t: 'netdrop' });
      }
      ws = null;
    };
    ws.onmessage = function (ev) {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      handle(msg);
    };
  }

  function handle(msg) {
    switch (msg.t) {
      case 'joined':
        playerIdx = msg.idx;
        isHost = msg.idx === 0;
        status(isHost ? 'Hosting room "' + room + '" — waiting for opponent…' : 'Joined — waiting for host to start…');
        break;
      case 'peer': /* second player arrived; host picks the seed */
        if (isHost) {
          const seed = (Date.now() ^ (Math.random() * 0xffffff)) & 0x7fffffff;
          send({ t: 'start', seed: seed });
          begin(seed);
        }
        break;
      case 'start':
        if (!isHost) begin(msg.seed);
        break;
      case 'cmd': {
        /* schedule opponent command; if its tick already passed, run asap */
        const st = RTS.game.state;
        if (!st) return;
        RTS.game.scheduleCmd(msg.cmd, Math.max(msg.tick, st.tick + 1));
        break;
      }
      case 'full':
        status('Room is full.');
        break;
    }
  }

  function begin(seed) {
    active = true;
    status('Starting…');
    if (onStart) onStart({ seed: seed, localPlayer: playerIdx });
  }

  function sendCmd(cmd, tick) {
    if (!connected()) return;
    send({ t: 'cmd', cmd: cmd, tick: tick });
  }

  function send(obj) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  function status(s) { if (onStatus) onStatus(s); }

  function connected() { return active && ws && ws.readyState === 1; }

  function disconnect() {
    active = false;
    if (ws) { try { ws.close(); } catch (e) {} }
    ws = null;
  }

  return {
    connect: connect,
    disconnect: disconnect,
    sendCmd: sendCmd,
    connected: connected,
    get playerIdx() { return playerIdx; }
  };
})();
