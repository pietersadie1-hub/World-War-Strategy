/* ============ input.js — mouse, keyboard and touch controls ============ */
window.RTS = window.RTS || {};

RTS.input = (function () {
  'use strict';
  const U = RTS.util, C = RTS.config;

  let canvas;
  let enabled = false;
  const keys = {};
  let mouseX = 0, mouseY = 0, mouseOver = false;
  let dragSel = null;       // {x0,y0,x1,y1}
  let roadDrag = null;      // {tiles:[], seen:{}, lastGx, lastGy}
  let selBoxEl = null;
  const groups = {};        // ctrl-groups: n -> [ids]
  let lastClickT = 0, lastClickId = 0;

  /* touch state */
  let touchPan = null;      // {x, y, camX, camY}
  let pinch = null;         // {d, zoom}
  let touchDownT = 0, touchMoved = false, longPressTimer = null;

  function init(cv) {
    canvas = cv;
    selBoxEl = document.createElement('div');
    selBoxEl.id = 'selbox';
    selBoxEl.style.display = 'none';
    document.getElementById('game-container').appendChild(selBoxEl);

    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    canvas.addEventListener('mouseenter', function () { mouseOver = true; });
    canvas.addEventListener('mouseleave', function () { mouseOver = false; });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', function (e) { keys[e.code] = false; });

    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: false });
  }

  function setEnabled(v) { enabled = v; }

  function state() { return RTS.game.state; }
  function sel() { return RTS.render.overlay.selection; }
  function mySelectedUnitIds() {
    const st = state();
    return sel().filter(function (e) {
      return !e.dead && e.kind === 'unit' && e.owner === st.localPlayer;
    }).map(function (e) { return e.id; });
  }

  /* ---------------- picking ---------------- */
  function pickEntity(sx, sy) {
    const st = state();
    if (!st) return null;
    const w = RTS.render.screenToWorld(sx, sy);
    /* units first (small, on top) */
    let best = null, bestD = 1.2;
    for (const u of st.units) {
      if (u.dead) continue;
      const i = (u.y | 0) * st.map.w + (u.x | 0);
      if (u.owner !== st.localPlayer && !st.fog.visible[i]) continue;
      const dy = C.UNITS[u.type].air ? 1.3 : 0; // air units drawn above their tile
      const d = U.dist(w.x, w.y, u.x - dy, u.y - dy);
      if (d < bestD) { bestD = d; best = u; }
    }
    if (best) return best;
    const gx = Math.floor(w.x), gy = Math.floor(w.y);
    for (const b of st.buildings) {
      if (b.dead) continue;
      const i = (b.y | 0) * st.map.w + (b.x | 0);
      if (!st.fog.explored[i]) continue;
      if (gx >= b.gx && gx < b.gx + b.w && gy >= b.gy && gy < b.gy + b.h) return b;
      /* also allow clicking the raised part of the sprite (one tile up-screen) */
      if (gx + 1 >= b.gx && gx + 1 < b.gx + b.w && gy + 1 >= b.gy && gy + 1 < b.gy + b.h) return b;
    }
    return null;
  }

  /* ---------------- primary action (click / tap) ---------------- */
  function primaryAt(sx, sy, isTap) {
    const st = state();
    if (!st) return;
    const ui = RTS.ui;
    const w = RTS.render.screenToWorld(sx, sy);

    /* build placement */
    if (ui.mode.kind === 'build') {
      const def = C.BUILDINGS[ui.mode.type];
      const gx = Math.round(w.x - def.w / 2), gy = Math.round(w.y - def.h / 2);
      if (RTS.game.canPlace(st, st.localPlayer, ui.mode.type, gx, gy)) {
        RTS.game.issue({ c: 'build', p: st.localPlayer, t: ui.mode.type, x: gx, y: gy });
        if (!keys.ShiftLeft && !keys.ShiftRight) ui.cancelMode();
      } else {
        ui.toast('Cannot build there', true);
      }
      return;
    }

    /* pending targeted command (from panel buttons or hotkeys) */
    const pc = ui.pendingCmd;
    if (pc) {
      const ids = mySelectedUnitIds();
      const ent = pickEntity(sx, sy);
      if (pc === 'attack') {
        if (ent && ent.owner !== st.localPlayer && ent.owner !== -1 && ids.length) {
          RTS.game.issue({ c: 'attack', p: st.localPlayer, ids: ids, target: ent.id });
        } else if (ids.length) {
          RTS.game.issue({ c: 'attackmove', p: st.localPlayer, ids: ids, x: w.x, y: w.y });
        }
      } else if (pc === 'patrol' && ids.length) {
        RTS.game.issue({ c: 'patrol', p: st.localPlayer, ids: ids, x: w.x, y: w.y });
      } else if (pc === 'capture' && ent && ent.kind === 'building' && ent.owner === -1) {
        RTS.game.issue({ c: 'capture', p: st.localPlayer, ids: ids, target: ent.id });
      } else if (pc === 'repair' && ent && ent.kind === 'building' && ent.owner === st.localPlayer) {
        RTS.game.issue({ c: 'repair', p: st.localPlayer, ids: ids, target: ent.id });
      } else if (pc === 'rally') {
        const b = sel().find(function (e) { return e.kind === 'building'; });
        if (b) RTS.game.issue({ c: 'rally', p: st.localPlayer, b: b.id, x: w.x, y: w.y });
      }
      ui.pendingCmd = null;
      RTS.ui.refreshPanel();
      return;
    }

    /* plain click: select, or (on touch, with units selected) order a move */
    const ent = pickEntity(sx, sy);
    if (ent) {
      const now = performance.now();
      if (now - lastClickT < 350 && ent.id === lastClickId && ent.kind === 'unit') {
        /* double-click: select all same-type units on screen */
        selectSameTypeOnScreen(ent);
      } else {
        RTS.render.overlay.selection = [ent];
      }
      lastClickT = now; lastClickId = ent.id;
      RTS.ui.onSelectionChanged();
    } else if (isTap) {
      const ids = mySelectedUnitIds();
      if (ids.length) {
        RTS.game.issue({ c: 'move', p: st.localPlayer, ids: ids, x: w.x, y: w.y });
      } else {
        RTS.render.overlay.selection = [];
        RTS.ui.onSelectionChanged();
      }
    } else {
      RTS.render.overlay.selection = [];
      RTS.ui.onSelectionChanged();
    }
  }

  function selectSameTypeOnScreen(u) {
    const st = state();
    const vs = RTS.render.viewSize;
    const out = [];
    for (const e of st.units) {
      if (e.dead || e.owner !== u.owner || e.type !== u.type) continue;
      const p = RTS.render.worldToScreen(e.x, e.y);
      if (p.x >= -20 && p.x <= vs.w + 20 && p.y >= -20 && p.y <= vs.h + 20) out.push(e);
    }
    RTS.render.overlay.selection = out.length ? out : [u];
  }

  /* ---------------- secondary action (right-click) : context order ---------------- */
  function secondaryAt(sx, sy) {
    const st = state();
    if (!st) return;
    if (RTS.ui.mode.kind !== 'none') { RTS.ui.cancelMode(); return; }
    const ids = mySelectedUnitIds();
    const w = RTS.render.screenToWorld(sx, sy);
    const ent = pickEntity(sx, sy);

    /* selected building: set rally */
    if (!ids.length) {
      const b = sel().find(function (e) {
        return e.kind === 'building' && e.owner === st.localPlayer && !e.dead;
      });
      if (b && C.BUILDINGS[b.type].trains) {
        RTS.game.issue({ c: 'rally', p: st.localPlayer, b: b.id, x: w.x, y: w.y });
        RTS.ui.toast('Rally point set');
      }
      return;
    }

    if (ent && ent.owner !== st.localPlayer) {
      if (ent.owner === -1) {
        /* neutral: capture if engineers selected, else just move next to it */
        const st2 = state();
        const hasWorker = sel().some(function (e) { return e.kind === 'unit' && e.type === 'worker' && e.owner === st2.localPlayer; });
        if (hasWorker && ent.kind === 'building') {
          RTS.game.issue({ c: 'capture', p: st.localPlayer, ids: ids, target: ent.id });
          return;
        }
        RTS.game.issue({ c: 'move', p: st.localPlayer, ids: ids, x: w.x, y: w.y });
        return;
      }
      RTS.game.issue({ c: 'attack', p: st.localPlayer, ids: ids, target: ent.id });
      return;
    }
    if (ent && ent.kind === 'building' && ent.owner === st.localPlayer) {
      const hasWorker = sel().some(function (e) { return e.kind === 'unit' && e.type === 'worker'; });
      if (hasWorker && (!ent.complete || ent.hp < ent.maxHp)) {
        RTS.game.issue({ c: 'repair', p: st.localPlayer, ids: ids, target: ent.id });
        RTS.ui.toast(ent.complete ? 'Repairing…' : 'Engineer assisting construction');
        return;
      }
    }
    RTS.game.issue({ c: 'move', p: st.localPlayer, ids: ids, x: w.x, y: w.y });
  }

  /* ---------------- mouse ---------------- */
  function onMouseDown(e) {
    if (!enabled || !state()) return;
    mouseX = e.clientX; mouseY = e.clientY;
    if (e.button === 0) {
      const ui = RTS.ui;
      if (ui.mode.kind === 'road') {
        roadDrag = { tiles: [], seen: {}, lastGx: null, lastGy: null };
        addRoadPoint(e.clientX, e.clientY);
        return;
      }
      if (ui.mode.kind === 'build' || ui.pendingCmd) {
        primaryAt(e.clientX, e.clientY, false);
        return;
      }
      dragSel = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY };
    } else if (e.button === 2) {
      secondaryAt(e.clientX, e.clientY);
    }
  }

  function onMouseMove(e) {
    mouseX = e.clientX; mouseY = e.clientY;
    if (!enabled || !state()) return;
    if (dragSel) {
      dragSel.x1 = e.clientX; dragSel.y1 = e.clientY;
      const x = Math.min(dragSel.x0, dragSel.x1), y = Math.min(dragSel.y0, dragSel.y1);
      const w = Math.abs(dragSel.x1 - dragSel.x0), h = Math.abs(dragSel.y1 - dragSel.y0);
      if (w + h > 8) {
        selBoxEl.style.display = 'block';
        selBoxEl.style.left = x + 'px'; selBoxEl.style.top = y + 'px';
        selBoxEl.style.width = w + 'px'; selBoxEl.style.height = h + 'px';
      }
    }
    if (roadDrag) addRoadPoint(e.clientX, e.clientY);
    updateGhost();
  }

  function onMouseUp(e) {
    if (!enabled || !state()) return;
    if (e.button !== 0) return;
    if (roadDrag) {
      const tiles = roadDrag.tiles.filter(function (t) { return t.cost >= 0; })
        .map(function (t) { return [t.x, t.y]; });
      if (tiles.length) {
        RTS.game.issue({ c: 'road', p: state().localPlayer, tiles: tiles });
      }
      roadDrag = null;
      RTS.render.overlay.roadPath = null;
      return;
    }
    if (dragSel) {
      const w = Math.abs(dragSel.x1 - dragSel.x0), h = Math.abs(dragSel.y1 - dragSel.y0);
      if (w + h > 8) boxSelect(dragSel);
      else primaryAt(e.clientX, e.clientY, false);
      dragSel = null;
      selBoxEl.style.display = 'none';
    }
  }

  function boxSelect(box) {
    const st = state();
    const x0 = Math.min(box.x0, box.x1), x1 = Math.max(box.x0, box.x1);
    const y0 = Math.min(box.y0, box.y1), y1 = Math.max(box.y0, box.y1);
    const out = [];
    for (const u of st.units) {
      if (u.dead || u.owner !== st.localPlayer) continue;
      const p = RTS.render.worldToScreen(u.x, u.y);
      const dy = C.UNITS[u.type].air ? 30 : 8;
      if (p.x >= x0 && p.x <= x1 && p.y - dy >= y0 - 20 && p.y - dy <= y1 + 10) out.push(u);
    }
    /* prefer combat units: if any non-worker present, drop workers from box */
    if (out.some(function (u) { return u.type !== 'worker'; }) &&
        out.some(function (u) { return u.type === 'worker'; }) && out.length > 1) {
      /* keep workers only if everything is workers */
    }
    RTS.render.overlay.selection = out;
    RTS.ui.onSelectionChanged();
  }

  function onWheel(e) {
    if (!enabled || !state()) return;
    e.preventDefault();
    const cam = RTS.render.camera;
    const before = RTS.render.screenToWorld(e.clientX, e.clientY);
    cam.zoom = U.clamp(cam.zoom * (e.deltaY > 0 ? 0.88 : 1.14), 0.45, 2.2);
    const after = RTS.render.screenToWorld(e.clientX, e.clientY);
    cam.x += before.x - after.x;
    cam.y += before.y - after.y;
  }

  /* ---------------- road tool helpers ---------------- */
  function addRoadPoint(sx, sy) {
    const st = state();
    const w = RTS.render.screenToWorld(sx, sy);
    const gx = Math.floor(w.x), gy = Math.floor(w.y);
    if (roadDrag.lastGx === null) {
      pushRoadTile(gx, gy);
    } else if (gx !== roadDrag.lastGx || gy !== roadDrag.lastGy) {
      /* walk a line from last to current */
      let x = roadDrag.lastGx, y = roadDrag.lastGy;
      let guard = 0;
      while ((x !== gx || y !== gy) && guard++ < 64) {
        if (Math.abs(gx - x) >= Math.abs(gy - y)) x += Math.sign(gx - x);
        else y += Math.sign(gy - y);
        pushRoadTile(x, y);
      }
    }
    roadDrag.lastGx = gx; roadDrag.lastGy = gy;
    RTS.render.overlay.roadPath = roadDrag.tiles;
  }

  function pushRoadTile(x, y) {
    const k = x + ',' + y;
    if (roadDrag.seen[k]) return;
    roadDrag.seen[k] = true;
    roadDrag.tiles.push({ x: x, y: y, cost: RTS.game.roadTileCost(state(), x, y) });
  }

  function updateGhost() {
    const st = state();
    const ui = RTS.ui;
    if (!st || ui.mode.kind !== 'build' || !mouseOver) {
      if (RTS.render.overlay.ghost && ui.mode.kind !== 'build') RTS.render.overlay.ghost = null;
      if (!mouseOver) return;
      if (ui.mode.kind !== 'build') return;
    }
    if (ui.mode.kind === 'build') {
      const def = C.BUILDINGS[ui.mode.type];
      const w = RTS.render.screenToWorld(mouseX, mouseY);
      const gx = Math.round(w.x - def.w / 2), gy = Math.round(w.y - def.h / 2);
      RTS.render.overlay.ghost = {
        type: ui.mode.type, gx: gx, gy: gy,
        ok: RTS.game.canPlace(st, st.localPlayer, ui.mode.type, gx, gy)
      };
    }
  }

  /* ---------------- keyboard ---------------- */
  function onKeyDown(e) {
    keys[e.code] = true;
    if (!enabled || !state()) return;
    const st = state();
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if (e.code === 'Escape') {
      if (RTS.ui.mode.kind !== 'none' || RTS.ui.pendingCmd) {
        RTS.ui.cancelMode();
        RTS.ui.refreshPanel();
      } else if (sel().length) {
        RTS.render.overlay.selection = [];
        RTS.ui.onSelectionChanged();
      } else {
        RTS.main.togglePause();
      }
      return;
    }
    if (e.code === 'KeyA' && !e.ctrlKey) {
      if (mySelectedUnitIds().length) { RTS.ui.pendingCmd = 'attack'; RTS.ui.refreshPanel(); }
    } else if (e.code === 'KeyP') {
      if (mySelectedUnitIds().length) { RTS.ui.pendingCmd = 'patrol'; RTS.ui.refreshPanel(); }
    } else if (e.code === 'KeyS' && !e.ctrlKey) {
      const ids = mySelectedUnitIds();
      if (ids.length) RTS.game.issue({ c: 'stop', p: st.localPlayer, ids: ids });
    } else if (e.code === 'KeyG') {
      const ids = mySelectedUnitIds();
      if (ids.length) RTS.game.issue({ c: 'stance', p: st.localPlayer, ids: ids, s: 'guard' });
    } else if (e.code === 'KeyH') {
      const ids = mySelectedUnitIds();
      if (ids.length) RTS.game.issue({ c: 'stance', p: st.localPlayer, ids: ids, s: 'hold' });
    } else if (e.code === 'KeyF') {
      const ids = mySelectedUnitIds();
      if (ids.length) RTS.game.issue({ c: 'stance', p: st.localPlayer, ids: ids, s: 'assault' });
    } else if (e.code === 'F5') {
      e.preventDefault();
      if (RTS.save.save()) RTS.ui.toast('Game saved.');
    } else if (e.code === 'F9') {
      e.preventDefault();
      RTS.main.quickLoad();
    } else if (e.code.indexOf('Digit') === 0) {
      const n = +e.code.slice(5);
      if (n >= 1 && n <= 9) {
        if (e.ctrlKey) {
          groups[n] = mySelectedUnitIds();
          RTS.ui.toast('Group ' + n + ' assigned (' + groups[n].length + ' units)');
          e.preventDefault();
        } else if (groups[n] && groups[n].length) {
          const out = [];
          for (const id of groups[n]) {
            const u = st.byId[id];
            if (u && !u.dead) out.push(u);
          }
          RTS.render.overlay.selection = out;
          RTS.ui.onSelectionChanged();
          if (out.length) {
            /* double-press centers camera */
            const now = performance.now();
            if (this._lastGroupT && now - this._lastGroupT < 400 && this._lastGroupN === n) {
              RTS.render.centerOn(out[0].x, out[0].y);
            }
            this._lastGroupT = now; this._lastGroupN = n;
          }
        }
      }
    }
  }

  /* ---------------- touch ---------------- */
  function onTouchStart(e) {
    if (!enabled || !state()) return;
    e.preventDefault();
    touchMoved = false;
    if (e.touches.length === 1) {
      const t = e.touches[0];
      mouseX = t.clientX; mouseY = t.clientY;
      touchDownT = performance.now();
      const cam = RTS.render.camera;
      touchPan = { x: t.clientX, y: t.clientY, camX: cam.x, camY: cam.y };
      if (RTS.ui.mode.kind === 'road') {
        roadDrag = { tiles: [], seen: {}, lastGx: null, lastGy: null };
        addRoadPoint(t.clientX, t.clientY);
        touchPan = null;
      }
      /* long-press = attack-move for selected units */
      longPressTimer = setTimeout(function () {
        if (!touchMoved && !RTS.ui.pendingCmd && RTS.ui.mode.kind === 'none') {
          const ids = mySelectedUnitIds();
          if (ids.length) {
            const w = RTS.render.screenToWorld(mouseX, mouseY);
            RTS.game.issue({ c: 'attackmove', p: state().localPlayer, ids: ids, x: w.x, y: w.y });
            RTS.ui.toast('Attack-move');
            if (navigator.vibrate) navigator.vibrate(30);
            touchPan = null;
            touchDownT = 0;
          }
        }
      }, 520);
    } else if (e.touches.length === 2) {
      clearTimeout(longPressTimer);
      touchPan = null;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinch = { d: Math.hypot(dx, dy), zoom: RTS.render.camera.zoom };
    }
  }

  function onTouchMove(e) {
    if (!enabled || !state()) return;
    e.preventDefault();
    if (e.touches.length === 1) {
      const t = e.touches[0];
      mouseX = t.clientX; mouseY = t.clientY;
      if (roadDrag) { addRoadPoint(t.clientX, t.clientY); return; }
      if (!touchPan) return;
      const dx = t.clientX - touchPan.x, dy = t.clientY - touchPan.y;
      if (Math.abs(dx) + Math.abs(dy) > 10) touchMoved = true;
      if (touchMoved) {
        clearTimeout(longPressTimer);
        const z = RTS.render.camera.zoom;
        const wx = (dx / (C.TILE_W / 2) + dy / (C.TILE_H / 2)) / 2 / z;
        const wy = (dy / (C.TILE_H / 2) - dx / (C.TILE_W / 2)) / 2 / z;
        RTS.render.camera.x = touchPan.camX - wx;
        RTS.render.camera.y = touchPan.camY - wy;
      }
    } else if (e.touches.length === 2 && pinch) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const d = Math.hypot(dx, dy);
      RTS.render.camera.zoom = U.clamp(pinch.zoom * d / pinch.d, 0.45, 2.2);
    }
  }

  function onTouchEnd(e) {
    if (!enabled || !state()) return;
    e.preventDefault();
    clearTimeout(longPressTimer);
    if (roadDrag) {
      const tiles = roadDrag.tiles.filter(function (t) { return t.cost >= 0; })
        .map(function (t) { return [t.x, t.y]; });
      if (tiles.length) RTS.game.issue({ c: 'road', p: state().localPlayer, tiles: tiles });
      roadDrag = null;
      RTS.render.overlay.roadPath = null;
      return;
    }
    if (e.touches.length === 0) {
      pinch = null;
      if (!touchMoved && touchDownT && performance.now() - touchDownT < 500) {
        primaryAt(mouseX, mouseY, true);
      }
      touchPan = null;
      touchDownT = 0;
    }
  }

  /* ---------------- per-frame: key & edge panning ---------------- */
  function update(dt) {
    if (!enabled || !state()) return;
    const cam = RTS.render.camera;
    const sp = 22 * dt / cam.zoom;
    let mx = 0, my = 0;
    if (keys.KeyW || keys.ArrowUp) my -= 1;
    if (keys.KeyS && false) my += 0; // KeyS reserved for stop
    if (keys.ArrowDown) my += 1;
    if (keys.KeyA && (keys.ControlLeft || keys.ControlRight)) { /* reserved */ }
    if (keys.ArrowLeft) mx -= 1;
    if (keys.ArrowRight) mx += 1;
    /* edge pan (desktop, mouse near border) */
    if (mouseOver && !('ontouchstart' in window)) {
      const vs = RTS.render.viewSize, M = 14;
      if (mouseX < M) mx -= 1;
      if (mouseX > vs.w - M) mx += 1;
      if (mouseY < M) my -= 1;
      if (mouseY > vs.h - M) my += 1;
    }
    if (mx || my) {
      /* screen-space pan converted to world axes */
      cam.x += (mx + my) * sp * 0.5;
      cam.y += (my - mx) * sp * 0.5;
    }
    updateGhost();
  }

  return { init: init, setEnabled: setEnabled, update: update };
})();
