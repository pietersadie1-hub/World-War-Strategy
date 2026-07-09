/* ============ ai.js — computer opponent: economy, expansion, assaults ============ */
window.RTS = window.RTS || {};

RTS.ai = (function () {
  'use strict';
  const U = RTS.util, C = RTS.config, T = C.T;

  function init(state, playerIdx) {
    state.ai = {
      p: playerIdx,
      thinkT: 2,
      waveT: C.DIFFICULTY[state.difficulty].firstWave, // guaranteed peace at the start
      captureT: 30,
      rallying: false,
      waveNo: 0
    };
  }

  function update(state, dt) {
    const ai = state.ai;
    if (!ai) return;
    const player = state.players[ai.p];
    if (player.defeated) return;

    ai.thinkT -= dt;
    ai.waveT -= dt;
    ai.captureT -= dt;
    if (ai.thinkT > 0) return;
    ai.thinkT = 1.1;

    const my = collect(state, ai.p);
    if (!my.hq) return;

    think_build(state, ai, player, my);
    think_train(state, ai, player, my);
    think_defend(state, ai, my);
    think_attack(state, ai, my);
    if (ai.captureT <= 0) {
      ai.captureT = 45;
      think_capture(state, ai, my);
    }
  }

  function collect(state, p) {
    const my = { units: [], army: [], workers: [], buildings: [], counts: {}, hq: null };
    for (const b of state.buildings) {
      if (b.dead || b.owner !== p) continue;
      my.buildings.push(b);
      my.counts[b.type] = (my.counts[b.type] || 0) + 1;
      if (b.type === 'hq') my.hq = b;
    }
    for (const u of state.units) {
      if (u.dead || u.owner !== p) continue;
      my.units.push(u);
      if (u.type === 'worker') my.workers.push(u);
      else my.army.push(u);
    }
    return my;
  }

  /* ---------- construction ---------- */
  function think_build(state, ai, player, my) {
    const cnt = my.counts;
    const t = state.time;
    let want = null;

    if (!cnt.power) want = 'power';
    else if (!cnt.mine) want = 'mine';
    else if (!cnt.barracks) want = 'barracks';
    else if (!cnt.pump) want = 'pump';
    else if ((cnt.mine || 0) < 2 && t > 100) want = 'mine';
    else if ((cnt.power || 0) < 2 && player.rate.e < 1) want = 'power';
    else if (!cnt.factory && t > 130) want = 'factory';
    else if ((cnt.turret || 0) < 2 + Math.floor(t / 240)) want = 'turret';
    else if ((cnt.mine || 0) < 3 && t > 260) want = 'mine';
    else if (!cnt.dam && t > 300 && player.res.m > 400) want = 'dam';
    else if (!cnt.airfield && t > 330) want = 'airfield';
    else if ((cnt.barracks || 0) < 2 && t > 200) want = 'barracks';

    if (!want) return;
    const def = C.BUILDINGS[want];
    const cost = def.cost;
    if (player.res.m < (cost.m || 0) * 1.15 || player.res.e < (cost.e || 0) || player.res.w < (cost.w || 0)) return;

    const spot = findSpot(state, ai.p, want, my);
    if (spot) {
      RTS.game.issue({ c: 'build', p: ai.p, t: want, x: spot.x, y: spot.y });
      /* send a worker to speed construction up */
      const w = my.workers.find(function (u) { return u.order.kind === 'none'; });
      if (w) {
        /* the building doesn't exist yet (command executes next tick) —
           schedule the assist a few ticks later via a repair-nearest sweep */
        ai.assistAt = { x: spot.x, y: spot.y, t: state.time };
      }
    }
  }

  function findSpot(state, p, type, my) {
    const def = C.BUILDINGS[type];
    const map = state.map;
    const rand = state.rand;
    if (type === 'mine') {
      /* look for a deposit near any of our buildings */
      for (let y = 0; y < map.h; y++) {
        for (let x = 0; x < map.w; x++) {
          if (!map.deposit[y * map.w + x]) continue;
          if (!nearOwn(my, x, y, C.ECON.buildRadius)) continue;
          for (let oy = -1; oy <= 0; oy++) {
            for (let ox = -1; ox <= 0; ox++) {
              if (RTS.game.canPlace(state, p, type, x + ox, y + oy, true)) return { x: x + ox, y: y + oy };
            }
          }
        }
      }
      return null;
    }
    if (type === 'dam' || type === 'pump') {
      /* scan tiles in our build range near water */
      for (let tries = 0; tries < 260; tries++) {
        const b = my.buildings[rand.int(0, my.buildings.length - 1)];
        const x = U.clamp(Math.round(b.x + rand.range(-10, 10)), 1, map.w - 3);
        const y = U.clamp(Math.round(b.y + rand.range(-10, 10)), 1, map.h - 3);
        if (RTS.game.canPlace(state, p, type, x, y, true)) return { x: x, y: y };
      }
      return null;
    }
    for (let tries = 0; tries < 200; tries++) {
      const b = my.buildings[rand.int(0, my.buildings.length - 1)];
      const x = U.clamp(Math.round(b.x + rand.range(-9, 9)), 1, map.w - def.w - 1);
      const y = U.clamp(Math.round(b.y + rand.range(-9, 9)), 1, map.h - def.h - 1);
      if (RTS.game.canPlace(state, p, type, x, y, true)) return { x: x, y: y };
    }
    return null;
  }

  function nearOwn(my, x, y, r) {
    for (const b of my.buildings) {
      if (Math.abs(b.x - x) <= r && Math.abs(b.y - y) <= r) return true;
    }
    return false;
  }

  /* ---------- unit production ---------- */
  function think_train(state, ai, player, my) {
    /* keep a couple of engineers */
    if (my.workers.length < 2 && my.hq.queue.length === 0) {
      RTS.game.issue({ c: 'train', p: ai.p, b: my.hq.id, t: 'worker' });
    }
    /* assist construction sites with idle engineers */
    for (const b of my.buildings) {
      if (b.complete) continue;
      const w = my.workers.find(function (u) { return u.order.kind === 'none'; });
      if (w) RTS.game.issue({ c: 'repair', p: ai.p, ids: [w.id], target: b.id });
      break;
    }
    const reserve = state.time < 200 ? 60 : 150;
    for (const b of my.buildings) {
      if (!b.complete || b.dead) continue;
      const def = C.BUILDINGS[b.type];
      if (!def.trains || b.type === 'hq') continue;
      if (b.queue.length >= 2) continue;
      const pick = choose(state, b.type, my);
      if (!pick) continue;
      const cost = C.UNITS[pick].cost;
      if (player.res.m - (cost.m || 0) < reserve && my.army.length > 4) continue;
      if (player.res.m < (cost.m || 0) || player.res.e < (cost.e || 0) || player.res.w < (cost.w || 0)) continue;
      RTS.game.issue({ c: 'train', p: ai.p, b: b.id, t: pick });
    }
  }

  function choose(state, btype, my) {
    const r = state.rand.next();
    if (btype === 'barracks') return r < 0.6 ? 'infantry' : 'rocket';
    if (btype === 'factory') return r < 0.7 ? 'tank' : 'artillery';
    if (btype === 'airfield') {
      /* mix the air wing: gunships, bombers for sieges, fighters when the enemy flies */
      const enemyId = 1 - state.ai.p;
      const enemyAir = state.units.some(function (u) {
        return !u.dead && u.owner === enemyId && C.UNITS[u.type].air;
      });
      if (enemyAir && r < 0.4) return 'fighter';
      return r < 0.55 ? 'gunship' : r < 0.85 ? 'bomber' : 'fighter';
    }
    return null;
  }

  /* ---------- defense ---------- */
  function think_defend(state, ai, my) {
    /* if any of our buildings was hit recently, rally idle army there */
    let threat = null;
    for (const b of my.buildings) {
      if (b.lastHitT && state.time - b.lastHitT < 6) { threat = b; break; }
    }
    if (!threat) return;
    const ids = [];
    for (const u of my.army) {
      if (u.order.kind === 'none' || u.order.kind === 'patrol') ids.push(u.id);
    }
    if (ids.length) {
      RTS.game.issue({ c: 'attackmove', p: ai.p, ids: ids, x: threat.x, y: threat.y });
    }
  }

  /* ---------- offense ---------- */
  function think_attack(state, ai, my) {
    const diff = C.DIFFICULTY[state.difficulty];
    if (ai.waveT > 0) return;
    const needed = Math.round(5 * diff.waveSize) + ai.waveNo;
    const ready = my.army.filter(function (u) {
      return u.order.kind === 'none' || u.order.kind === 'patrol';
    });
    if (ready.length < needed) {
      ai.waveT = 20; // check again soon
      return;
    }
    ai.waveT = diff.wave;
    ai.waveNo++;
    /* send an escalating detachment, not the whole army — the rest stays
       home on defense (and keeps early waves survivable) */
    const sendCount = Math.min(ready.length, Math.round((5 + ai.waveNo * 3) * diff.waveSize));
    ready.length = sendCount;
    /* target: enemy hq, or nearest enemy building */
    const enemy = state.players[1 - ai.p];
    let target = null;
    for (const b of state.buildings) {
      if (b.dead || b.owner !== enemy.id) continue;
      if (b.type === 'hq') { target = b; break; }
      if (!target) target = b;
    }
    if (!target) return;
    const ids = ready.map(function (u) { return u.id; });
    /* set assault readiness, then move out */
    RTS.game.issue({ c: 'stance', p: ai.p, ids: ids, s: 'assault' });
    RTS.game.issue({ c: 'attackmove', p: ai.p, ids: ids, x: target.x, y: target.y });
    RTS.events.push({ t: 'aiwave', n: ai.waveNo });
  }

  /* ---------- capture neutral town buildings ---------- */
  function think_capture(state, ai, my) {
    const w = my.workers.find(function (u) { return u.order.kind === 'none'; });
    if (!w) return;
    let best = null, bestD = 45;
    for (const b of state.buildings) {
      if (b.dead || b.owner !== -1) continue;
      const d = U.dist(w.x, w.y, b.x, b.y);
      if (d < bestD) { bestD = d; best = b; }
    }
    if (best) RTS.game.issue({ c: 'capture', p: ai.p, ids: [w.id], target: best.id });
  }

  return { init: init, update: update };
})();
