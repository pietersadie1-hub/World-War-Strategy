/* ============ server.js — tiny WebSocket relay for multiplayer ============
   Usage:  npm install ws && node server/server.js [port]
   Rooms hold two players; all messages are relayed to the other peer.   */
'use strict';

const PORT = Number(process.argv[2]) || 8765;
const { WebSocketServer } = require('ws');

const wss = new WebSocketServer({ port: PORT });
const rooms = new Map(); // code -> [ws, ws]

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }

    if (msg.t === 'join') {
      const code = String(msg.room || 'default').slice(0, 24);
      let peers = rooms.get(code);
      if (!peers) { peers = []; rooms.set(code, peers); }
      peers = peers.filter((p) => p.readyState === 1);
      rooms.set(code, peers);
      if (peers.length >= 2) {
        ws.send(JSON.stringify({ t: 'full' }));
        return;
      }
      peers.push(ws);
      ws._room = code;
      ws.send(JSON.stringify({ t: 'joined', idx: peers.length - 1 }));
      if (peers.length === 2) {
        for (const p of peers) p.send(JSON.stringify({ t: 'peer' }));
      }
      return;
    }

    /* relay everything else to the other peer in the room */
    const peers = rooms.get(ws._room);
    if (!peers) return;
    for (const p of peers) {
      if (p !== ws && p.readyState === 1) p.send(JSON.stringify(msg));
    }
  });

  ws.on('close', () => {
    const peers = rooms.get(ws._room);
    if (!peers) return;
    const rest = peers.filter((p) => p !== ws);
    if (rest.length === 0) rooms.delete(ws._room);
    else rooms.set(ws._room, rest);
  });
});

console.log('World War Strategy relay listening on ws://0.0.0.0:' + PORT);
