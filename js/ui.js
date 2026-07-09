/* ============ ui.js — HUD: resources, minimap, build menu, unit panel, toasts ============ */
window.RTS = window.RTS || {};

RTS.ui = (function () {
  'use strict';
  const U = RTS.util, C = RTS.config;

  const els = {};
  let minimapCtx = null;
  let mmTerrain = null;      // offscreen terrain image (1px per tile)
  let mmTerrainT = 0;
  let panelT = 0;

  /* interaction mode shared with input.js:
     kind: 'none' | 'build' | 'road', type: building type when building */
  const mode = { kind: 'none', type: null };
  /* pending tap-command for touch UIs: 'attack' | 'patrol' | 'capture' | 'repair' | null */
  let pendingCmd = null;

  function $(id) { return document.getElementById(id); }

  function init() {
    els.hud = $('hud');
    els.resM = $('res-minerals'); els.resE = $('res-energy'); els.resW = $('res-water');
    els.clock = $('game-clock');
    els.dayIco = $('daynight-ico');
    els.weatherIco = $('weather-ico');
    els.minimap = $('minimap');
    els.mmView = $('minimap-view');
    els.buildMenu = $('build-menu');
    els.unitPanel = $('unit-panel');
    els.selInfo = $('sel-info');
    els.selActions = $('sel-actions');
    els.prodQueue = $('prod-queue');
    els.toasts = $('toasts');
    els.hint = $('cursor-hint');
    els.intelBarYou = $('intel-bar-you');
    els.intelPanel = $('intel-panel');
    minimapCtx = els.minimap.getContext('2d');

    $('intel-chip').addEventListener('click', function () {
      els.intelPanel.classList.toggle('hidden');
    });

    const muteBtn = $('btn-mute');
    function syncMute() {
      muteBtn.textContent = RTS.sfx.isMuted() ? '✕' : '♪';
      muteBtn.style.opacity = RTS.sfx.isMuted() ? 0.55 : 1;
    }
    muteBtn.addEventListener('click', function () {
      RTS.sfx.setMuted(!RTS.sfx.isMuted());
      syncMute();
    });
    syncMute();

    /* panel tabs */
    document.querySelectorAll('.ptab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        document.querySelectorAll('.ptab').forEach(function (t) { t.classList.remove('active'); });
        tab.classList.add('active');
        const isBuild = tab.dataset.tab === 'build';
        els.buildMenu.classList.toggle('hidden', !isBuild);
        els.unitPanel.classList.toggle('hidden', isBuild);
      });
    });

    /* minimap interaction */
    function mmJump(ev) {
      const state = RTS.game.state;
      if (!state) return;
      const r = els.minimap.getBoundingClientRect();
      const px = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
      const py = (ev.touches ? ev.touches[0].clientY : ev.clientY) - r.top;
      RTS.render.centerOn(px / r.width * state.map.w, py / r.height * state.map.h);
    }
    els.minimap.addEventListener('mousedown', function (ev) {
      mmJump(ev);
      const mv = function (e2) { mmJump(e2); };
      const up = function () {
        window.removeEventListener('mousemove', mv);
        window.removeEventListener('mouseup', up);
      };
      window.addEventListener('mousemove', mv);
      window.addEventListener('mouseup', up);
    });
    els.minimap.addEventListener('touchstart', mmJump, { passive: true });
    els.minimap.addEventListener('touchmove', mmJump, { passive: true });

    buildBuildMenu();
  }

  function show() { els.hud.classList.remove('hidden'); }
  function hide() { els.hud.classList.add('hidden'); }

  function resetForNewGame() {
    mode.kind = 'none'; mode.type = null;
    pendingCmd = null;
    mmTerrain = null;
    pings.length = 0;
    RTS.render.reset();
    RTS.render.overlay.selection = [];
    RTS.render.overlay.ghost = null;
    RTS.render.overlay.roadPath = null;
    buildBuildMenu();
    refreshPanel();
  }

  /* ---------------- build menu ---------------- */
  function costText(cost) {
    const parts = [];
    if (cost.m) parts.push('◆' + cost.m);
    if (cost.e) parts.push('⚡' + cost.e);
    if (cost.w) parts.push('💧' + cost.w);
    return parts.join(' ') || 'free';
  }

  function buildBuildMenu() {
    if (!els.buildMenu) return;
    els.buildMenu.innerHTML = '';
    for (const type of C.BUILD_MENU) {
      const def = C.BUILDINGS[type];
      const btn = document.createElement('button');
      btn.className = 'build-btn';
      btn.dataset.type = type;
      btn.title = def.desc;
      const icon = document.createElement('canvas');
      icon.width = 88; icon.height = 68;
      const spr = RTS.sprites.building(type, 0);
      const ictx = icon.getContext('2d');
      const sc = Math.min(88 / spr.c.width, 68 / spr.c.height) * 0.94;
      ictx.drawImage(spr.c, (88 - spr.c.width * sc) / 2, (68 - spr.c.height * sc) / 2,
        spr.c.width * sc, spr.c.height * sc);
      btn.appendChild(icon);
      const nm = document.createElement('div');
      nm.className = 'bname'; nm.textContent = def.name;
      btn.appendChild(nm);
      const cs = document.createElement('div');
      cs.className = 'bcost'; cs.textContent = costText(def.cost);
      btn.appendChild(cs);
      btn.addEventListener('click', function () {
        if (mode.kind === 'build' && mode.type === type) cancelMode();
        else {
          mode.kind = 'build'; mode.type = type;
          pendingCmd = null;
          refreshBuildButtons();
          toast('Placing: ' + def.name + ' — click the map (Esc to cancel)');
        }
        refreshBuildButtons();
      });
      els.buildMenu.appendChild(btn);
    }
    /* road tool */
    const rbtn = document.createElement('button');
    rbtn.className = 'build-btn';
    rbtn.dataset.type = '__road';
    rbtn.title = 'Pave roads (drag on the map). Roads over water become bridges.';
    const ric = document.createElement('canvas');
    ric.width = 88; ric.height = 68;
    const rctx = ric.getContext('2d');
    rctx.drawImage(RTS.sprites.road(5, 1), 10, 16, 66, 34);
    rbtn.appendChild(ric);
    const rnm = document.createElement('div');
    rnm.className = 'bname'; rnm.textContent = 'Road / Bridge';
    rbtn.appendChild(rnm);
    const rcs = document.createElement('div');
    rcs.className = 'bcost';
    rcs.textContent = '◆' + C.ECON.roadCostPerTile + '/tile (bridge ◆' + C.ECON.bridgeCostPerTile + ')';
    rbtn.appendChild(rcs);
    rbtn.addEventListener('click', function () {
      if (mode.kind === 'road') cancelMode();
      else {
        mode.kind = 'road'; mode.type = null;
        pendingCmd = null;
        toast('Road tool: drag on the map to pave (Esc to cancel)');
      }
      refreshBuildButtons();
    });
    els.buildMenu.appendChild(rbtn);
  }

  function refreshBuildButtons() {
    const state = RTS.game.state;
    if (!state) return;
    const player = state.players[state.localPlayer];
    els.buildMenu.querySelectorAll('.build-btn').forEach(function (btn) {
      const type = btn.dataset.type;
      if (type === '__road') {
        btn.classList.toggle('selected', mode.kind === 'road');
        btn.classList.toggle('disabled', player.res.m < C.ECON.roadCostPerTile);
        return;
      }
      const def = C.BUILDINGS[type];
      const afford = player.res.m >= (def.cost.m || 0) &&
                     player.res.e >= (def.cost.e || 0) &&
                     player.res.w >= (def.cost.w || 0);
      btn.classList.toggle('disabled', !afford);
      btn.classList.toggle('selected', mode.kind === 'build' && mode.type === type);
    });
  }

  function cancelMode() {
    mode.kind = 'none'; mode.type = null;
    pendingCmd = null;
    RTS.render.overlay.ghost = null;
    RTS.render.overlay.roadPath = null;
    refreshBuildButtons();
  }

  /* ---------------- selection panel ---------------- */
  function selectTab(name) {
    document.querySelectorAll('.ptab').forEach(function (t) {
      t.classList.toggle('active', t.dataset.tab === name);
    });
    els.buildMenu.classList.toggle('hidden', name !== 'build');
    els.unitPanel.classList.toggle('hidden', name === 'build');
  }

  function onSelectionChanged() {
    const sel = RTS.render.overlay.selection;
    if (sel.length > 0) selectTab('units');
    refreshPanel();
  }

  function actBtn(label, title, onClick, cls) {
    const b = document.createElement('button');
    b.className = 'act-btn' + (cls ? ' ' + cls : '');
    b.textContent = label;
    if (title) b.title = title;
    b.addEventListener('click', onClick);
    return b;
  }

  function refreshPanel() {
    const state = RTS.game.state;
    if (!state) return;
    const sel = RTS.render.overlay.selection.filter(function (e) { return !e.dead; });
    els.selActions.innerHTML = '';
    els.prodQueue.innerHTML = '';

    if (sel.length === 0) {
      els.selInfo.textContent = 'No selection. Drag on the map to select units.';
      return;
    }

    const mine = sel.filter(function (e) { return e.owner === state.localPlayer; });
    const units = mine.filter(function (e) { return e.kind === 'unit'; });
    const bld = mine.length === 1 && mine[0].kind === 'building' ? mine[0] : null;

    /* info line */
    if (units.length > 0) {
      const byType = {};
      for (const u of units) byType[u.type] = (byType[u.type] || 0) + 1;
      els.selInfo.textContent = Object.keys(byType).map(function (t) {
        return byType[t] + '× ' + C.UNITS[t].name;
      }).join(', ');
    } else if (bld) {
      const def = C.BUILDINGS[bld.type];
      els.selInfo.textContent = def.name + ' — ' + Math.ceil(bld.hp) + '/' + bld.maxHp + ' HP' +
        (bld.complete ? '' : ' (building… ' + Math.round(bld.progress * 100) + '%)');
    } else if (sel.length === 1) {
      const e = sel[0];
      const nm = e.kind === 'building' ? C.BUILDINGS[e.type].name : C.UNITS[e.type].name;
      const who = e.owner === -1 ? 'Neutral' : state.players[e.owner].name;
      els.selInfo.textContent = who + ' ' + nm + ' — ' + Math.ceil(e.hp) + '/' + e.maxHp + ' HP';
      if (e.owner === -1) {
        els.selInfo.textContent += '. Send an Engineer to capture it.';
      }
      return;
    } else {
      els.selInfo.textContent = sel.length + ' objects';
      return;
    }

    /* unit actions */
    if (units.length > 0) {
      const ids = units.map(function (u) { return u.id; });
      const stances = [['guard', 'Guard', 'Hold ground, engage nearby enemies'],
                       ['assault', 'Assault', 'Attack-ready: chase anything in sight'],
                       ['hold', 'Hold', 'Hold fire position, never move']];
      for (const s of stances) {
        const on = units.every(function (u) { return u.stance === s[0]; });
        els.selActions.appendChild(actBtn(s[1], s[2], function () {
          RTS.game.issue({ c: 'stance', p: state.localPlayer, ids: ids, s: s[0] });
          setTimeout(refreshPanel, 120);
        }, on ? 'on' : ''));
      }
      els.selActions.appendChild(actBtn('Attack ➤', 'Then tap/click a target or spot', function () {
        pendingCmd = 'attack'; hintPending();
      }, pendingCmd === 'attack' ? 'on' : ''));
      els.selActions.appendChild(actBtn('Patrol ➤', 'Then tap/click the far patrol point', function () {
        pendingCmd = 'patrol'; hintPending();
      }, pendingCmd === 'patrol' ? 'on' : ''));
      if (units.some(function (u) { return u.type === 'worker'; })) {
        els.selActions.appendChild(actBtn('Capture ➤', 'Then tap/click a neutral building', function () {
          pendingCmd = 'capture'; hintPending();
        }, pendingCmd === 'capture' ? 'on' : ''));
        els.selActions.appendChild(actBtn('Repair ➤', 'Then tap/click one of your buildings', function () {
          pendingCmd = 'repair'; hintPending();
        }, pendingCmd === 'repair' ? 'on' : ''));
      }
      els.selActions.appendChild(actBtn('Stop', 'Cancel orders (S)', function () {
        RTS.game.issue({ c: 'stop', p: state.localPlayer, ids: ids });
      }));
    }

    /* building panel */
    if (bld) {
      const def = C.BUILDINGS[bld.type];
      if (bld.complete && def.trains) {
        for (const ut of def.trains) {
          const ud = C.UNITS[ut];
          els.selActions.appendChild(actBtn('+ ' + ud.name, ud.desc + ' — ' + costText(ud.cost), function () {
            RTS.game.issue({ c: 'train', p: state.localPlayer, b: bld.id, t: ut });
          }));
        }
        els.selActions.appendChild(actBtn('Rally ➤', 'Then click where new units should gather', function () {
          pendingCmd = 'rally'; hintPending();
        }, pendingCmd === 'rally' ? 'on' : ''));
      }
      if (bld.type !== 'hq') {
        els.selActions.appendChild(actBtn('Demolish', 'Tear down for a partial refund', function () {
          RTS.game.issue({ c: 'demolish', p: state.localPlayer, b: bld.id });
          RTS.render.overlay.selection = [];
          refreshPanel();
        }, 'danger'));
      }
      /* queue display */
      for (let qi = 0; qi < bld.queue.length; qi++) {
        const item = bld.queue[qi];
        const ud = C.UNITS[item.type];
        const qd = document.createElement('div');
        qd.className = 'queue-item';
        qd.textContent = ud.name;
        qd.title = 'Click to cancel';
        const pr = document.createElement('div');
        pr.className = 'qprog';
        pr.style.width = Math.round(item.t / ud.buildTime * 100) + '%';
        qd.appendChild(pr);
        (function (index) {
          qd.addEventListener('click', function () {
            RTS.game.issue({ c: 'cancel', p: state.localPlayer, b: bld.id, i: index });
          });
        })(qi);
        els.prodQueue.appendChild(qd);
      }
    }
  }

  function hintPending() {
    toast('Now click / tap the target on the map');
    refreshPanel();
  }

  /* ---------------- per-frame HUD refresh ---------------- */
  function update(dt) {
    const state = RTS.game.state;
    if (!state) return;
    const player = state.players[state.localPlayer];

    setRes(els.resM, player.res.m, player.rate.m);
    setRes(els.resE, player.res.e, player.rate.e);
    setRes(els.resW, player.res.w, player.rate.w);
    els.clock.textContent = U.fmtTime(state.time);

    const dayT = state.dayT;
    const night = Math.max(0, Math.sin((dayT - 0.5) * Math.PI * 2)) > 0.2;
    els.dayIco.textContent = night ? '🌙' : '☀';
    els.weatherIco.textContent = state.weather.type === 'rain' ? '🌧' : state.weather.type === 'fog' ? '🌫' : '';

    panelT -= dt;
    if (panelT <= 0) {
      panelT = 0.5;
      refreshBuildButtons();
      refreshPanel();
      updateIntel(state);
    }
    drawMinimap(state, dt);
  }

  /* ---------------- battlefield intel: how is the other side doing? ---------------- */
  function costValue(cost) { return (cost.m || 0) + (cost.e || 0) + (cost.w || 0); }

  function militaryPower(state, p) {
    let v = 0;
    for (const u of state.units) {
      if (u.dead || u.owner !== p) continue;
      const def = C.UNITS[u.type];
      if (def.weapon) v += costValue(def.cost) * (u.hp / u.maxHp);
    }
    for (const b of state.buildings) {
      if (b.dead || b.owner !== p || !b.complete) continue;
      const def = C.BUILDINGS[b.type];
      if (def.weapon) v += costValue(def.cost) * (b.hp / b.maxHp);
    }
    return Math.round(v);
  }

  function updateIntel(state) {
    const me = state.localPlayer, foe = 1 - me;
    const pow = [militaryPower(state, me), militaryPower(state, foe)];
    const frac = (pow[0] + pow[1]) > 0 ? pow[0] / (pow[0] + pow[1]) : 0.5;
    els.intelBarYou.style.width = Math.round(U.clamp(frac, 0.04, 0.96) * 100) + '%';

    if (els.intelPanel.classList.contains('hidden')) return;
    const cnt = [
      { u: 0, b: 0 }, { u: 0, b: 0 }
    ];
    for (const u of state.units) {
      if (!u.dead && u.owner >= 0) cnt[u.owner === me ? 0 : 1].u++;
    }
    for (const b of state.buildings) {
      if (!b.dead && b.owner >= 0) cnt[b.owner === me ? 0 : 1].b++;
    }
    $('ip-pow0').textContent = pow[0];
    $('ip-pow1').textContent = pow[1];
    $('ip-units0').textContent = cnt[0].u;
    $('ip-units1').textContent = cnt[1].u;
    $('ip-bld0').textContent = cnt[0].b;
    $('ip-bld1').textContent = cnt[1].b;
    $('ip-kill0').textContent = state.stats.unitsKilled[me];
    $('ip-kill1').textContent = state.stats.unitsKilled[foe];
    $('ip-raze0').textContent = state.stats.buildingsRazed[me];
    $('ip-raze1').textContent = state.stats.buildingsRazed[foe];
    $('ip-verdict').textContent =
      state.players[foe].defeated ? 'Enemy command has collapsed.'
      : frac > 0.66 ? 'You hold a decisive military advantage.'
      : frac > 0.55 ? 'You have the upper hand.'
      : frac >= 0.45 ? 'Forces are evenly matched.'
      : frac >= 0.34 ? 'The enemy is gaining strength — reinforce!'
      : 'Enemy forces vastly outnumber yours!';
  }

  function setRes(el, val, rate) {
    el.querySelector('.res-val').textContent = Math.floor(val);
    const r = el.querySelector('.res-rate');
    const v = Math.round(rate * 10) / 10;
    r.textContent = (v >= 0 ? '+' : '') + v;
    r.classList.toggle('neg', v < 0);
  }

  /* ---------------- minimap ---------------- */
  const MM_COLORS = {};
  MM_COLORS[C.T.WATER] = '#1c4c72'; MM_COLORS[C.T.RIVER] = '#2b71a4';
  MM_COLORS[C.T.SAND] = '#c6b37c'; MM_COLORS[C.T.GRASS] = '#5c8f45';
  MM_COLORS[C.T.FOREST] = '#3d6b2e'; MM_COLORS[C.T.HILL] = '#75815b';
  MM_COLORS[C.T.MOUNTAIN] = '#787d86';

  function drawMinimap(state, dt) {
    const map = state.map;
    mmTerrainT -= dt;
    if (!mmTerrain || mmTerrainT <= 0) {
      mmTerrainT = 2;
      mmTerrain = mmTerrain || document.createElement('canvas');
      mmTerrain.width = map.w; mmTerrain.height = map.h;
      const tctx = mmTerrain.getContext('2d');
      const img = tctx.createImageData(map.w, map.h);
      for (let i = 0; i < map.w * map.h; i++) {
        let col;
        if (map.road[i]) col = map.road[i] === 2 ? '#8a6f4d' : '#55585e';
        else if (map.deposit[i]) col = '#9fc0e8';
        else col = MM_COLORS[map.terrain[i]];
        const n = parseInt(col.slice(1), 16);
        const o = i * 4;
        img.data[o] = n >> 16; img.data[o + 1] = (n >> 8) & 0xff; img.data[o + 2] = n & 0xff;
        img.data[o + 3] = 255;
      }
      tctx.putImageData(img, 0, 0);
    }
    const cw = els.minimap.width, ch = els.minimap.height;
    const sx = cw / map.w, sy = ch / map.h;
    minimapCtx.imageSmoothingEnabled = false;
    minimapCtx.drawImage(mmTerrain, 0, 0, cw, ch);

    /* entities */
    for (const b of state.buildings) {
      if (b.dead) continue;
      const i = (b.y | 0) * map.w + (b.x | 0);
      if (!state.fog.explored[i]) continue;
      minimapCtx.fillStyle = b.owner === -1 ? '#c2c6cc' : C.PLAYER_COLORS[b.owner].main;
      minimapCtx.fillRect(b.gx * sx, b.gy * sy, Math.max(2, b.w * sx), Math.max(2, b.h * sy));
    }
    for (const u of state.units) {
      if (u.dead) continue;
      const i = (u.y | 0) * map.w + (u.x | 0);
      if (u.owner !== state.localPlayer && !state.fog.visible[i]) continue;
      minimapCtx.fillStyle = C.PLAYER_COLORS[u.owner].light;
      minimapCtx.fillRect(u.x * sx - 1, u.y * sy - 1, 2, 2);
    }

    /* fog shade */
    minimapCtx.fillStyle = 'rgba(4,7,12,0.85)';
    for (let y = 0; y < map.h; y += 2) {
      for (let x = 0; x < map.w; x += 2) {
        if (!state.fog.explored[y * map.w + x]) {
          minimapCtx.fillRect(x * sx, y * sy, sx * 2, sy * 2);
        }
      }
    }

    /* attack alert pings: pulsing red rings */
    const nowP = performance.now();
    for (let i = pings.length - 1; i >= 0; i--) {
      const pg = pings[i];
      const age = (nowP - pg.t0) / 1000;
      if (age > 4) { pings.splice(i, 1); continue; }
      const pulse = (age * 2.5) % 1;
      minimapCtx.strokeStyle = 'rgba(255,70,50,' + (0.95 - pulse * 0.7) + ')';
      minimapCtx.lineWidth = 1.5;
      minimapCtx.beginPath();
      minimapCtx.arc(pg.x * sx, pg.y * sy, 2 + pulse * 7, 0, Math.PI * 2);
      minimapCtx.stroke();
    }

    /* viewport polygon */
    const vs = RTS.render.viewSize;
    const pts = [
      RTS.render.screenToWorld(0, 0), RTS.render.screenToWorld(vs.w, 0),
      RTS.render.screenToWorld(vs.w, vs.h), RTS.render.screenToWorld(0, vs.h)
    ];
    minimapCtx.strokeStyle = 'rgba(255,255,255,0.8)';
    minimapCtx.lineWidth = 1;
    minimapCtx.beginPath();
    for (let k = 0; k < 4; k++) {
      const px = U.clamp(pts[k].x, 0, map.w) * sx;
      const py = U.clamp(pts[k].y, 0, map.h) * sy;
      if (k === 0) minimapCtx.moveTo(px, py); else minimapCtx.lineTo(px, py);
    }
    minimapCtx.closePath();
    minimapCtx.stroke();
  }

  /* ---------------- toasts & events ---------------- */
  function toast(msg, warn) {
    const t = document.createElement('div');
    t.className = 'toast' + (warn ? ' warn' : '');
    t.textContent = msg;
    els.toasts.appendChild(t);
    setTimeout(function () {
      t.style.opacity = '0';
      t.style.transition = 'opacity .4s';
      setTimeout(function () { t.remove(); }, 420);
    }, 2600);
    while (els.toasts.children.length > 4) els.toasts.firstChild.remove();
  }

  let lastNoFunds = 0;
  let lastAttackToast = 0;
  const pings = []; /* minimap alert blips: {x, y, t0} */

  function onEvent(e) {
    const state = RTS.game.state;
    switch (e.t) {
      case 'attacked':
        if (state && e.owner === state.localPlayer) {
          pings.push({ x: e.x, y: e.y, t0: performance.now() });
          if (pings.length > 8) pings.shift();
          if (performance.now() - lastAttackToast > 15000) {
            lastAttackToast = performance.now();
            toast('⚠ Our base is under attack!', true);
          }
        }
        break;
      case 'nofunds':
        if (performance.now() - lastNoFunds > 1500) {
          lastNoFunds = performance.now();
          toast('Insufficient resources', true);
          [els.resM, els.resE, els.resW].forEach(function (el) {
            el.classList.remove('flash');
            void el.offsetWidth;
            el.classList.add('flash');
          });
        }
        break;
      case 'aiwave':
        toast('⚠ Enemy assault force detected!', true);
        break;
      case 'weather':
        if (e.w === 'rain') toast('Rain moves in over the front.');
        else if (e.w === 'fog') toast('Fog banks roll in — visibility reduced.', true);
        else toast('Skies are clearing.');
        break;
      case 'capture':
        if (state && e.owner === state.localPlayer) toast('Structure captured!');
        break;
      case 'complete':
        if (state && e.owner === state.localPlayer) {
          toast(C.BUILDINGS[e.btype].name + ' construction complete.');
        }
        break;
      case 'netdrop':
        toast('Multiplayer connection lost.', true);
        break;
    }
  }

  return {
    init: init, show: show, hide: hide,
    update: update,
    onEvent: onEvent,
    toast: toast,
    mode: mode,
    cancelMode: cancelMode,
    onSelectionChanged: onSelectionChanged,
    refreshPanel: refreshPanel,
    resetForNewGame: resetForNewGame,
    get pendingCmd() { return pendingCmd; },
    set pendingCmd(v) { pendingCmd = v; }
  };
})();
