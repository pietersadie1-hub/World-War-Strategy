/* ============ entities.js — units & buildings: creation, orders, combat ============ */
window.RTS = window.RTS || {};

RTS.entities = (function () {
  'use strict';
  const U = RTS.util, C = RTS.config, P = RTS.path, T = C.T;

  /* ---------------- creation ---------------- */
  function spawnUnit(state, owner, type, x, y) {
    const def = C.UNITS[type];
    const u = {
      kind: 'unit', id: state.nextId++, owner: owner, type: type,
      x: x, y: y, px: x, py: y, z: def.air ? 1 : 0,
      hp: def.hp, maxHp: def.hp,
      dir: 0.8, state: 'idle',
      path: null, pathI: 0, repath: 0,
      order: { kind: 'none' }, stance: 'guard',
      autoTargetId: 0, anchorX: x, anchorY: y,
      cd: 0, scanT: state.rand.next() * 0.3, channel: 0, animT: 0,
      dead: false
    };
    state.units.push(u);
    state.byId[u.id] = u;
    return u;
  }

  function placeBuilding(state, owner, type, gx, gy, complete) {
    const def = C.BUILDINGS[type];
    const b = {
      kind: 'building', id: state.nextId++, owner: owner, type: type,
      gx: gx, gy: gy, w: def.w, h: def.h,
      x: gx + def.w / 2, y: gy + def.h / 2,
      hp: complete ? def.hp : Math.max(1, def.hp * 0.1), maxHp: def.hp,
      progress: complete ? 1 : 0, complete: !!complete,
      queue: [], rally: null, cd: 0, scanT: 0,
      dead: false
    };
    state.buildings.push(b);
    state.byId[b.id] = b;
    const map = state.map;
    RTS.map.clearDecorRect(map, gx, gy, def.w, def.h);
    for (let y = gy; y < gy + def.h; y++) {
      for (let x = gx; x < gx + def.w; x++) {
        map.occupied[y * map.w + x] = b.id + 1;
      }
    }
    if (complete && type === 'dam') openDamCrossing(state, b);
    return b;
  }

  function openDamCrossing(state, b) {
    const map = state.map;
    for (let y = b.gy; y < b.gy + b.h; y++) {
      for (let x = b.gx; x < b.gx + b.w; x++) {
        const i = y * map.w + x;
        map.occupied[i] = 0;   // crest is walkable
        map.road[i] = 3;
      }
    }
  }

  function removeBuilding(state, b) {
    const map = state.map;
    for (let y = b.gy; y < b.gy + b.h; y++) {
      for (let x = b.gx; x < b.gx + b.w; x++) {
        const i = y * map.w + x;
        if (map.occupied[i] === b.id + 1) map.occupied[i] = 0;
        if (b.type === 'dam' && map.road[i] === 3) map.road[i] = 0;
      }
    }
    b.dead = true;
    delete state.byId[b.id];
  }

  /* "call for help": nearby idle friendlies converge on whoever is shooting
     at one of ours. This is what makes a guarded base actually defend itself. */
  function alertNearby(state, target, attacker) {
    if (!attacker || attacker.dead) return;
    if (target.alertT !== undefined && state.time - target.alertT < 2) return;
    target.alertT = state.time;
    for (const u of state.units) {
      if (u.dead || u.owner !== target.owner || u.id === target.id) continue;
      const def = C.UNITS[u.type];
      if (!def.weapon || u.stance === 'hold') continue;
      if (u.order.kind !== 'none' && u.order.kind !== 'patrol') continue;
      if (u.autoTargetId) continue;
      if (!canHit(def.weapon, attacker)) continue;
      if (U.dist(u.x, u.y, target.x, target.y) > 12) continue;
      u.autoTargetId = attacker.id;
      /* re-anchor at the victim so the leash lets them fight there */
      u.anchorX = target.x;
      u.anchorY = target.y;
    }
  }

  /* ---------------- damage ---------------- */
  function damage(state, target, amount, srcOwner, weapon, srcId) {
    if (!target || target.dead) return;
    if (weapon && weapon.bonusVsBuilding && target.kind === 'building') {
      amount *= weapon.bonusVsBuilding;
    }
    if (weapon && weapon.bonusVsAir && target.kind === 'unit' && C.UNITS[target.type].air) {
      amount *= weapon.bonusVsAir;
    }
    target.hp -= amount;
    target.lastHitT = state.time;
    target.lastHitBy = srcOwner;
    if (target.kind === 'building' && target.owner >= 0 && target.hp > 0) {
      RTS.events.push({ t: 'attacked', x: target.x, y: target.y, owner: target.owner });
    }
    if (target.owner >= 0 && srcId !== undefined) {
      alertNearby(state, target, state.byId[srcId]);
    }
    if (target.hp <= 0) {
      target.hp = 0;
      if (target.kind === 'unit') {
        target.dead = true;
        delete state.byId[target.id];
        if (target.owner >= 0) state.stats.unitsLost[target.owner]++;
        if (srcOwner >= 0 && srcOwner !== target.owner) state.stats.unitsKilled[srcOwner]++;
        const udef = C.UNITS[target.type];
        RTS.events.push({
          t: 'explosion', x: target.x, y: target.y,
          s: udef.air ? 1.1 : 0.8, air: target.z > 0, utype: target.type
        });
      } else {
        RTS.events.push({ t: 'explosion', x: target.x, y: target.y, s: 1 + (target.w + target.h) * 0.35, building: true });
        removeBuilding(state, target);
        RTS.game.onBuildingDestroyed(state, target, srcOwner);
      }
    }
  }

  /* ---------------- movement helpers ---------------- */
  function setPath(state, u, tx, ty, ignoreBid) {
    const def = C.UNITS[u.type];
    u.path = P.findPath(state.map, u.x, u.y, tx, ty, def.air, ignoreBid);
    u.pathI = 0;
    u.repath = 0;
    return !!u.path;
  }

  function terrainSpeedFactor(map, x, y) {
    const gx = x | 0, gy = y | 0;
    if (gx < 0 || gy < 0 || gx >= map.w || gy >= map.h) return 1;
    const i = gy * map.w + gx;
    if (map.road[i]) return 1.45;
    const t = map.terrain[i];
    if (t === T.FOREST || t === T.HILL) return 0.72;
    if (t === T.SAND) return 0.9;
    return 1;
  }

  function stepAlongPath(state, u, dt, speedMul) {
    if (!u.path || u.pathI >= u.path.length) { u.path = null; return true; }
    const def = C.UNITS[u.type];
    let speed = def.speed * (speedMul || 1);
    if (!def.air) speed *= terrainSpeedFactor(state.map, u.x, u.y);
    let remaining = speed * dt;
    while (remaining > 0 && u.path && u.pathI < u.path.length) {
      const wp = u.path[u.pathI];
      const dx = wp.x - u.x, dy = wp.y - u.y;
      const d = Math.hypot(dx, dy);
      /* loose tolerance on intermediate waypoints — crowds shove units off
         the exact line and demanding pixel-perfect hits caused stalls */
      const isLast = u.pathI >= u.path.length - 1;
      if (d < (isLast ? 0.05 : 0.3)) { u.pathI++; continue; }
      const step = Math.min(remaining, d);
      u.x += dx / d * step;
      u.y += dy / d * step;
      u.dir = Math.atan2(dy * 2, dx); // screen-space-ish facing
      remaining -= step;
      if (step >= d - 0.001) u.pathI++;
    }
    u.animT += dt * speed;
    if (!u.path || u.pathI >= u.path.length) { u.path = null; return true; }
    return false;
  }

  /* Traffic control. Detection is goal-progress based: a unit is stuck when
     its distance to the goal stops improving — this also catches crowd
     "ping-pong", where a unit bounces at full speed between its movement
     step and the separation push without gaining an inch. Response ladder:
     sidestep + repath a few times, then settle for "close enough". */
  function stuckCheck(state, u, dt, goalX, goalY) {
    if (!u.path) { u.bestGoalD = undefined; u.stuckT = 0; return null; }
    if (goalX === undefined) {
      const last = u.path[u.path.length - 1];
      goalX = last.x; goalY = last.y;
    }
    const gd = U.dist(u.x, u.y, goalX, goalY);
    if (u.bestGoalD === undefined || gd < u.bestGoalD - 0.22) {
      u.bestGoalD = gd;
      u.stuckT = 0;
      /* good progress since the last stall earns the retry budget back —
         a long trek through several slow chokepoints shouldn't give up */
      if (u.tryRefD !== undefined && gd < u.tryRefD - 4) {
        u.repathTries = 0;
        u.tryRefD = undefined;
      }
      return null;
    }
    u.stuckT = (u.stuckT || 0) + dt;
    if (u.stuckT < 1.6) return null;
    u.stuckT = 0;
    u.bestGoalD = undefined;
    if (gd < 2.2) return 'arrived';
    u.repathTries = (u.repathTries || 0) + 1;
    u.tryRefD = gd;
    if (u.repathTries > 4) { u.repathTries = 0; return 'arrived'; } // give up gracefully
    return 'repath';
  }

  /* detour half a turn to the side of the jam, then head for the goal */
  function sidestepRepath(state, u, gx, gy) {
    const side = state.rand.next() < 0.5 ? 1 : -1;
    const ang = Math.atan2(gy - u.y, gx - u.x) + side * (Math.PI / 2 + state.rand.range(-0.4, 0.4));
    const r = 1.2 + state.rand.next() * 1.6;
    const p = P.nearestPassable(state.map, u.x + Math.cos(ang) * r, u.y + Math.sin(ang) * r);
    if (!setPath(state, u, gx, gy)) return false;
    if (p) u.path.unshift({ x: p.x + 0.5, y: p.y + 0.5 });
    return true;
  }

  function settle(u) {
    u.order = { kind: 'none' };
    u.path = null;
    u.stuckT = 0;
    u.repathTries = 0;
    u.bestGoalD = undefined;
    u.anchorX = u.x;
    u.anchorY = u.y;
  }

  /* approach point on a building's perimeter */
  function approachBuilding(state, u, b) {
    const p = P.nearestPassable(state.map, u.x < b.x ? b.gx - 1 : b.gx + b.w, u.y < b.y ? b.gy - 1 : b.gy + b.h, b.id);
    if (p) setPath(state, u, p.x + 0.5, p.y + 0.5, b.id);
  }

  function nearBuilding(u, b, range) {
    const cx = U.clamp(u.x, b.gx, b.gx + b.w);
    const cy = U.clamp(u.y, b.gy, b.gy + b.h);
    return U.dist(u.x, u.y, cx, cy) <= (range || 1.25);
  }

  function distToEnt(a, e) {
    if (e.kind === 'building') {
      const cx = U.clamp(a.x, e.gx, e.gx + e.w), cy = U.clamp(a.y, e.gy, e.gy + e.h);
      return U.dist(a.x, a.y, cx, cy);
    }
    return U.dist(a.x, a.y, e.x, e.y);
  }

  /* ---------------- targeting ---------------- */
  function isEnemy(state, me, e) {
    return !e.dead && e.owner !== me.owner && e.owner !== -1;
  }

  function canHit(weapon, e) {
    return !(weapon && weapon.groundOnly && e.kind === 'unit' && C.UNITS[e.type].air);
  }

  function acquireTarget(state, u, radius, includeBuildings) {
    /* deterministic scan: nearest enemy, units preferred over buildings */
    let best = null, bestD = radius;
    const def = C.UNITS[u.type];
    const weapon = def && def.weapon;
    for (const e of state.units) {
      if (!isEnemy(state, u, e)) continue;
      if (!canHit(weapon, e)) continue;
      const d = U.dist(u.x, u.y, e.x, e.y);
      if (d < bestD) { bestD = d; best = e; }
    }
    if (!best && includeBuildings) {
      for (const e of state.buildings) {
        if (!isEnemy(state, u, e)) continue;
        const d = distToEnt(u, e);
        if (d < bestD) { bestD = d; best = e; }
      }
    }
    return best;
  }

  function tryFire(state, u, target, weapon) {
    if (u.cd > 0) return false;
    const d = distToEnt(u, target);
    if (d > weapon.range || (weapon.minRange && d < weapon.minRange)) return false;
    u.cd = weapon.rof;
    u.dir = Math.atan2((target.y - u.y) * 2, target.x - u.x);
    const proj = {
      id: state.nextId++, type: weapon.projectile,
      x: u.x, y: u.y, z: u.z ? 0.9 : (u.kind === 'building' ? 0.5 : 0.35),
      sx: u.x, sy: u.y, srcId: u.id,
      targetId: target.id, tx: target.x, ty: target.y,
      dmg: weapon.dmg, splash: weapon.splash || 0, weapon: weapon,
      owner: u.owner, t: 0,
      dur: weapon.projectile === 'arc' ? 0.55 + d * 0.09
         : weapon.projectile === 'bomb' ? 0.55
         : d / 13
    };
    state.projectiles.push(proj);
    RTS.events.push({ t: 'muzzle', x: u.x, y: u.y, z: proj.z, dir: u.dir, kind: weapon.projectile });
    return true;
  }

  function updateProjectiles(state, dt) {
    const list = state.projectiles;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.t += dt;
      const tgt = state.byId[p.targetId];
      if (tgt && !tgt.dead) { p.tx = tgt.x; p.ty = tgt.y; }
      const k = Math.min(1, p.t / p.dur);
      p.x = U.lerp(p.sx, p.tx, k);
      p.y = U.lerp(p.sy, p.ty, k);
      if (p.type === 'arc') p.z = 0.4 + Math.sin(k * Math.PI) * 2.6;
      else if (p.type === 'bomb') p.z = U.lerp(2.3, 0, k * k); // free fall from the plane
      if (k >= 1) {
        list.splice(i, 1);
        if (p.splash > 0) {
          RTS.events.push({ t: 'explosion', x: p.tx, y: p.ty, s: p.splash, ground: true });
          for (const e of state.units) {
            if (e.dead || e.owner === p.owner) continue;
            if (!canHit(p.weapon, e)) continue;
            if (U.dist(e.x, e.y, p.tx, p.ty) <= p.splash) damage(state, e, p.dmg, p.owner, p.weapon, p.srcId);
          }
          for (const e of state.buildings) {
            if (e.dead || e.owner === p.owner || e.owner === -1) continue;
            if (distToEnt({ x: p.tx, y: p.ty }, e) <= p.splash) damage(state, e, p.dmg, p.owner, p.weapon, p.srcId);
          }
        } else if (tgt && !tgt.dead) {
          damage(state, tgt, p.dmg, p.owner, p.weapon, p.srcId);
          RTS.events.push({ t: 'hit', x: p.tx, y: p.ty, kind: p.type, z: tgt.z || 0.35 });
        }
      }
    }
  }

  /* ---------------- unit brain ---------------- */
  function updateUnit(state, u, dt) {
    const def = C.UNITS[u.type];
    if (u.cd > 0) u.cd -= dt;
    u.scanT -= dt;
    const o = u.order;

    switch (o.kind) {
      case 'none': {
        if (def.weapon && u.scanT <= 0) {
          u.scanT = 0.3;
          const radius = u.stance === 'assault' ? def.sight : u.stance === 'hold' ? def.weapon.range : def.weapon.range + 1.2;
          const tgt = state.byId[u.autoTargetId];
          if (!tgt || tgt.dead) {
            const nt = acquireTarget(state, u, radius, u.stance === 'assault');
            u.autoTargetId = nt ? nt.id : 0;
          }
        }
        const tgt = state.byId[u.autoTargetId];
        if (tgt && !tgt.dead && def.weapon) {
          engage(state, u, tgt, dt, def, true);
        } else {
          u.autoTargetId = 0;
          if (u.path) stepAlongPath(state, u, dt);
          else if (u.stance !== 'hold') {
            /* drift back to guard anchor if we chased too far */
            if (U.dist(u.x, u.y, u.anchorX, u.anchorY) > 1.5) setPath(state, u, u.anchorX, u.anchorY);
          }
        }
        break;
      }
      case 'move': {
        if (stepAlongPath(state, u, dt)) {
          settle(u);
          break;
        }
        const sc = stuckCheck(state, u, dt, o.x, o.y);
        if (sc === 'arrived') settle(u);
        else if (sc === 'repath' && !sidestepRepath(state, u, o.x, o.y)) settle(u);
        break;
      }
      case 'attackmove': {
        if (def.weapon && u.scanT <= 0) {
          u.scanT = 0.25;
          const tgt = state.byId[u.autoTargetId];
          if (!tgt || tgt.dead) {
            const nt = acquireTarget(state, u, def.sight, true);
            u.autoTargetId = nt ? nt.id : 0;
          }
        }
        const tgt = state.byId[u.autoTargetId];
        if (tgt && !tgt.dead && def.weapon) {
          engage(state, u, tgt, dt, def, false);
        } else {
          u.autoTargetId = 0;
          if (!u.path) setPath(state, u, o.x, o.y);
          if (stepAlongPath(state, u, dt)) {
            settle(u);
            break;
          }
          const sc = stuckCheck(state, u, dt, o.x, o.y);
          if (sc === 'arrived') settle(u);
          else if (sc === 'repath' && !sidestepRepath(state, u, o.x, o.y)) settle(u);
        }
        break;
      }
      case 'attack': {
        const tgt = state.byId[o.targetId];
        if (!tgt || tgt.dead) { u.order = { kind: 'none' }; u.path = null; break; }
        if (!def.weapon || !canHit(def.weapon, tgt)) { u.order = { kind: 'none' }; break; }
        engage(state, u, tgt, dt, def, false);
        break;
      }
      case 'patrol': {
        if (def.weapon && u.scanT <= 0) {
          u.scanT = 0.3;
          const tgt = state.byId[u.autoTargetId];
          if (!tgt || tgt.dead) {
            const nt = acquireTarget(state, u, def.sight * 0.9, false);
            u.autoTargetId = nt ? nt.id : 0;
          }
        }
        const tgt = state.byId[u.autoTargetId];
        if (tgt && !tgt.dead && def.weapon) {
          engage(state, u, tgt, dt, def, true);
        } else {
          u.autoTargetId = 0;
          const goal = o.leg ? o.a : o.b;
          if (!u.path) setPath(state, u, goal.x, goal.y);
          if (stepAlongPath(state, u, dt)) {
            o.leg = !o.leg;
            u.path = null;
          } else {
            const sc = stuckCheck(state, u, dt, goal.x, goal.y);
            if (sc === 'arrived') { o.leg = !o.leg; u.path = null; }
            else if (sc === 'repath') sidestepRepath(state, u, goal.x, goal.y);
          }
        }
        break;
      }
      case 'capture': {
        const b = state.byId[o.targetId];
        if (!b || b.dead || b.owner === u.owner) { u.order = { kind: 'none' }; u.path = null; u.channel = 0; break; }
        if (nearBuilding(u, b, 1.3)) {
          u.path = null;
          u.channel += dt;
          u.animT += dt * 3;
          if (u.channel >= C.ECON.captureTime) {
            b.owner = u.owner;
            u.channel = 0;
            u.order = { kind: 'none' };
            RTS.events.push({ t: 'capture', x: b.x, y: b.y, owner: u.owner });
          }
        } else {
          u.channel = 0;
          if (!u.path) approachBuilding(state, u, b);
          if (u.path) stepAlongPath(state, u, dt);
          else u.order = { kind: 'none' }; // unreachable
        }
        break;
      }
      case 'build':      /* engineer assists a construction site */
      case 'repair': {
        const b = state.byId[o.targetId];
        if (!b || b.dead || (o.kind === 'repair' && b.hp >= b.maxHp && b.complete)) {
          u.order = { kind: 'none' }; u.path = null; break;
        }
        if (nearBuilding(u, b, 1.35)) {
          u.path = null;
          u.animT += dt * 3;
          b.assistT = state.time; // building update reads this for speed boost
          if (o.kind === 'repair' && b.complete) {
            const player = state.players[u.owner];
            const heal = Math.min(C.ECON.repairHpPerSec * dt, b.maxHp - b.hp);
            const cost = heal * C.ECON.repairCostPerHp;
            if (player.res.m >= cost) {
              player.res.m -= cost;
              b.hp += heal;
            }
          }
          if (o.kind === 'build' && b.complete) u.order = { kind: 'none' };
        } else {
          if (!u.path) approachBuilding(state, u, b);
          if (u.path) stepAlongPath(state, u, dt);
          else u.order = { kind: 'none' };
        }
        break;
      }
    }
  }

  /* close range & fire; if stationaryReturn, remember anchor leash */
  function engage(state, u, tgt, dt, def, leashed) {
    const w = def.weapon;
    const d = distToEnt(u, tgt);
    if (leashed && U.dist(u.x, u.y, u.anchorX, u.anchorY) > def.sight + 3) {
      u.autoTargetId = 0;
      setPath(state, u, u.anchorX, u.anchorY);
      return;
    }
    if (w.minRange && d < w.minRange) {
      /* fall back */
      const away = Math.atan2(u.y - tgt.y, u.x - tgt.x);
      const bx = u.x + Math.cos(away) * 2, by = u.y + Math.sin(away) * 2;
      if (!u.path) setPath(state, u, bx, by);
      stepAlongPath(state, u, dt);
      return;
    }
    if (d <= w.range) {
      u.path = null;
      tryFire(state, u, tgt, w);
    } else {
      u.repath -= dt;
      if (!u.path || u.repath <= 0) {
        u.repath = 0.8;
        setPath(state, u, tgt.x, tgt.y);
        if (u.path && u.path.length > 0) {
          /* stop pathing once inside range — trim happens naturally */
        }
      }
      stepAlongPath(state, u, dt);
    }
  }

  /* soft collision: push overlapping ground units apart */
  function separate(state) {
    const cell = {}; // hash by tile
    const units = state.units;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u.dead || C.UNITS[u.type].air) continue;
      const k = (u.x | 0) + ',' + (u.y | 0);
      (cell[k] = cell[k] || []).push(u);
    }
    for (const k in cell) {
      const list = cell[k];
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i], b = list[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.hypot(dx, dy);
          const min = 0.42;
          if (d < min && d > 0.0001) {
            /* moving units shoulder idle ones aside instead of stalling */
            const aMoving = !!a.path, bMoving = !!b.path;
            let ka = 0.5, kb = 0.5;
            if (aMoving && !bMoving) { ka = 0.12; kb = 0.88; }
            else if (!aMoving && bMoving) { ka = 0.88; kb = 0.12; }
            const push = min - d;
            const nx = dx / d, ny = dy / d;
            a.x -= nx * push * ka; a.y -= ny * push * ka;
            b.x += nx * push * kb; b.y += ny * push * kb;
          } else if (d <= 0.0001) {
            a.x -= 0.03; b.x += 0.03;
          }
        }
      }
    }
    /* keep ground units off impassable tiles after pushes */
    for (const u of units) {
      if (u.dead || C.UNITS[u.type].air) continue;
      if (!P.passable(state.map, u.x | 0, u.y | 0)) {
        const p = P.nearestPassable(state.map, u.x | 0, u.y | 0);
        if (p) { u.x = p.x + 0.5; u.y = p.y + 0.5; }
      }
      u.x = U.clamp(u.x, 0.2, state.map.w - 0.2);
      u.y = U.clamp(u.y, 0.2, state.map.h - 0.2);
    }
  }

  /* ---------------- building brain ---------------- */
  function updateBuilding(state, b, dt) {
    const def = C.BUILDINGS[b.type];
    const player = b.owner >= 0 ? state.players[b.owner] : null;
    const powerFactor = player && player.res.e <= 0.5 ? C.ECON.lowPowerFactor : 1;

    if (!b.complete) {
      const assisted = b.assistT !== undefined && state.time - b.assistT < 0.3;
      const rate = (assisted ? 2.2 : 1) * powerFactor / def.buildTime;
      b.progress += rate * dt;
      b.hp = Math.min(def.hp, def.hp * (0.1 + 0.9 * b.progress));
      if (b.progress >= 1) {
        b.progress = 1;
        b.complete = true;
        b.hp = def.hp;
        if (b.type === 'dam') openDamCrossing(state, b);
        RTS.events.push({ t: 'complete', x: b.x, y: b.y, owner: b.owner, btype: b.type });
      }
      return;
    }

    /* production queue */
    if (b.queue.length > 0) {
      const item = b.queue[0];
      const udef = C.UNITS[item.type];
      item.t += dt * powerFactor;
      if (item.t >= udef.buildTime) {
        b.queue.shift();
        const exit = P.nearestPassable(state.map, b.gx + Math.floor(b.w / 2), b.gy + b.h, b.id) ||
                     P.nearestPassable(state.map, b.gx - 1, b.gy - 1, b.id);
        if (exit) {
          const nu = spawnUnit(state, b.owner, item.type, exit.x + 0.5, exit.y + 0.5);
          const r = b.rally;
          if (r) {
            nu.order = { kind: 'move', x: r.x, y: r.y };
            setPath(state, nu, r.x, r.y);
            nu.anchorX = r.x; nu.anchorY = r.y;
          }
          RTS.events.push({ t: 'trained', owner: b.owner, utype: item.type, x: exit.x, y: exit.y });
        }
      }
    }

    /* turret / defensive fire */
    if (def.weapon) {
      if (b.cd > 0) b.cd -= dt;
      b.scanT -= dt;
      if (b.scanT <= 0) {
        b.scanT = 0.25;
        const tgt = state.byId[b.autoTargetId];
        if (!tgt || tgt.dead || distToEnt(b, tgt) > def.weapon.range) {
          let best = null, bestD = def.weapon.range;
          for (const e of state.units) {
            if (e.dead || e.owner === b.owner || e.owner === -1) continue;
            const d = distToEnt(b, e);
            if (d < bestD) { bestD = d; best = e; }
          }
          b.autoTargetId = best ? best.id : 0;
        }
      }
      const tgt = state.byId[b.autoTargetId];
      if (tgt && !tgt.dead) {
        const slow = powerFactor < 1 ? 1.8 : 1; // low power slows turrets
        if (b.cd <= 0) {
          const w = def.weapon;
          const fired = tryFire(state, b, tgt, w);
          if (fired && slow > 1) b.cd = w.rof * slow;
        }
      }
    }
  }

  return {
    spawnUnit: spawnUnit,
    placeBuilding: placeBuilding,
    removeBuilding: removeBuilding,
    damage: damage,
    updateUnit: updateUnit,
    updateBuilding: updateBuilding,
    updateProjectiles: updateProjectiles,
    separate: separate,
    setPath: setPath,
    distToEnt: distToEnt,
    nearBuilding: nearBuilding
  };
})();
