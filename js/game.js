/* ============ game.js — simulation core, command bus, fog, weather, victory ============ */
window.RTS = window.RTS || {};
RTS.events = []; // sim -> presentation event queue (explosions, toasts, ...)

RTS.game = (function () {
  'use strict';
  const U = RTS.util, C = RTS.config, E = RTS.entities, P = RTS.path, T = C.T;

  let state = null;

  /* ---------------- new game ---------------- */
  function newGame(opts) {
    opts = opts || {};
    const seed = opts.seed !== undefined ? opts.seed : (Date.now() & 0x7fffffff);
    const gen = RTS.map.generate(seed);
    state = {
      seed: seed,
      tick: 0,
      time: 0,
      rand: new U.Mulberry32(seed ^ 0x9e3779b9),
      map: gen.map,
      nextId: 1,
      byId: {},
      units: [],
      buildings: [],
      projectiles: [],
      players: [],
      localPlayer: opts.localPlayer !== undefined ? opts.localPlayer : 0,
      mp: !!opts.mp,
      difficulty: opts.difficulty || 'normal',
      cmdQueue: {},          // tick -> [commands]
      cmdSeq: 0,
      fog: {
        explored: new Uint8Array(gen.map.w * gen.map.h),
        visible: new Uint8Array(gen.map.w * gen.map.h)
      },
      fogT: 0,
      weather: { type: 'clear', t: 70 },
      dayT: 0.28,            // start mid-morning (fraction of day cycle)
      over: null,
      stats: { unitsLost: [0, 0], unitsKilled: [0, 0], buildingsRazed: [0, 0] }
    };

    const names = opts.mp ? ['Player 1', 'Player 2'] : ['Commander', 'Enemy AI'];
    for (let i = 0; i < 2; i++) {
      state.players.push({
        id: i, name: names[i],
        human: opts.mp ? true : i === 0,
        res: { m: C.ECON.startRes.m, e: C.ECON.startRes.e, w: C.ECON.startRes.w },
        rate: { m: 0, e: 0, w: 0 },
        defeated: false
      });
    }

    /* starting bases: HQ + a working economy and production line */
    for (let i = 0; i < 2; i++) {
      const s = gen.starts[i];
      E.placeBuilding(state, i, 'hq', s.x - 1, s.y - 1, true);
      placeStartingBase(state, i, s);
      const su = C.ECON.startUnits;
      let n = 0;
      for (let k = 0; k < (su.worker || 0); k++) {
        spawnStartUnit(state, i, 'worker', s.x - 3 + k * 1.1, s.y + 3.2);
      }
      for (let k = 0; k < (su.infantry || 0); k++) {
        spawnStartUnit(state, i, 'infantry', s.x - 4 + (k % 5) * 1.1, s.y + 4.4 + Math.floor(k / 5) * 1.0);
      }
    }
    /* neutral town */
    for (const tb of gen.townBuildings) {
      const def = C.BUILDINGS[tb.type];
      let free = true;
      for (let y = tb.gy; y < tb.gy + def.h && free; y++) {
        for (let x = tb.gx; x < tb.gx + def.w && free; x++) {
          if (state.map.occupied[y * state.map.w + x]) free = false;
        }
      }
      if (free) E.placeBuilding(state, -1, tb.type, tb.gx, tb.gy, true);
    }

    if (!opts.mp) RTS.ai.init(state, 1);
    computeFog(state, true);
    return state;
  }

  /* pre-build the economy around a start position; deterministic scan order
     so multiplayer clients agree. Mines snap onto nearby mineral fields. */
  function placeStartingBase(st, owner, s) {
    for (const type of C.ECON.startBuildings) {
      const spot = type === 'mine'
        ? findStartMineSpot(st, owner, s)
        : findStartSpot(st, owner, type, s);
      if (spot) {
        E.placeBuilding(st, owner, type, spot.x, spot.y, true);
      } else if (type === 'pump') {
        /* no shoreline near this start — compensate with stockpiled water */
        st.players[owner].res.w += 200;
      } else if (type === 'mine') {
        st.players[owner].res.m += 250;
      }
    }
  }

  function findStartSpot(st, owner, type, s) {
    for (let r = 3; r <= 12; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = s.x + dx, y = s.y + dy;
          if (canPlace(st, owner, type, x, y, true)) return { x: x, y: y };
        }
      }
    }
    return null;
  }

  function findStartMineSpot(st, owner, s) {
    const map = st.map;
    let best = null, bestD = Infinity;
    for (let y = Math.max(0, s.y - 12); y <= Math.min(map.h - 2, s.y + 12); y++) {
      for (let x = Math.max(0, s.x - 12); x <= Math.min(map.w - 2, s.x + 12); x++) {
        if (!map.deposit[y * map.w + x]) continue;
        for (const o of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
          if (canPlace(st, owner, 'mine', x + o[0], y + o[1], true)) {
            const d = Math.abs(x - s.x) + Math.abs(y - s.y);
            if (d < bestD) { bestD = d; best = { x: x + o[0], y: y + o[1] }; }
          }
        }
      }
    }
    return best;
  }

  function spawnStartUnit(st, owner, type, x, y) {
    const p = P.nearestPassable(st.map, Math.round(x), Math.round(y));
    if (p) E.spawnUnit(st, owner, type, p.x + 0.5, p.y + 0.5);
  }

  /* ---------------- command bus ----------------
     Every player intent (human UI, AI, network) flows through here so
     single-player and multiplayer share one deterministic path. */
  function issue(cmd) {
    if (!state || state.over) return;
    cmd.seq = state.cmdSeq++;
    if (state.mp && RTS.net.connected() && cmd.p === state.localPlayer) {
      RTS.net.sendCmd(cmd, state.tick + C.NET_DELAY_TICKS);
      scheduleCmd(cmd, state.tick + C.NET_DELAY_TICKS);
    } else {
      scheduleCmd(cmd, state.tick + 1);
    }
  }

  function scheduleCmd(cmd, tick) {
    if (tick <= state.tick) tick = state.tick + 1;
    (state.cmdQueue[tick] = state.cmdQueue[tick] || []).push(cmd);
  }

  function applyCommand(cmd) {
    const p = cmd.p;
    const player = state.players[p];
    if (!player || player.defeated) return;
    switch (cmd.c) {
      case 'build': {
        const def = C.BUILDINGS[cmd.t];
        if (!def) return;
        /* skipExplored: fog is per-client presentation state — consulting it
           here would desync multiplayer. The UI checks fog before issuing. */
        if (!canPlace(state, p, cmd.t, cmd.x, cmd.y, true)) return;
        if (!spend(player, def.cost)) return;
        E.placeBuilding(state, p, cmd.t, cmd.x, cmd.y, false);
        break;
      }
      case 'road': {
        for (const t of cmd.tiles) {
          const cost = roadTileCost(state, t[0], t[1]);
          if (cost < 0) continue;
          if (player.res.m < cost) break;
          player.res.m -= cost;
          RTS.map.layRoadTile(state.map, t[0], t[1]);
        }
        break;
      }
      case 'train': {
        const b = state.byId[cmd.b];
        const udef = C.UNITS[cmd.t];
        if (!b || b.dead || b.owner !== p || !b.complete || !udef) return;
        const bdef = C.BUILDINGS[b.type];
        if (!bdef.trains || bdef.trains.indexOf(cmd.t) < 0) return;
        if (b.queue.length >= 7) return;
        if (!spend(player, udef.cost)) return;
        b.queue.push({ type: cmd.t, t: 0 });
        break;
      }
      case 'cancel': {
        const b = state.byId[cmd.b];
        if (!b || b.owner !== p || !b.queue.length) return;
        const item = b.queue.splice(cmd.i !== undefined ? cmd.i : b.queue.length - 1, 1)[0];
        if (item) refund(player, C.UNITS[item.type].cost, 1);
        break;
      }
      case 'rally': {
        const b = state.byId[cmd.b];
        if (b && b.owner === p) b.rally = { x: cmd.x, y: cmd.y };
        break;
      }
      case 'demolish': {
        const b = state.byId[cmd.b];
        if (b && b.owner === p && b.type !== 'hq') {
          refund(player, C.BUILDINGS[b.type].cost, b.complete ? 0.4 : 0.8);
          RTS.events.push({ t: 'explosion', x: b.x, y: b.y, s: 0.9 });
          E.removeBuilding(state, b);
        }
        break;
      }
      case 'move':
      case 'attackmove': {
        orderGroupMove(cmd.ids, p, cmd.x, cmd.y, cmd.c);
        break;
      }
      case 'attack': {
        const tgt = state.byId[cmd.target];
        if (!tgt || tgt.dead) return;
        forUnits(cmd.ids, p, function (u) {
          u.order = { kind: 'attack', targetId: cmd.target };
          u.path = null;
          u.autoTargetId = 0;
        });
        break;
      }
      case 'patrol': {
        forUnits(cmd.ids, p, function (u) {
          u.order = { kind: 'patrol', a: { x: u.x, y: u.y }, b: { x: cmd.x, y: cmd.y }, leg: false };
          u.path = null;
        });
        break;
      }
      case 'stance': {
        forUnits(cmd.ids, p, function (u) {
          u.stance = cmd.s;
          if (cmd.s === 'hold') { u.path = null; u.order = { kind: 'none' }; }
          u.anchorX = u.x; u.anchorY = u.y;
        });
        break;
      }
      case 'stop': {
        forUnits(cmd.ids, p, function (u) {
          u.order = { kind: 'none' };
          u.path = null;
          u.autoTargetId = 0;
          u.anchorX = u.x; u.anchorY = u.y;
        });
        break;
      }
      case 'capture': {
        forUnits(cmd.ids, p, function (u) {
          if (u.type !== 'worker') return;
          u.order = { kind: 'capture', targetId: cmd.target };
          u.channel = 0; u.path = null;
        });
        break;
      }
      case 'repair': {
        const b = state.byId[cmd.target];
        if (!b || b.kind !== 'building') return;
        forUnits(cmd.ids, p, function (u) {
          if (u.type !== 'worker') return;
          u.order = { kind: b.complete ? 'repair' : 'build', targetId: cmd.target };
          u.path = null;
        });
        break;
      }
    }
  }

  function forUnits(ids, owner, fn) {
    for (const id of ids) {
      const u = state.byId[id];
      if (u && !u.dead && u.kind === 'unit' && u.owner === owner) {
        /* fresh orders wipe the traffic-control state */
        u.stuckT = 0;
        u.repathTries = 0;
        u.bestGoalD = undefined;
        fn(u);
      }
    }
  }

  function orderGroupMove(ids, owner, x, y, kind) {
    /* deterministic spiral formation offsets */
    let n = 0;
    forUnits(ids, owner, function (u) {
      const ring = Math.floor((Math.sqrt(n) + 0.5));
      const a = n * 2.399963; // golden angle spread
      const r = ring * 0.55;
      const tx = U.clamp(x + Math.cos(a) * r, 0.5, state.map.w - 0.5);
      const ty = U.clamp(y + Math.sin(a) * r, 0.5, state.map.h - 0.5);
      u.order = kind === 'attackmove'
        ? { kind: 'attackmove', x: tx, y: ty }
        : { kind: 'move', x: tx, y: ty };
      u.autoTargetId = 0;
      E.setPath(state, u, tx, ty);
      u.anchorX = tx; u.anchorY = ty;
      n++;
    });
  }

  function spend(player, cost) {
    const m = cost.m || 0, e = cost.e || 0, w = cost.w || 0;
    if (player.res.m < m || player.res.e < e || player.res.w < w) {
      if (player.id === state.localPlayer) RTS.events.push({ t: 'nofunds', cost: cost });
      return false;
    }
    player.res.m -= m; player.res.e -= e; player.res.w -= w;
    return true;
  }
  function refund(player, cost, factor) {
    player.res.m += (cost.m || 0) * factor;
    player.res.e += (cost.e || 0) * factor;
    player.res.w += (cost.w || 0) * factor;
  }

  /* ---------------- placement rules ---------------- */
  function canPlace(st, owner, type, gx, gy, skipExplored) {
    const def = C.BUILDINGS[type];
    if (!def) return false;
    const map = st.map;
    if (gx < 0 || gy < 0 || gx + def.w > map.w || gy + def.h > map.h) return false;
    let hasDeposit = false;
    for (let y = gy; y < gy + def.h; y++) {
      for (let x = gx; x < gx + def.w; x++) {
        const i = y * map.w + x;
        if (map.occupied[i] || map.road[i]) return false;
        if (!skipExplored && !st.fog.explored[i] && owner === st.localPlayer) return false;
        const t = map.terrain[i];
        if (def.place === 'river') {
          if (t !== T.RIVER) return false;
        } else {
          if (t !== T.GRASS && t !== T.SAND && t !== T.FOREST) return false;
          if (map.deposit[i]) hasDeposit = true;
          if (map.deposit[i] && type !== 'mine') return false;
        }
      }
    }
    if (def.place === 'deposit' && !hasDeposit) return false;
    if (def.place === 'shore' && !touchesWater(map, gx, gy, def.w, def.h)) return false;
    /* must be near an existing own building (base expansion rule) */
    let near = false;
    const R = C.ECON.buildRadius;
    for (const b of st.buildings) {
      if (b.dead || b.owner !== owner) continue;
      if (Math.abs(b.x - (gx + def.w / 2)) <= R && Math.abs(b.y - (gy + def.h / 2)) <= R) { near = true; break; }
    }
    return near;
  }

  function touchesWater(map, gx, gy, w, h) {
    for (let y = gy - 1; y <= gy + h; y++) {
      for (let x = gx - 1; x <= gx + w; x++) {
        if (!RTS.map.inBounds(map, x, y)) continue;
        const t = map.terrain[y * map.w + x];
        if (t === T.WATER || t === T.RIVER) return true;
      }
    }
    return false;
  }

  /* road tool: cost of paving tile, -1 if not allowed */
  function roadTileCost(st, x, y) {
    const map = st.map;
    if (!RTS.map.inBounds(map, x, y)) return -1;
    const i = y * map.w + x;
    if (map.road[i] || map.occupied[i] || map.deposit[i]) return -1;
    const t = map.terrain[i];
    if (t === T.MOUNTAIN) return -1;
    if (t === T.WATER || t === T.RIVER) return C.ECON.bridgeCostPerTile;
    return C.ECON.roadCostPerTile;
  }

  /* ---------------- fog of war ---------------- */
  function computeFog(st, force) {
    st.fogT -= C.SIM_DT;
    if (!force && st.fogT > 0) return;
    st.fogT = 0.25;
    const map = st.map, fog = st.fog;
    fog.visible.fill(0);
    const me = st.localPlayer;
    const penalty = st.weather.type === 'fog' ? 2 : 0;
    function reveal(cx, cy, r) {
      r = Math.max(2, r - penalty);
      const r2 = r * r;
      const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(map.w - 1, Math.ceil(cx + r));
      const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(map.h - 1, Math.ceil(cy + r));
      for (let y = y0; y <= y1; y++) {
        const dy = y + 0.5 - cy;
        for (let x = x0; x <= x1; x++) {
          const dx = x + 0.5 - cx;
          if (dx * dx + dy * dy > r2) continue;
          const i = y * map.w + x;
          fog.visible[i] = 1;
          fog.explored[i] = 1;
        }
      }
    }
    for (const u of st.units) {
      if (!u.dead && u.owner === me) reveal(u.x, u.y, C.UNITS[u.type].sight);
    }
    for (const b of st.buildings) {
      if (!b.dead && b.owner === me) reveal(b.x, b.y, C.BUILDINGS[b.type].sight);
    }
  }

  /* ---------------- weather & day cycle ---------------- */
  function updateAtmosphere(st, dt) {
    st.dayT = (st.dayT + dt / C.DAY_LENGTH) % 1;
    st.weather.t -= dt;
    if (st.weather.t <= 0) {
      const r = st.rand.next();
      if (st.weather.type !== 'clear') {
        st.weather = { type: 'clear', t: st.rand.range(50, 110) };
      } else if (r < 0.45) {
        st.weather = { type: 'rain', t: st.rand.range(25, 55) };
      } else if (r < 0.7) {
        st.weather = { type: 'fog', t: st.rand.range(20, 45) };
      } else {
        st.weather = { type: 'clear', t: st.rand.range(40, 80) };
      }
      RTS.events.push({ t: 'weather', w: st.weather.type });
    }
  }

  /* ---------------- income ---------------- */
  function updateEconomy(st, dt) {
    for (const pl of st.players) { pl.rate.m = 0; pl.rate.e = 0; pl.rate.w = 0; }
    for (const b of st.buildings) {
      if (b.dead || !b.complete || b.owner < 0) continue;
      const pl = st.players[b.owner];
      const def = C.BUILDINGS[b.type];
      const pr = def.provides || {};
      pl.rate.m += pr.m || 0;
      pl.rate.e += (pr.e || 0) - (def.energyUse || 0);
      pl.rate.w += pr.w || 0;
    }
    for (const pl of st.players) {
      let mul = 1;
      if (!pl.human) mul = C.DIFFICULTY[st.difficulty].income;
      pl.res.m = U.clamp(pl.res.m + pl.rate.m * mul * dt, 0, 999999);
      pl.res.e = U.clamp(pl.res.e + pl.rate.e * mul * dt, 0, 999999);
      pl.res.w = U.clamp(pl.res.w + pl.rate.w * mul * dt, 0, 999999);
    }
  }

  /* ---------------- victory ---------------- */
  function onBuildingDestroyed(st, b, byOwner) {
    if (byOwner >= 0 && byOwner !== b.owner) st.stats.buildingsRazed[byOwner]++;
    if (b.type === 'hq' && b.owner >= 0) {
      st.players[b.owner].defeated = true;
      const alive = st.players.filter(function (p) { return !p.defeated; });
      if (alive.length === 1) {
        st.over = { winner: alive[0].id };
        RTS.events.push({ t: 'gameover', winner: alive[0].id });
      }
    }
  }

  /* ---------------- main tick ---------------- */
  function tick() {
    if (!state || state.over) return;
    const dt = C.SIM_DT;
    state.tick++;
    state.time += dt;

    /* scheduled commands (sorted for determinism) */
    const cmds = state.cmdQueue[state.tick];
    if (cmds) {
      cmds.sort(function (a, b) { return (a.p - b.p) || (a.seq - b.seq); });
      for (const c of cmds) applyCommand(c);
      delete state.cmdQueue[state.tick];
    }

    updateEconomy(state, dt);

    for (const b of state.buildings) {
      if (!b.dead) E.updateBuilding(state, b, dt);
    }
    for (const u of state.units) {
      if (!u.dead) {
        u.px = u.x; u.py = u.y;
        E.updateUnit(state, u, dt);
      }
    }
    E.separate(state);
    E.updateProjectiles(state, dt);

    /* prune dead units */
    if (state.tick % 20 === 0) {
      state.units = state.units.filter(function (u) { return !u.dead; });
      state.buildings = state.buildings.filter(function (b) { return !b.dead; });
    }

    updateAtmosphere(state, dt);
    if (!state.mp) RTS.ai.update(state, dt);
    computeFog(state);
  }

  return {
    newGame: newGame,
    tick: tick,
    issue: issue,
    scheduleCmd: scheduleCmd,
    canPlace: canPlace,
    roadTileCost: roadTileCost,
    onBuildingDestroyed: onBuildingDestroyed,
    computeFog: computeFog,
    get state() { return state; },
    set state(s) { state = s; },
    clear: function () { state = null; }
  };
})();
