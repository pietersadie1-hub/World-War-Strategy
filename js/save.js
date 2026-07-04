/* ============ save.js — persist full game state in localStorage ============ */
window.RTS = window.RTS || {};

RTS.save = (function () {
  'use strict';
  const U = RTS.util, C = RTS.config;
  const KEY = 'wws_save_v1';

  function serialize(state) {
    const map = state.map;
    return {
      v: 1,
      seed: state.seed,
      tick: state.tick,
      time: state.time,
      randS: state.rand.s,
      difficulty: state.difficulty,
      nextId: state.nextId,
      cmdSeq: state.cmdSeq,
      dayT: state.dayT,
      weather: state.weather,
      stats: state.stats,
      localPlayer: state.localPlayer,
      map: {
        w: map.w, h: map.h,
        terrain: U.u8ToB64(map.terrain),
        road: U.u8ToB64(map.road),
        deposit: U.u8ToB64(map.deposit),
        decor: map.decor
      },
      explored: U.u8ToB64(state.fog.explored),
      players: state.players,
      units: state.units.filter(function (u) { return !u.dead; }).map(function (u) {
        return {
          id: u.id, owner: u.owner, type: u.type, x: u.x, y: u.y,
          hp: u.hp, stance: u.stance, order: u.order, dir: u.dir,
          anchorX: u.anchorX, anchorY: u.anchorY
        };
      }),
      buildings: state.buildings.filter(function (b) { return !b.dead; }).map(function (b) {
        return {
          id: b.id, owner: b.owner, type: b.type, gx: b.gx, gy: b.gy,
          hp: b.hp, progress: b.progress, complete: b.complete,
          queue: b.queue, rally: b.rally
        };
      }),
      ai: state.ai ? { p: state.ai.p, waveT: state.ai.waveT, waveNo: state.ai.waveNo } : null
    };
  }

  function deserialize(data) {
    const w = data.map.w, h = data.map.h;
    const map = {
      w: w, h: h,
      terrain: U.b64ToU8(data.map.terrain),
      road: new Uint8Array(U.b64ToU8(data.map.road)),
      deposit: U.b64ToU8(data.map.deposit),
      occupied: new Int32Array(w * h),
      decor: data.map.decor,
      decorAt: {}
    };
    for (const d of map.decor) {
      const k = d.gy * w + d.gx;
      (map.decorAt[k] = map.decorAt[k] || []).push(d);
    }
    const rand = new U.Mulberry32(0);
    rand.s = data.randS >>> 0;
    const state = {
      seed: data.seed, tick: data.tick, time: data.time,
      rand: rand,
      map: map,
      nextId: data.nextId, cmdSeq: data.cmdSeq,
      byId: {},
      units: [], buildings: [], projectiles: [],
      players: data.players,
      localPlayer: data.localPlayer || 0,
      mp: false,
      difficulty: data.difficulty,
      cmdQueue: {},
      fog: { explored: U.b64ToU8(data.explored), visible: new Uint8Array(w * h) },
      fogT: 0,
      weather: data.weather,
      dayT: data.dayT,
      over: null,
      stats: data.stats || { unitsLost: [0, 0], unitsKilled: [0, 0], buildingsRazed: [0, 0] }
    };
    for (const bd of data.buildings) {
      const def = C.BUILDINGS[bd.type];
      const b = {
        kind: 'building', id: bd.id, owner: bd.owner, type: bd.type,
        gx: bd.gx, gy: bd.gy, w: def.w, h: def.h,
        x: bd.gx + def.w / 2, y: bd.gy + def.h / 2,
        hp: bd.hp, maxHp: def.hp,
        progress: bd.progress, complete: bd.complete,
        queue: bd.queue || [], rally: bd.rally, cd: 0, scanT: 0,
        dead: false
      };
      state.buildings.push(b);
      state.byId[b.id] = b;
      for (let y = b.gy; y < b.gy + b.h; y++) {
        for (let x = b.gx; x < b.gx + b.w; x++) {
          map.occupied[y * w + x] = b.id + 1;
        }
      }
      if (b.complete && b.type === 'dam') {
        for (let y = b.gy; y < b.gy + b.h; y++) {
          for (let x = b.gx; x < b.gx + b.w; x++) {
            const i = y * w + x;
            map.occupied[i] = 0;
            map.road[i] = 3;
          }
        }
      }
    }
    for (const ud of data.units) {
      const def = C.UNITS[ud.type];
      const u = {
        kind: 'unit', id: ud.id, owner: ud.owner, type: ud.type,
        x: ud.x, y: ud.y, px: ud.x, py: ud.y, z: def.air ? 1 : 0,
        hp: ud.hp, maxHp: def.hp,
        dir: ud.dir || 0.8, state: 'idle',
        path: null, pathI: 0, repath: 0,
        order: ud.order && ud.order.kind ? ud.order : { kind: 'none' },
        stance: ud.stance || 'guard',
        autoTargetId: 0,
        anchorX: ud.anchorX !== undefined ? ud.anchorX : ud.x,
        anchorY: ud.anchorY !== undefined ? ud.anchorY : ud.y,
        cd: 0, scanT: 0, channel: 0, animT: 0, dead: false
      };
      state.units.push(u);
      state.byId[u.id] = u;
    }
    if (data.ai) {
      RTS.ai.init(state, data.ai.p);
      state.ai.waveT = data.ai.waveT;
      state.ai.waveNo = data.ai.waveNo;
    }
    return state;
  }

  function save() {
    const state = RTS.game.state;
    if (!state) return false;
    try {
      localStorage.setItem(KEY, JSON.stringify(serialize(state)));
      return true;
    } catch (e) {
      console.error('save failed', e);
      return false;
    }
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (data.v !== 1) return null;
      const state = deserialize(data);
      RTS.game.state = state;
      RTS.game.computeFog(state, true);
      return state;
    } catch (e) {
      console.error('load failed', e);
      return null;
    }
  }

  function hasSave() {
    try { return !!localStorage.getItem(KEY); } catch (e) { return false; }
  }

  return { save: save, load: load, hasSave: hasSave };
})();
