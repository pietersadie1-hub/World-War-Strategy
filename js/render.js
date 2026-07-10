/* ============ render.js — isometric world renderer ============
   Terrain, roads, decor, buildings, units, projectiles, particles,
   fog of war, day/night lighting and weather effects. */
window.RTS = window.RTS || {};

RTS.render = (function () {
  'use strict';
  const U = RTS.util, C = RTS.config, S = RTS.sprites, T = C.T;
  const TW = C.TILE_W, TH = C.TILE_H, TW2 = TW / 2, TH2 = TH / 2;

  let canvas, ctx, fxCanvas, fxCtx;
  let vw = 0, vh = 0, dpr = 1;
  const camera = { x: 12, y: 12, zoom: 1 };
  let particles = [];
  let rainDrops = [];
  let shake = 0;

  /* UI-driven overlays */
  const overlay = {
    ghost: null,           // {type, gx, gy, ok}
    roadPath: null,        // [{x, y, cost}]
    selection: [],         // entity refs
    hoverEnt: null
  };

  let fogCanvas, fogCtx;   // 1px-per-tile fog layer, iso-transformed on draw

  function init(c1, c2) {
    canvas = c1; ctx = canvas.getContext('2d');
    fxCanvas = c2; fxCtx = fxCanvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  }

  function resize() {
    /* cap the backing resolution — full 2x retina fill-rate tanks weak GPUs */
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    vw = window.innerWidth; vh = window.innerHeight;
    canvas.width = vw * dpr; canvas.height = vh * dpr;
    fxCanvas.width = vw * dpr; fxCanvas.height = vh * dpr;
  }

  /* ---------------- transforms ---------------- */
  function worldToScreen(x, y) {
    const z = camera.zoom;
    return {
      x: ((x - y) - (camera.x - camera.y)) * TW2 * z + vw / 2,
      y: ((x + y) - (camera.x + camera.y)) * TH2 * z + vh / 2
    };
  }
  function screenToWorld(sx, sy) {
    const z = camera.zoom;
    const ix = (sx - vw / 2) / (TW2 * z);
    const iy = (sy - vh / 2) / (TH2 * z);
    return {
      x: (ix + iy) / 2 + camera.x,
      y: (iy - ix) / 2 + camera.y
    };
  }
  function centerOn(x, y) { camera.x = x; camera.y = y; }

  function clampCamera(map) {
    camera.x = U.clamp(camera.x, 2, map.w - 2);
    camera.y = U.clamp(camera.y, 2, map.h - 2);
    camera.zoom = U.clamp(camera.zoom, 0.45, 2.2);
  }

  /* ---------------- events -> effects ---------------- */
  let decals = []; // persistent battle scars: scorch marks, vehicle wrecks

  /* click-order feedback pulse: green = move, red = attack, gold = support */
  const MARKER_COLS = { move: '110,230,140', attack: '240,90,70', support: '255,215,94' };
  function orderMarker(x, y, kind) {
    particles.push({
      type: 'marker', x: x, y: y, z: 0, life: 0, ttl: 0.7,
      col: MARKER_COLS[kind] || MARKER_COLS.move
    });
  }

  function addDecal(x, y, size, type) {
    decals.push({ x: x, y: y, size: size, type: type, life: 0, ttl: type === 'wreck' ? 34 : 22, rot: Math.random() * Math.PI });
    if (decals.length > 70) decals.shift();
  }

  function onEvent(e) {
    if (e.t === 'explosion') {
      spawnExplosion(e.x, e.y, e.s || 1, e);
      if (e.s > 1) shake = Math.min(12, shake + e.s * 3.2);
    } else if (e.t === 'muzzle') {
      /* directional muzzle flash + smoke wisp */
      particles.push({
        type: 'muzzleflash', x: e.x, y: e.y, z: e.z || 0.4, dir: e.dir,
        life: 0, ttl: 0.08, size: e.kind === 'shell' ? 12 : e.kind === 'rocket' ? 9 : 6
      });
      if (e.kind === 'shell' || e.kind === 'arc') {
        particles.push({
          type: 'smoke', x: e.x, y: e.y, z: e.z || 0.4,
          vx: Math.cos(e.dir) * 1.2, vy: Math.sin(e.dir) * 1.2, vz: 0.4,
          life: 0, ttl: 0.5, size: 2.5
        });
      }
    } else if (e.t === 'hit') {
      const z = e.z || 0.4;
      if (e.kind === 'bullet') {
        for (let k = 0; k < 4; k++) {
          particles.push({
            type: 'spark', x: e.x, y: e.y, z: z,
            vx: (Math.random() - 0.5) * 3, vy: (Math.random() - 0.5) * 3, vz: Math.random() * 2.5,
            life: 0, ttl: 0.3 + Math.random() * 0.2, size: 2
          });
        }
      } else {
        /* shells & rockets pop properly on impact */
        particles.push({ type: 'boom', x: e.x, y: e.y, z: z, life: 0, ttl: 0.22, size: 0.5 });
        for (let k = 0; k < 5; k++) {
          particles.push({
            type: k < 3 ? 'spark' : 'dirt', x: e.x, y: e.y, z: z,
            vx: (Math.random() - 0.5) * 4.5, vy: (Math.random() - 0.5) * 4.5, vz: 1 + Math.random() * 3,
            life: 0, ttl: 0.35 + Math.random() * 0.3, size: 2 + Math.random() * 2
          });
        }
        particles.push({
          type: 'smoke', x: e.x, y: e.y, z: z, vx: 0, vy: 0, vz: 0.9,
          life: 0, ttl: 0.7, size: 3
        });
      }
    } else if (e.t === 'roads') {
      const st = RTS.game.state;
      if (st) invalidateTiles(st, e.tiles);
    } else if (e.t === 'capture') {
      particles.push({ type: 'ring', x: e.x, y: e.y, z: 0, life: 0, ttl: 0.8, size: 1.6, col: '120,220,140' });
    } else if (e.t === 'complete') {
      particles.push({ type: 'ring', x: e.x, y: e.y, z: 0, life: 0, ttl: 0.6, size: 1.2, col: '150,190,255' });
    }
  }

  function spawnExplosion(x, y, s, meta) {
    meta = meta || {};
    /* bright core + fast shockwave + warm ring */
    particles.push({ type: 'boom', x: x, y: y, z: 0.3, life: 0, ttl: 0.32, size: s });
    particles.push({ type: 'shock', x: x, y: y, z: 0, life: 0, ttl: 0.26, size: s * 1.9 });
    particles.push({ type: 'ring', x: x, y: y, z: 0, life: 0, ttl: 0.5, size: s * 1.5, col: '255,180,90' });
    /* sparks, debris, dirt */
    const n = Math.round(8 + s * 7);
    for (let k = 0; k < n; k++) {
      const r = Math.random();
      particles.push({
        type: r < 0.35 ? 'debris' : r < 0.6 ? 'spark' : 'dirt',
        x: x, y: y, z: 0.3,
        vx: (Math.random() - 0.5) * 5 * s, vy: (Math.random() - 0.5) * 5 * s,
        vz: 1.5 + Math.random() * 4 * s,
        life: 0, ttl: 0.5 + Math.random() * 0.9, size: 2 + Math.random() * 3 * s
      });
    }
    /* fire pockets + rising smoke column */
    const smokes = Math.round(3 + s * 3);
    for (let k = 0; k < smokes; k++) {
      particles.push({
        type: 'smoke', x: x + (Math.random() - 0.5) * 0.5 * s, y: y + (Math.random() - 0.5) * 0.5 * s,
        z: 0.3, vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4, vz: 0.9 + Math.random(),
        delay: k * 0.12, life: 0, ttl: 0.9 + Math.random() * 1.1, size: 3 + s * 2.2
      });
    }
    for (let k = 0; k < Math.round(s * 3); k++) {
      particles.push({
        type: 'fire', x: x + (Math.random() - 0.5) * 0.8 * s, y: y + (Math.random() - 0.5) * 0.8 * s,
        z: 0.15, vx: 0, vy: 0, vz: 0.7,
        delay: Math.random() * 0.25, life: 0, ttl: 0.4 + Math.random() * 0.5, size: 2.5 + Math.random() * 2.5
      });
    }
    /* buildings collapse with staggered secondary blasts */
    if (meta.building) {
      for (let k = 0; k < 3; k++) {
        particles.push({
          type: 'boom', x: x + (Math.random() - 0.5) * s, y: y + (Math.random() - 0.5) * s,
          z: 0.3, delay: 0.14 + k * 0.16, life: 0, ttl: 0.26, size: s * 0.45
        });
      }
      shake = Math.min(14, shake + 4);
    }
    /* lasting scars on the ground */
    if (!meta.air) {
      if (meta.utype === 'tank' || meta.utype === 'artillery') addDecal(x, y, 0.8, 'wreck');
      else if (meta.building || s >= 0.9) addDecal(x, y, Math.min(2.4, s), 'scorch');
    }
  }

  /* ---------------- fog layer ---------------- */
  function updateFogCanvas(state) {
    const map = state.map;
    if (!fogCanvas) {
      fogCanvas = document.createElement('canvas');
      fogCanvas.width = map.w; fogCanvas.height = map.h;
      fogCtx = fogCanvas.getContext('2d');
    }
    const img = fogCtx.createImageData(map.w, map.h);
    const d = img.data;
    const fog = state.fog;
    for (let i = 0; i < map.w * map.h; i++) {
      const o = i * 4;
      d[o] = 4; d[o + 1] = 7; d[o + 2] = 12;
      d[o + 3] = fog.explored[i] ? (fog.visible[i] ? 0 : 120) : 255;
    }
    fogCtx.putImageData(img, 0, 0);
  }

  /* ---------------- main draw ---------------- */
  let waterFrame = 0, fogUpdateT = 0;

  function render(alpha, dtF, nowMs) {
    const state = RTS.game.state;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!state) {
      ctx.fillStyle = '#0a0e14';
      ctx.fillRect(0, 0, vw, vh);
      return;
    }
    clampCamera(state.map);
    waterFrame = Math.floor(state.time * 2.4) % 3;

    /* screen shake */
    let shx = 0, shy = 0;
    if (shake > 0.2) {
      shx = (Math.random() - 0.5) * shake;
      shy = (Math.random() - 0.5) * shake;
      shake *= Math.pow(0.02, dtF);
    } else shake = 0;
    ctx.setTransform(dpr, 0, 0, dpr, shx * dpr, shy * dpr);

    ctx.fillStyle = '#0d1420';
    ctx.fillRect(-20, -20, vw + 40, vh + 40);

    drawTerrain(state);
    drawDecals(state, dtF);
    drawSprites(state, alpha);
    drawProjectiles(state, alpha);
    drawParticles(state, dtF);
    drawOverlays(state);
    drawFog(state, dtF);
    drawLighting(state);
    drawWeatherFx(state, dtF);
  }

  function visibleTileBounds(map) {
    const corners = [
      screenToWorld(-TW, -TH * 3), screenToWorld(vw + TW, -TH * 3),
      screenToWorld(-TW, vh + TH * 3), screenToWorld(vw + TW, vh + TH * 3)
    ];
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const c of corners) {
      x0 = Math.min(x0, c.x); x1 = Math.max(x1, c.x);
      y0 = Math.min(y0, c.y); y1 = Math.max(y1, c.y);
    }
    return {
      x0: Math.max(0, Math.floor(x0) - 1), x1: Math.min(map.w - 1, Math.ceil(x1) + 1),
      y0: Math.max(0, Math.floor(y0) - 2), y1: Math.min(map.h - 1, Math.ceil(y1) + 2)
    };
  }

  /* ---------------- terrain atlas ----------------
     The whole map is pre-rendered once into a single big canvas; each frame
     is then ONE cropped blit instead of thousands of per-tile drawImage
     calls. Road changes repaint just the affected tiles. */
  let atlas = null, atlasMap = null, atlasOX = 0, atlasOY = 0;

  function paintTileBase(actx, state, gx, gy) {
    const map = state.map;
    const i = gy * map.w + gx;
    const ax = (gx - gy) * TW2 + atlasOX - TW2 - 1;
    const ay = (gx + gy) * TH2 + atlasOY - 1;
    const t = map.terrain[i];
    const v = (gx * 7 + gy * 13) % 3;
    actx.drawImage(S.tile(t, v, 0), ax, ay);
    const r = map.road[i];
    if (r && r !== 3) {
      let mask = 0;
      if (gx + 1 < map.w && map.road[i + 1]) mask |= 1;
      if (gx - 1 >= 0 && map.road[i - 1]) mask |= 2;
      if (gy + 1 < map.h && map.road[i + map.w]) mask |= 4;
      if (gy - 1 >= 0 && map.road[i - map.w]) mask |= 8;
      actx.drawImage(S.road(mask, r), ax, ay);
    }
    if (map.deposit[i]) actx.drawImage(S.deposit((gx * 3 + gy) % 5), ax, ay);
  }

  function ensureAtlas(state) {
    if (atlas && atlasMap === state.map) return;
    const map = state.map;
    atlasMap = map;
    atlasOX = map.h * TW2 + 2;
    atlasOY = 2;
    atlas = document.createElement('canvas');
    atlas.width = (map.w + map.h) * TW2 + 4;
    atlas.height = (map.w + map.h) * TH2 + TH + 6;
    const actx = atlas.getContext('2d');
    actx.fillStyle = '#0d1420';
    actx.fillRect(0, 0, atlas.width, atlas.height);
    for (let gy = 0; gy < map.h; gy++) {
      for (let gx = 0; gx < map.w; gx++) paintTileBase(actx, state, gx, gy);
    }
  }

  function invalidateTiles(state, tiles) {
    if (!atlas || atlasMap !== state.map) return;
    const actx = atlas.getContext('2d');
    const done = {};
    for (const t of tiles) {
      /* neighbors too — their road connection masks changed */
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = t[0] + dx, y = t[1] + dy;
          if (x < 0 || y < 0 || x >= state.map.w || y >= state.map.h) continue;
          const k = y * state.map.w + x;
          if (done[k]) continue;
          done[k] = 1;
          paintTileBase(actx, state, x, y);
        }
      }
    }
  }

  function drawTerrain(state) {
    ensureAtlas(state);
    const z = camera.zoom;
    /* source rect in atlas space that maps onto the viewport */
    let sx = atlasOX + (camera.x - camera.y) * TW2 - vw / (2 * z);
    let sy = atlasOY + (camera.x + camera.y) * TH2 - vh / (2 * z);
    let sw = vw / z, sh = vh / z;
    let dx = 0, dy = 0, dwid = vw, dhei = vh;
    if (sx < 0) { dx = -sx * z; dwid += sx * z; sw += sx; sx = 0; }
    if (sy < 0) { dy = -sy * z; dhei += sy * z; sh += sy; sy = 0; }
    if (sx + sw > atlas.width) { const over = sx + sw - atlas.width; sw -= over; dwid -= over * z; }
    if (sy + sh > atlas.height) { const over = sy + sh - atlas.height; sh -= over; dhei -= over * z; }
    if (sw > 0 && sh > 0) ctx.drawImage(atlas, sx, sy, sw, sh, dx, dy, dwid, dhei);

    /* animated water: overlay the shimmering frames only when zoomed in
       enough to notice (the atlas holds frame 0) */
    if (z >= 0.65 && waterFrame !== 0) {
      const map = state.map;
      const b = visibleTileBounds(map);
      const dw = (TW + 2) * z, dh = (TH + 2) * z;
      for (let gy = b.y0; gy <= b.y1; gy++) {
        for (let gx = b.x0; gx <= b.x1; gx++) {
          const i = gy * map.w + gx;
          const t = map.terrain[i];
          if (t !== T.WATER && t !== T.RIVER) continue;
          if (!state.fog.explored[i]) continue;
          if (map.road[i]) continue; // bridges cover the water
          const p = worldToScreen(gx, gy);
          ctx.drawImage(S.tile(t, (gx * 7 + gy * 13) % 3, waterFrame),
            p.x - TW2 * z - z, p.y - z, dw, dh);
        }
      }
    }
  }

  function drawDecals(state, dtF) {
    const z = camera.zoom;
    for (let i = decals.length - 1; i >= 0; i--) {
      const d = decals[i];
      d.life += dtF;
      if (d.life >= d.ttl) { decals.splice(i, 1); continue; }
      const fade = Math.min(1, (d.ttl - d.life) / (d.ttl * 0.3));
      const p = worldToScreen(d.x, d.y);
      if (p.x < -80 || p.x > vw + 80 || p.y < -80 || p.y > vh + 80) continue;
      if (d.type === 'scorch') {
        const rx = d.size * TW2 * z, ry = d.size * TH2 * z;
        ctx.globalAlpha = fade;
        ctx.drawImage(fxSprite('scorch'), p.x - rx, p.y - ry, rx * 2, ry * 2);
        ctx.globalAlpha = 1;
      } else { // wreck: charred hull left behind
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.scale(1, 0.5);
        ctx.rotate(d.rot);
        ctx.globalAlpha = fade;
        ctx.fillStyle = '#26221c';
        ctx.beginPath(); ctx.roundRect(-11 * z, -6 * z, 22 * z, 12 * z, 3 * z); ctx.fill();
        ctx.fillStyle = '#3a332a';
        ctx.beginPath(); ctx.roundRect(-7 * z, -4 * z, 11 * z, 8 * z, 2 * z); ctx.fill();
        ctx.restore();
        ctx.globalAlpha = 1;
        /* smoldering */
        if (Math.random() < 0.05 && d.life < d.ttl * 0.4) {
          particles.push({
            type: 'smoke', x: d.x, y: d.y, z: 0.2, vx: 0.1, vy: -0.05, vz: 0.55,
            life: 0, ttl: 1.6, size: 2.4
          });
        }
      }
    }
  }

  function entVisible(state, e) {
    const fog = state.fog, map = state.map;
    const i = (e.y | 0) * map.w + (e.x | 0);
    if (e.kind === 'building') return fog.explored[i];
    if (e.owner === state.localPlayer) return true;
    return fog.visible[i];
  }

  function drawSprites(state, alpha) {
    const map = state.map;
    const b = visibleTileBounds(map);
    const z = camera.zoom;
    const items = [];

    /* decor */
    for (const d of map.decor) {
      if (d.gx < b.x0 || d.gx > b.x1 || d.gy < b.y0 || d.gy > b.y1) continue;
      if (!state.fog.explored[d.gy * map.w + d.gx]) continue;
      items.push({ depth: d.gx + d.gy + d.ox + d.oy + 1, kind: 'decor', d: d });
    }
    /* buildings */
    for (const bd of state.buildings) {
      if (bd.dead) continue;
      if (bd.x + bd.w < b.x0 - 3 || bd.x - bd.w > b.x1 + 3 || bd.y + bd.h < b.y0 - 3 || bd.y - bd.h > b.y1 + 6) continue;
      if (!entVisible(state, bd)) continue;
      items.push({ depth: bd.x + bd.y, kind: 'building', e: bd });
    }
    /* units */
    for (const u of state.units) {
      if (u.dead) continue;
      const ux = U.lerp(u.px, u.x, alpha), uy = U.lerp(u.py, u.y, alpha);
      if (ux < b.x0 - 2 || ux > b.x1 + 2 || uy < b.y0 - 2 || uy > b.y1 + 3) continue;
      if (!entVisible(state, u)) continue;
      items.push({ depth: ux + uy + (u.z > 0 ? 90 : 0), kind: 'unit', e: u, ux: ux, uy: uy });
    }
    items.sort(function (a, bb) { return a.depth - bb.depth; });

    for (const it of items) {
      if (it.kind === 'decor') drawDecor(it.d, z);
      else if (it.kind === 'building') drawBuilding(state, it.e, z);
      else drawUnit(state, it.e, it.ux, it.uy, z);
    }
  }

  function drawDecor(d, z) {
    const img = S.decor(d.type);
    const p = worldToScreen(d.gx + 0.5 + d.ox, d.gy + 0.5 + d.oy);
    const w = img.width * z * d.s, h = img.height * z * d.s;
    ctx.drawImage(img, p.x - w / 2, p.y + TH2 * z - h + 2 * z, w, h);
  }

  function drawBuilding(state, bd, z) {
    const bVar = (bd.gx * 7 + bd.gy * 13) % 3; /* per-position look variant */
    const spr = bd.complete || bd.progress > 0.6
      ? S.building(bd.type, bd.owner, bVar)
      : S.scaffold(bd.w, bd.h);
    const p = worldToScreen(bd.gx, bd.gy);
    const isSel = overlay.selection.indexOf(bd) >= 0;

    if (isSel) drawFootprintRing(bd, z, '110,230,140');

    if (!bd.complete) {
      /* construction: rise from the ground with a clip */
      const full = S.building(bd.type, bd.owner, bVar);
      const ph = full.c.height * z;
      const top = p.y - full.ay * z;
      ctx.save();
      ctx.beginPath();
      const cut = ph * (1 - Math.min(1, bd.progress * 1.15));
      ctx.rect(p.x - full.ax * z - 4, top + cut, full.c.width * z + 8, ph - cut + 4);
      ctx.clip();
      ctx.globalAlpha = 0.92;
      ctx.drawImage(full.c, p.x - full.ax * z, top, full.c.width * z, ph);
      ctx.restore();
      ctx.globalAlpha = 1;
      /* scaffold frame on top */
      const sc = S.scaffold(bd.w, bd.h);
      ctx.globalAlpha = 0.85;
      ctx.drawImage(sc.c, p.x - sc.ax * z, p.y - sc.ay * z, sc.c.width * z, sc.c.height * z);
      ctx.globalAlpha = 1;
      drawBar(bd, bd.progress, '#57c268', z, 0);
    } else {
      ctx.drawImage(spr.c, p.x - spr.ax * z, p.y - spr.ay * z, spr.c.width * z, spr.c.height * z);
      /* ambient industry: working smokestacks puff away */
      const stacks = CHIMNEYS[bd.type];
      if (stacks && Math.random() < 0.05) {
        const sk = stacks[(Math.random() * stacks.length) | 0];
        particles.push({
          type: 'smoke', x: bd.gx + sk[0], y: bd.gy + sk[1], z: sk[2],
          vx: 0.25, vy: -0.12, vz: 0.55, life: 0, ttl: 1.6 + Math.random(), size: 2.2
        });
      }
      if (bd.hp < bd.maxHp) {
        drawBar(bd, bd.hp / bd.maxHp, hpColor(bd.hp / bd.maxHp), z, 0);
        if (bd.hp < bd.maxHp * 0.5) {
          /* damage smoke */
          if (Math.random() < 0.12) {
            particles.push({
              type: 'smoke', x: bd.x + (Math.random() - 0.5) * bd.w * 0.7,
              y: bd.y + (Math.random() - 0.5) * bd.h * 0.7, z: 0.8,
              vx: 0.1, vy: -0.1, vz: 0.8, life: 0, ttl: 1.4, size: 3.5
            });
          }
          /* open flames once critically damaged */
          if (bd.hp < bd.maxHp * 0.32 && Math.random() < 0.14) {
            particles.push({
              type: 'fire', x: bd.x + (Math.random() - 0.5) * bd.w * 0.6,
              y: bd.y + (Math.random() - 0.5) * bd.h * 0.6, z: 0.5,
              vx: 0, vy: 0, vz: 0.5, life: 0, ttl: 0.5 + Math.random() * 0.4, size: 2.6
            });
          }
        }
      }
      if (isSel && bd.rally) {
        const rp = worldToScreen(bd.rally.x, bd.rally.y);
        ctx.strokeStyle = 'rgba(255,215,94,0.8)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        const cp = worldToScreen(bd.x, bd.y);
        ctx.moveTo(cp.x, cp.y);
        ctx.lineTo(rp.x, rp.y + TH2 * z);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,215,94,0.9)';
        ctx.beginPath();
        ctx.moveTo(rp.x, rp.y - 10 * z + TH2 * z);
        ctx.lineTo(rp.x + 7 * z, rp.y - 6 * z + TH2 * z);
        ctx.lineTo(rp.x, rp.y - 2 * z + TH2 * z);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  /* smokestack tips per building type: [gx offset, gy offset, z height] */
  const CHIMNEYS = {
    power: [[1.68, 0.5, 1.5], [1.68, 1.28, 1.5]],
    factory: [[2.75, 0.35, 1.7]]
  };

  function drawFootprintRing(bd, z, rgb) {
    const p0 = worldToScreen(bd.gx, bd.gy);
    const p1 = worldToScreen(bd.gx + bd.w, bd.gy);
    const p2 = worldToScreen(bd.gx + bd.w, bd.gy + bd.h);
    const p3 = worldToScreen(bd.gx, bd.gy + bd.h);
    ctx.strokeStyle = 'rgba(' + rgb + ',0.9)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y);
    ctx.closePath();
    ctx.stroke();
  }

  function hpColor(f) {
    return f > 0.6 ? '#57c268' : f > 0.3 ? '#e0b23f' : '#e05038';
  }

  function drawBar(e, frac, color, z, dy) {
    const isB = e.kind === 'building';
    const w = (isB ? (e.w + e.h) * 10 : 22) * z;
    const p = isB
      ? worldToScreen(e.x, e.y)
      : worldToScreen(e.x, e.y);
    const y = p.y - (isB ? (30 + (e.w + e.h) * 8) : (e.z > 0 ? 46 : 26)) * z + dy;
    ctx.fillStyle = 'rgba(8,10,16,0.75)';
    ctx.fillRect(p.x - w / 2 - 1, y - 1, w + 2, 4 * z + 2);
    ctx.fillStyle = color;
    ctx.fillRect(p.x - w / 2, y, w * U.clamp(frac, 0, 1), 4 * z);
  }

  function drawUnit(state, u, ux, uy, z) {
    const def = C.UNITS[u.type];
    const p = worldToScreen(ux, uy);
    const isSel = overlay.selection.indexOf(u) >= 0;
    const moving = !!u.path;
    /* facing octant: convert world dir to screen angle */
    const sdx = Math.cos(u.dir), sdy = Math.sin(u.dir);
    const ang = Math.atan2(sdy, sdx);
    let dir8 = Math.round(ang / (Math.PI / 4));
    dir8 = ((dir8 % 8) + 8) % 8;
    const frame = moving || def.air ? (Math.floor(u.animT * 4) % 2) : 0;

    const hover = def.air ? Math.sin(state.time * 2.2 + u.id) * 3 : 0;
    const lift = def.air ? 38 : 0;

    if (isSel) {
      ctx.strokeStyle = u.owner === state.localPlayer ? 'rgba(110,230,140,0.9)' : 'rgba(230,110,90,0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + 3 * z, 13 * z * (def.radius + 0.75), 6.5 * z * (def.radius + 0.75), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (def.air) {
      /* drop shadow on the ground */
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + 3 * z, 9 * z, 4 * z, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    const img = S.unit(u.type, u.owner, dir8, frame);
    const sw = img.width * z, sh = img.height * z;
    ctx.drawImage(img, p.x - sw / 2, p.y - sh / 2 - (lift + hover) * z * 0.55 - 8 * z, sw, sh);

    if (u.hp < u.maxHp || isSel) {
      drawBar(u, u.hp / u.maxHp, hpColor(u.hp / u.maxHp), z, def.air ? -(lift + hover) * z * 0.55 : 0);
    }
    /* stance pip */
    if (isSel && u.owner === state.localPlayer) {
      const cols = { guard: '#7fb2e8', assault: '#e08050', hold: '#c8c8c8', patrol: '#b08fe0' };
      ctx.fillStyle = cols[u.stance] || '#fff';
      ctx.fillRect(p.x + 12 * z, p.y - 24 * z, 4 * z, 4 * z);
    }
    /* capture / build channel */
    if (u.channel > 0) {
      drawBar(u, u.channel / C.ECON.captureTime, '#ffd75e', z, -6 * z);
    }
  }

  function drawProjectiles(state, alpha) {
    const z = camera.zoom;
    for (const pr of state.projectiles) {
      const p = worldToScreen(pr.x, pr.y);
      const py = p.y - pr.z * TH * z;
      if (pr.type === 'bullet') {
        const back = worldToScreen(pr.x - (pr.tx - pr.sx) * 0.04, pr.y - (pr.ty - pr.sy) * 0.04);
        ctx.strokeStyle = 'rgba(255,230,150,0.9)';
        ctx.lineWidth = 1.5 * z;
        ctx.beginPath();
        ctx.moveTo(back.x, back.y - pr.z * TH * z);
        ctx.lineTo(p.x, py);
        ctx.stroke();
      } else if (pr.type === 'rocket') {
        ctx.fillStyle = '#f2e2c0';
        ctx.fillRect(p.x - 2 * z, py - 2 * z, 4 * z, 4 * z);
        particles.push({ type: 'smoke', x: pr.x, y: pr.y, z: pr.z, vx: 0, vy: 0, vz: 0.15, life: 0, ttl: 0.35, size: 1.8 });
      } else { // shell / arc / bomb
        ctx.fillStyle = '#2b2f36';
        ctx.beginPath();
        ctx.arc(p.x, py, (pr.type === 'bomb' ? 3.4 : pr.type === 'arc' ? 3 : 2.2) * z, 0, Math.PI * 2);
        ctx.fill();
        if (pr.type === 'bomb') { // tail fins
          ctx.strokeStyle = '#4a4f57'; ctx.lineWidth = 1.6 * z;
          ctx.beginPath(); ctx.moveTo(p.x, py - 3 * z); ctx.lineTo(p.x, py - 6.5 * z); ctx.stroke();
        }
        if (pr.type === 'arc' || pr.type === 'bomb') {
          ctx.fillStyle = 'rgba(0,0,0,0.25)';
          ctx.beginPath();
          ctx.ellipse(p.x, p.y + 2, 3 * z, 1.5 * z, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  function drawParticles(state, dtF) {
    const z = camera.zoom;
    for (let i = particles.length - 1; i >= 0; i--) {
      const pt = particles[i];
      if (pt.delay && pt.delay > 0) { pt.delay -= dtF; continue; }
      pt.life += dtF;
      if (pt.life >= pt.ttl) { particles.splice(i, 1); continue; }
      const f = pt.life / pt.ttl;
      pt.x += (pt.vx || 0) * dtF;
      pt.y += (pt.vy || 0) * dtF;
      pt.z += (pt.vz || 0) * dtF;
      if (pt.vz !== undefined && (pt.type === 'debris' || pt.type === 'dirt')) pt.vz -= 9 * dtF;
      const p = worldToScreen(pt.x, pt.y);
      const py = p.y - pt.z * TH * z;
      switch (pt.type) {
        case 'boom': {
          const r = (6 + f * 26 * pt.size) * z;
          ctx.globalAlpha = 1 - f;
          ctx.drawImage(fxSprite('boom'), p.x - r, py - r, r * 2, r * 2);
          ctx.globalAlpha = 1;
          break;
        }
        case 'flash': {
          ctx.fillStyle = 'rgba(255,240,180,' + (1 - f) + ')';
          ctx.beginPath(); ctx.arc(p.x, py, pt.size * z * (1 - f * 0.5), 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 'muzzleflash': {
          /* elongated cone toward the firing direction */
          const mdx = Math.cos(pt.dir), mdy = Math.sin(pt.dir) * 0.5;
          const L = pt.size * z * (1 - f * 0.4);
          ctx.fillStyle = 'rgba(255,236,170,' + (0.95 * (1 - f)) + ')';
          ctx.beginPath();
          ctx.moveTo(p.x + mdy * 3 * z, py - mdx * 3 * z * 0.5);
          ctx.lineTo(p.x + mdx * L, py + mdy * L);
          ctx.lineTo(p.x - mdy * 3 * z, py + mdx * 3 * z * 0.5);
          ctx.closePath(); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,230,' + (1 - f) + ')';
          ctx.beginPath(); ctx.arc(p.x, py, 2.6 * z * (1 - f), 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 'shock': {
          /* fast expanding blast wave hugging the ground */
          ctx.strokeStyle = 'rgba(255,235,200,' + (0.75 * (1 - f)) + ')';
          ctx.lineWidth = 3.2 * z * (1 - f * 0.6);
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, f * TW * pt.size * z, f * TH * pt.size * z, 0, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'fire': {
          const fr = pt.size * z * (1 - f * 0.55) * 2.2;
          ctx.globalAlpha = 1 - f;
          ctx.drawImage(fxSprite('fire'), p.x - fr, py - fr, fr * 2, fr * 2);
          ctx.globalAlpha = 1;
          break;
        }
        case 'dirt': {
          ctx.fillStyle = 'rgba(112,90,58,' + (0.8 * (1 - f)) + ')';
          ctx.beginPath(); ctx.arc(p.x, py, pt.size * z * (0.7 + f * 0.5), 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 'smoke': {
          ctx.fillStyle = 'rgba(90,92,98,' + (0.4 * (1 - f)) + ')';
          ctx.beginPath(); ctx.arc(p.x, py, (pt.size + f * 6) * z, 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 'spark':
        case 'debris': {
          ctx.fillStyle = pt.type === 'spark'
            ? 'rgba(255,210,120,' + (1 - f) + ')'
            : 'rgba(70,66,60,' + (1 - f) + ')';
          ctx.fillRect(p.x - pt.size * z / 2, py - pt.size * z / 2, pt.size * z, pt.size * z);
          break;
        }
        case 'ring': {
          ctx.strokeStyle = 'rgba(' + (pt.col || '255,255,255') + ',' + (1 - f) + ')';
          ctx.lineWidth = 2 * z;
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, f * TW * pt.size * z, f * TH * pt.size * z, 0, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'marker': {
          /* order pulse: ring collapsing onto a center dot */
          const mr = (1 - f) * 16 * z + 3;
          ctx.strokeStyle = 'rgba(' + pt.col + ',' + (0.9 - f * 0.5) + ')';
          ctx.lineWidth = 1.8 * z;
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, mr, mr * 0.5, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = 'rgba(' + pt.col + ',' + (1 - f) + ')';
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, 2.4 * z, 1.4 * z, 0, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
      }
    }
  }

  /* ---------------- placement ghost + road preview ---------------- */
  function drawOverlays(state) {
    const z = camera.zoom;
    if (overlay.ghost) {
      const g = overlay.ghost;
      const def = C.BUILDINGS[g.type];
      /* tint footprint tiles */
      for (let y = g.gy; y < g.gy + def.h; y++) {
        for (let x = g.gx; x < g.gx + def.w; x++) {
          const p = worldToScreen(x, y);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + TW2 * z, p.y + TH2 * z);
          ctx.lineTo(p.x, p.y + TH * z);
          ctx.lineTo(p.x - TW2 * z, p.y + TH2 * z);
          ctx.closePath();
          ctx.fillStyle = g.ok ? 'rgba(90,220,120,0.35)' : 'rgba(230,80,60,0.4)';
          ctx.fill();
        }
      }
      const spr = S.building(g.type, state.localPlayer);
      const p = worldToScreen(g.gx, g.gy);
      ctx.globalAlpha = 0.55;
      ctx.drawImage(spr.c, p.x - spr.ax * z, p.y - spr.ay * z, spr.c.width * z, spr.c.height * z);
      ctx.globalAlpha = 1;
      /* build radius hint */
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.setLineDash([4, 6]);
      for (const b of state.buildings) {
        if (b.dead || b.owner !== state.localPlayer) continue;
        const bp = worldToScreen(b.x, b.y);
        ctx.beginPath();
        ctx.ellipse(bp.x, bp.y, C.ECON.buildRadius * TW2 * z, C.ECON.buildRadius * TH2 * z, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    if (overlay.roadPath) {
      for (const t of overlay.roadPath) {
        const p = worldToScreen(t.x, t.y);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + TW2 * z, p.y + TH2 * z);
        ctx.lineTo(p.x, p.y + TH * z);
        ctx.lineTo(p.x - TW2 * z, p.y + TH2 * z);
        ctx.closePath();
        ctx.fillStyle = t.cost < 0 ? 'rgba(230,80,60,0.4)'
          : t.cost > C.ECON.roadCostPerTile ? 'rgba(160,120,70,0.5)' : 'rgba(220,210,160,0.4)';
        ctx.fill();
      }
    }
  }

  /* ---------------- fog ---------------- */
  function drawFog(state, dtF) {
    fogUpdateT -= dtF;
    if (!fogCanvas || fogUpdateT <= 0) {
      fogUpdateT = 0.22;
      updateFogCanvas(state);
    }
    const z = camera.zoom;
    const o = worldToScreen(0, 0);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    /* linear iso mapping: tile (x,y) -> screen */
    ctx.setTransform(
      TW2 * z * dpr, TH2 * z * dpr,
      -TW2 * z * dpr, TH2 * z * dpr,
      o.x * dpr, o.y * dpr
    );
    ctx.drawImage(fogCanvas, 0, 0);
    ctx.restore();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ---------------- lighting: day/night cycle ---------------- */
  function drawLighting(state) {
    const t = state.dayT; // 0..1, 0 = dawn
    /* ambient darkness: min at midday (t=0.25), max at midnight (t=0.75) */
    const daylight = Math.max(0, Math.sin(t * Math.PI * 2)); // day half
    const nightness = Math.max(0, Math.sin((t - 0.5) * Math.PI * 2));
    const duskGlow = Math.max(0, 1 - Math.abs(t - 0.5) * 14) + Math.max(0, 1 - Math.abs(t - 0.995) * 14);

    if (nightness > 0.01) {
      ctx.fillStyle = 'rgba(10,16,40,' + (nightness * 0.52) + ')';
      ctx.fillRect(0, 0, vw, vh);
    }
    if (duskGlow > 0.01) {
      ctx.fillStyle = 'rgba(255,120,40,' + (duskGlow * 0.13) + ')';
      ctx.fillRect(0, 0, vw, vh);
    }
    /* window lights & headlights at night (cached glow sprite, culled) */
    if (nightness > 0.25) {
      const z = camera.zoom;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (nightness - 0.25) * 0.5;
      const glow = getGlowSprite();
      for (const b of RTS.game.state.buildings) {
        if (b.dead || !b.complete || !entVisible(state, b)) continue;
        const p = worldToScreen(b.x, b.y);
        const r = (b.w + b.h) * 14 * z;
        if (p.x < -r || p.x > vw + r || p.y < -r || p.y > vh + r) continue;
        ctx.drawImage(glow, p.x - r, p.y - 8 * z - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }

  /* pre-rendered radial-gradient sprites — building gradients per particle
     per frame was a major frame killer in big battles */
  const fxSprites = {};
  function fxSprite(name) {
    if (fxSprites[name]) return fxSprites[name];
    const c = document.createElement('canvas');
    c.width = c.height = 96;
    const g = c.getContext('2d');
    let grad;
    if (name === 'boom') {
      grad = g.createRadialGradient(48, 48, 0, 48, 48, 48);
      grad.addColorStop(0, 'rgba(255,245,200,1)');
      grad.addColorStop(0.4, 'rgba(255,160,60,0.9)');
      grad.addColorStop(1, 'rgba(120,40,10,0)');
    } else if (name === 'fire') {
      grad = g.createRadialGradient(48, 48, 0, 48, 48, 48);
      grad.addColorStop(0, 'rgba(255,230,140,0.95)');
      grad.addColorStop(0.5, 'rgba(255,120,40,0.6)');
      grad.addColorStop(1, 'rgba(180,40,10,0)');
    } else { // 'scorch'
      grad = g.createRadialGradient(48, 48, 0, 48, 48, 48);
      grad.addColorStop(0, 'rgba(18,14,10,0.55)');
      grad.addColorStop(0.7, 'rgba(24,20,14,0.32)');
      grad.addColorStop(1, 'rgba(24,20,14,0)');
    }
    g.fillStyle = grad;
    g.fillRect(0, 0, 96, 96);
    return (fxSprites[name] = c);
  }

  let glowSprite = null;
  function getGlowSprite() {
    if (glowSprite) return glowSprite;
    glowSprite = document.createElement('canvas');
    glowSprite.width = glowSprite.height = 128;
    const g = glowSprite.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,214,140,1)');
    grad.addColorStop(1, 'rgba(255,214,140,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return glowSprite;
  }

  /* ---------------- weather ---------------- */
  function drawWeatherFx(state, dtF) {
    fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fxCtx.clearRect(0, 0, vw, vh);
    const wt = state.weather.type;

    if (wt === 'rain') {
      /* maintain drop pool */
      while (rainDrops.length < 130) {
        rainDrops.push({ x: Math.random() * vw, y: Math.random() * vh, s: 0.6 + Math.random() * 0.8 });
      }
      fxCtx.strokeStyle = 'rgba(170,200,235,0.4)';
      fxCtx.lineWidth = 1;
      fxCtx.beginPath();
      for (const d of rainDrops) {
        d.x -= 340 * d.s * dtF * 0.35;
        d.y += 620 * d.s * dtF;
        if (d.y > vh) { d.y = -12; d.x = Math.random() * (vw + 120); }
        fxCtx.moveTo(d.x, d.y);
        fxCtx.lineTo(d.x - 3.5, d.y + 11 * d.s);
      }
      fxCtx.stroke();
      fxCtx.fillStyle = 'rgba(30,45,70,0.10)';
      fxCtx.fillRect(0, 0, vw, vh);
    } else if (rainDrops.length) {
      rainDrops.length = 0;
    }

    if (wt === 'fog') {
      const t = performance.now() / 1000;
      for (let k = 0; k < 3; k++) {
        const cx = (Math.sin(t * 0.06 + k * 2.4) * 0.5 + 0.5) * vw;
        const cy = (Math.cos(t * 0.045 + k * 1.7) * 0.5 + 0.5) * vh;
        const g = fxCtx.createRadialGradient(cx, cy, 60, cx, cy, vw * 0.55);
        g.addColorStop(0, 'rgba(200,208,218,0.16)');
        g.addColorStop(1, 'rgba(200,208,218,0)');
        fxCtx.fillStyle = g;
        fxCtx.fillRect(0, 0, vw, vh);
      }
      fxCtx.fillStyle = 'rgba(190,198,210,0.10)';
      fxCtx.fillRect(0, 0, vw, vh);
    }
  }

  function reset() {
    particles = [];
    decals = [];
    shake = 0;
  }

  return {
    init: init,
    render: render,
    reset: reset,
    onEvent: onEvent,
    orderMarker: orderMarker,
    camera: camera,
    overlay: overlay,
    worldToScreen: worldToScreen,
    screenToWorld: screenToWorld,
    centerOn: centerOn,
    get viewSize() { return { w: vw, h: vh }; }
  };
})();
