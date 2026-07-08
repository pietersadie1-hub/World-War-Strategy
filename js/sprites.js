/* ============ sprites.js — procedural sprite atlas ============
   Every visual asset (tiles, roads, trees, buildings, units) is drawn
   once into offscreen canvases at startup. No external files needed. */
window.RTS = window.RTS || {};

RTS.sprites = (function () {
  'use strict';
  const C = RTS.config, U = RTS.util, T = C.T;
  const TW = C.TILE_W, TH = C.TILE_H, TW2 = TW / 2, TH2 = TH / 2;

  const cache = {};
  let art; // decorative rng (visual only — never touches the simulation)

  function cv(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.ceil(w); c.height = Math.ceil(h);
    return c;
  }

  function shade(hex, amt) {
    /* returns hex so results can be shaded again (isoBox nests calls) */
    const n = parseInt(hex.slice(1), 16);
    const r = U.clamp((n >> 16) + amt, 0, 255);
    const g = U.clamp(((n >> 8) & 0xff) + amt, 0, 255);
    const b = U.clamp((n & 0xff) + amt, 0, 255);
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  }

  function diamond(ctx, cx, cy, w2, h2) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - h2);
    ctx.lineTo(cx + w2, cy);
    ctx.lineTo(cx, cy + h2);
    ctx.lineTo(cx - w2, cy);
    ctx.closePath();
  }

  /* ---------------- terrain tiles ---------------- */
  const TILE_BASE = {};
  TILE_BASE[T.WATER] = ['#1c4c72', '#1a4569'];
  TILE_BASE[T.RIVER] = ['#276b9d', '#2b71a4'];
  TILE_BASE[T.SAND] = ['#cfbc85', '#c6b37c', '#d6c48e'];
  TILE_BASE[T.GRASS] = ['#5c8f45', '#568841', '#639a4c'];
  TILE_BASE[T.FOREST] = ['#4b7c39', '#457436'];
  TILE_BASE[T.HILL] = ['#7e8a62', '#75815b'];
  TILE_BASE[T.MOUNTAIN] = ['#787d86', '#70757e'];

  function buildTile(type, variant, frame) {
    const c = cv(TW + 2, TH + 2), ctx = c.getContext('2d');
    const base = TILE_BASE[type][variant % TILE_BASE[type].length];
    diamond(ctx, TW2 + 1, TH2 + 1, TW2 + 1, TH2 + 1);
    const grad = ctx.createLinearGradient(0, 0, 0, TH);
    grad.addColorStop(0, shade(base, 8));
    grad.addColorStop(1, shade(base, -6));
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.save();
    diamond(ctx, TW2 + 1, TH2 + 1, TW2 + 1, TH2 + 1);
    ctx.clip();
    const water = (type === T.WATER || type === T.RIVER);
    if (water) {
      /* animated highlights: 3 frames with shifted ripples */
      ctx.strokeStyle = 'rgba(255,255,255,0.20)';
      ctx.lineWidth = 1.2;
      for (let k = 0; k < 5; k++) {
        const yy = ((k * 7 + frame * 4 + variant * 3) % TH) + 1;
        const xx = (art.next() * TW * 0.5) + TW * 0.15;
        ctx.beginPath();
        ctx.moveTo(xx, yy);
        ctx.quadraticCurveTo(xx + 8, yy - 2, xx + 16, yy);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(180,220,255,0.06)';
      ctx.fillRect(0, frame * 9 % TH, TW, 4);
    } else {
      /* speckle texture */
      for (let k = 0; k < 26; k++) {
        const x = art.next() * TW, y = art.next() * TH;
        ctx.fillStyle = art.next() < 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.06)';
        ctx.fillRect(x, y, 1.6, 1.2);
      }
      if (type === T.GRASS || type === T.FOREST) {
        ctx.strokeStyle = 'rgba(20,60,15,0.25)';
        for (let k = 0; k < 7; k++) {
          const x = 6 + art.next() * (TW - 12), y = 4 + art.next() * (TH - 8);
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 1, y - 3); ctx.stroke();
        }
      }
    }
    ctx.restore();
    /* soft edge */
    diamond(ctx, TW2 + 1, TH2 + 1, TW2 + 1, TH2 + 1);
    ctx.strokeStyle = 'rgba(0,0,0,0.10)';
    ctx.lineWidth = 1;
    ctx.stroke();
    return c;
  }

  function tile(type, variant, frame) {
    const key = 't' + type + '_' + variant + '_' + (frame || 0);
    return cache[key] || (cache[key] = buildTile(type, variant, frame || 0));
  }

  /* ---------------- road / bridge overlays (16 connection masks) ----------------
     mask bits: 1=+x neighbor, 2=-x, 4=+y, 8=-y  (grid axes) */
  const ISO_DIR = [
    { x: TW2 / 2, y: TH2 / 2 },    // +x
    { x: -TW2 / 2, y: -TH2 / 2 },  // -x
    { x: -TW2 / 2, y: TH2 / 2 },   // +y
    { x: TW2 / 2, y: -TH2 / 2 }    // -y
  ];

  function buildRoad(mask, kind) {
    const c = cv(TW + 2, TH + 2), ctx = c.getContext('2d');
    const cx = TW2 + 1, cy = TH2 + 1;
    const isBridge = kind === 2, isDam = kind === 3;
    const col = isBridge ? '#8a6f4d' : isDam ? '#9aa2ab' : '#4c4f55';
    const edge = isBridge ? '#5d4832' : isDam ? '#6d747d' : '#35373c';
    ctx.save();
    diamond(ctx, cx, cy, TW2 + 1, TH2 + 1);
    ctx.clip();
    if (isBridge) { // water showing under the bridge edges
      ctx.fillStyle = '#276b9d';
      ctx.fillRect(0, 0, TW + 2, TH + 2);
    }
    ctx.lineCap = 'round';
    /* wide base strips toward each connected neighbor */
    ctx.strokeStyle = edge;
    ctx.lineWidth = TH * 0.62;
    strokeMask(ctx, cx, cy, mask);
    ctx.strokeStyle = col;
    ctx.lineWidth = TH * 0.5;
    strokeMask(ctx, cx, cy, mask);
    if (isBridge) {
      /* planks */
      ctx.strokeStyle = 'rgba(0,0,0,0.22)';
      ctx.lineWidth = 1;
      for (let k = 0; k < 6; k++) {
        ctx.beginPath();
        ctx.moveTo(cx - TW2 + k * 11, cy - 6);
        ctx.lineTo(cx - TW2 + k * 11 + 6, cy + 6);
        ctx.stroke();
      }
      ctx.strokeStyle = '#3f3122';
      ctx.lineWidth = 2;
      strokeMaskOffset(ctx, cx, cy, mask, -TH * 0.26);
      strokeMaskOffset(ctx, cx, cy, mask, TH * 0.26);
    } else if (!isDam) {
      /* dashed center line */
      ctx.strokeStyle = 'rgba(235,225,160,0.65)';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([4, 5]);
      strokeMask(ctx, cx, cy, mask);
      ctx.setLineDash([]);
    }
    ctx.restore();
    return c;
  }

  function strokeMask(ctx, cx, cy, mask) {
    let any = false;
    for (let d = 0; d < 4; d++) {
      if (!(mask & (1 << d))) continue;
      any = true;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + ISO_DIR[d].x * 2.2, cy + ISO_DIR[d].y * 2.2);
      ctx.stroke();
    }
    if (!any) { // isolated stub
      ctx.beginPath();
      ctx.arc(cx, cy, TH * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fill();
    }
  }
  function strokeMaskOffset(ctx, cx, cy, mask, off) {
    for (let d = 0; d < 4; d++) {
      if (!(mask & (1 << d))) continue;
      /* perpendicular offset in screen space */
      const dx = ISO_DIR[d].x, dy = ISO_DIR[d].y;
      const len = Math.hypot(dx, dy), px = -dy / len * off, py = dx / len * off;
      ctx.beginPath();
      ctx.moveTo(cx + px, cy + py);
      ctx.lineTo(cx + dx * 2.2 + px, cy + dy * 2.2 + py);
      ctx.stroke();
    }
  }

  function road(mask, kind) {
    const key = 'r' + kind + '_' + mask;
    return cache[key] || (cache[key] = buildRoad(mask, kind));
  }

  /* ---------------- mineral deposit overlay ---------------- */
  function deposit(variant) {
    const key = 'dep' + variant;
    if (cache[key]) return cache[key];
    const c = cv(TW + 2, TH + 2), ctx = c.getContext('2d');
    const n = 3 + (variant % 3);
    for (let k = 0; k < n; k++) {
      const x = TW2 + 1 + (art.next() - 0.5) * TW * 0.5;
      const y = TH2 + 1 + (art.next() - 0.5) * TH * 0.5;
      const s = 3.5 + art.next() * 4;
      ctx.beginPath();
      ctx.moveTo(x, y - s * 1.4);
      ctx.lineTo(x + s * 0.8, y);
      ctx.lineTo(x, y + s * 0.5);
      ctx.lineTo(x - s * 0.8, y);
      ctx.closePath();
      const g = ctx.createLinearGradient(x - s, y - s, x + s, y + s);
      g.addColorStop(0, '#e8f2ff');
      g.addColorStop(0.5, '#9fc0e8');
      g.addColorStop(1, '#5877a8');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = 'rgba(30,45,80,0.6)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
    return (cache[key] = c);
  }

  /* ---------------- decor (trees, rocks, mountain peaks) ----------------
     Anchored at the bottom-center of the sprite. */
  function decor(type, seedVar) {
    const key = 'dc' + type + (seedVar || 0);
    if (cache[key]) return cache[key];
    let c, ctx;
    if (type === 'tree') {
      c = cv(40, 52); ctx = c.getContext('2d');
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath(); ctx.ellipse(20, 48, 12, 4.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#6b4a2b';
      ctx.fillRect(18, 32, 4, 16);
      for (let k = 0; k < 3; k++) {
        const yy = 26 - k * 8, rr = 13 - k * 3;
        const g = ctx.createRadialGradient(17, yy - 3, 2, 20, yy, rr + 3);
        g.addColorStop(0, '#7dae52');
        g.addColorStop(1, '#3e6b2e');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(20, yy, rr, 0, Math.PI * 2); ctx.fill();
      }
    } else if (type === 'pine') {
      c = cv(36, 56); ctx = c.getContext('2d');
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath(); ctx.ellipse(18, 52, 10, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#5d4127';
      ctx.fillRect(16, 40, 4, 12);
      for (let k = 0; k < 3; k++) {
        const yy = 42 - k * 11, ww = 15 - k * 3.5;
        ctx.beginPath();
        ctx.moveTo(18, yy - 16);
        ctx.lineTo(18 + ww, yy);
        ctx.lineTo(18 - ww, yy);
        ctx.closePath();
        ctx.fillStyle = k % 2 ? '#2f5c33' : '#3a6e3d';
        ctx.fill();
      }
    } else if (type === 'bush') {
      c = cv(28, 22); ctx = c.getContext('2d');
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.beginPath(); ctx.ellipse(14, 19, 9, 3, 0, 0, Math.PI * 2); ctx.fill();
      for (let k = 0; k < 4; k++) {
        ctx.fillStyle = k % 2 ? '#4f7f39' : '#5d924a';
        ctx.beginPath();
        ctx.arc(8 + k * 4, 13 - (k % 2) * 3, 6, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (type === 'rock') {
      c = cv(30, 24); ctx = c.getContext('2d');
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.beginPath(); ctx.ellipse(15, 21, 10, 3.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(4, 19); ctx.lineTo(9, 8); ctx.lineTo(17, 5); ctx.lineTo(25, 12); ctx.lineTo(24, 19);
      ctx.closePath();
      const g = ctx.createLinearGradient(4, 5, 24, 20);
      g.addColorStop(0, '#a7abb3'); g.addColorStop(1, '#666b74');
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = 'rgba(30,32,38,0.5)'; ctx.stroke();
    } else { // 'peak' — mountain
      c = cv(76, 74); ctx = c.getContext('2d');
      ctx.beginPath();
      ctx.moveTo(38, 4);
      ctx.lineTo(66, 58); ctx.lineTo(54, 62); ctx.lineTo(38, 56);
      ctx.lineTo(22, 63); ctx.lineTo(10, 57);
      ctx.closePath();
      const g = ctx.createLinearGradient(10, 4, 66, 63);
      g.addColorStop(0, '#9aa0ab'); g.addColorStop(0.55, '#767d89'); g.addColorStop(1, '#575d68');
      ctx.fillStyle = g; ctx.fill();
      /* shaded face */
      ctx.beginPath();
      ctx.moveTo(38, 4); ctx.lineTo(38, 56); ctx.lineTo(22, 63); ctx.lineTo(10, 57);
      ctx.closePath();
      ctx.fillStyle = 'rgba(20,24,34,0.28)'; ctx.fill();
      /* snow cap */
      ctx.beginPath();
      ctx.moveTo(38, 4); ctx.lineTo(48, 23); ctx.lineTo(42, 21); ctx.lineTo(38, 26); ctx.lineTo(33, 20); ctx.lineTo(29, 22);
      ctx.closePath();
      ctx.fillStyle = '#eef3f8'; ctx.fill();
    }
    return (cache[key] = c);
  }

  /* ---------------- buildings ---------------- */
  function isoPt(gx, gy) { return { x: (gx - gy) * TW2, y: (gx + gy) * TH2 }; }

  /* extruded iso prism with top face + two visible walls; z0 lifts the base
     so boxes can sit on rooftops */
  function isoBox(ctx, ox, oy, gx, gy, gw, gh, ht, col, z0) {
    z0 = z0 || 0;
    const A = isoPt(gx, gy), B = isoPt(gx + gw, gy), Cp = isoPt(gx + gw, gy + gh), D = isoPt(gx, gy + gh);
    function P(p, up) { return { x: ox + p.x, y: oy + p.y - (up ? ht + z0 : z0) }; }
    const A1 = P(A, 1), B1 = P(B, 1), C1 = P(Cp, 1), D1 = P(D, 1);
    const B0 = P(B, 0), C0 = P(Cp, 0), D0 = P(D, 0);
    /* left wall (facing screen lower-left) */
    ctx.beginPath();
    ctx.moveTo(D1.x, D1.y); ctx.lineTo(C1.x, C1.y); ctx.lineTo(C0.x, C0.y); ctx.lineTo(D0.x, D0.y);
    ctx.closePath();
    ctx.fillStyle = shade(col, -38); ctx.fill();
    /* right wall */
    ctx.beginPath();
    ctx.moveTo(C1.x, C1.y); ctx.lineTo(B1.x, B1.y); ctx.lineTo(B0.x, B0.y); ctx.lineTo(C0.x, C0.y);
    ctx.closePath();
    ctx.fillStyle = shade(col, -18); ctx.fill();
    /* top */
    ctx.beginPath();
    ctx.moveTo(A1.x, A1.y); ctx.lineTo(B1.x, B1.y); ctx.lineTo(C1.x, C1.y); ctx.lineTo(D1.x, D1.y);
    ctx.closePath();
    ctx.fillStyle = shade(col, 12); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();
    /* sun-lit top edges */
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.moveTo(D1.x, D1.y); ctx.lineTo(A1.x, A1.y); ctx.lineTo(B1.x, B1.y);
    ctx.stroke();
    return { A1: A1, B1: B1, C1: C1, D1: D1, C0: C0 };
  }

  /* ---- architectural detail helpers (all in local iso coords) ---- */

  /* row of sheared windows along a wall: start grid point (sx,sy), unit grid
     direction (dgx,dgy), n windows every ds grid units; elev = top of window
     row in px above ground; some panes lit warm when lit=true */
  function windowsAlong(ctx, o, sx, sy, dgx, dgy, n, ds, elev, wpx, hpx, lit) {
    const u = isoPt(dgx, dgy);
    const ul = Math.hypot(u.x, u.y);
    const wx = u.x / ul * wpx, wy = u.y / ul * wpx;
    for (let i = 0; i < n; i++) {
      const g = isoPt(sx + dgx * ds * (i + 0.5), sy + dgy * ds * (i + 0.5));
      const px = o.x + g.x - wx / 2, py = o.y + g.y - elev;
      ctx.fillStyle = (lit && i % 3 !== 1) ? '#e8d492' : '#2c3a4a';
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + wx, py + wy);
      ctx.lineTo(px + wx, py + wy + hpx);
      ctx.lineTo(px, py + hpx);
      ctx.closePath();
      ctx.fill();
    }
  }

  /* pitched gable roof over footprint rect, ridge running along +x */
  function gableRoof(ctx, o, x0, y0, w, h, base, ridge, colFront, colEnd) {
    const yc = y0 + h / 2;
    const r0 = isoPt(x0, yc), r1 = isoPt(x0 + w, yc);
    const eA = isoPt(x0, y0 + h), eB = isoPt(x0 + w, y0 + h);
    const nA = isoPt(x0, y0), nB = isoPt(x0 + w, y0);
    ctx.fillStyle = shade(colFront, -32); /* back slope */
    ctx.beginPath();
    ctx.moveTo(o.x + nA.x, o.y + nA.y - base);
    ctx.lineTo(o.x + nB.x, o.y + nB.y - base);
    ctx.lineTo(o.x + r1.x, o.y + r1.y - ridge);
    ctx.lineTo(o.x + r0.x, o.y + r0.y - ridge);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = colFront; /* front slope */
    ctx.beginPath();
    ctx.moveTo(o.x + r0.x, o.y + r0.y - ridge);
    ctx.lineTo(o.x + r1.x, o.y + r1.y - ridge);
    ctx.lineTo(o.x + eB.x, o.y + eB.y - base);
    ctx.lineTo(o.x + eA.x, o.y + eA.y - base);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = colEnd || shade(colFront, -18); /* east gable end */
    ctx.beginPath();
    ctx.moveTo(o.x + r1.x, o.y + r1.y - ridge);
    ctx.lineTo(o.x + nB.x, o.y + nB.y - base);
    ctx.lineTo(o.x + eB.x, o.y + eB.y - base);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(o.x + r0.x, o.y + r0.y - ridge);
    ctx.lineTo(o.x + r1.x, o.y + r1.y - ridge);
    ctx.stroke();
  }

  /* corrugation / panel seams across a flat roof at elevation */
  function roofSeams(ctx, o, x0, y0, w, h, elev, n, col) {
    ctx.strokeStyle = col || 'rgba(0,0,0,0.14)';
    ctx.lineWidth = 1;
    for (let i = 1; i < n; i++) {
      const a = isoPt(x0 + w * i / n, y0), b2 = isoPt(x0 + w * i / n, y0 + h);
      ctx.beginPath();
      ctx.moveTo(o.x + a.x, o.y + a.y - elev);
      ctx.lineTo(o.x + b2.x, o.y + b2.y - elev);
      ctx.stroke();
    }
  }

  /* upright oil drum at screen position */
  function drum(ctx, x, y, r, h, col) {
    ctx.fillStyle = shade(col, -16);
    ctx.fillRect(x - r, y - h, 2 * r, h);
    ctx.fillStyle = shade(col, 8);
    ctx.beginPath(); ctx.ellipse(x, y - h, r, r * 0.45, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - r, y - h * 0.55); ctx.lineTo(x + r, y - h * 0.55);
    ctx.moveTo(x - r, y - h * 0.25); ctx.lineTo(x + r, y - h * 0.25);
    ctx.stroke();
  }

  /* waving flag on a pole */
  function flagPole(ctx, px, py, h, col) {
    ctx.strokeStyle = '#d9dde3'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py - h); ctx.stroke();
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(px, py - h);
    ctx.quadraticCurveTo(px + 6, py - h + 2.5, px + 12, py - h + 1.5);
    ctx.lineTo(px + 12, py - h + 7.5);
    ctx.quadraticCurveTo(px + 6, py - h + 8.5, px, py - h + 6);
    ctx.closePath(); ctx.fill();
  }

  /* sandbag row: little tan bumps between two grid points */
  function sandbags(ctx, o, x0, y0, x1, y1, n) {
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const g = isoPt(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
      ctx.fillStyle = i % 2 ? '#c2ad7c' : '#b5a071';
      ctx.beginPath();
      ctx.ellipse(o.x + g.x, o.y + g.y - 2, 3.6, 2.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(80,66,40,0.5)'; ctx.lineWidth = 0.7;
      ctx.stroke();
    }
  }

  function ownerCol(ownerIdx) {
    if (ownerIdx < 0 || ownerIdx > 1) return C.NEUTRAL_COLOR;
    return C.PLAYER_COLORS[ownerIdx];
  }

  function buildBuilding(type, ownerIdx, variant) {
    variant = variant || 0;
    const def = C.BUILDINGS[type];
    const pc = ownerCol(ownerIdx);
    const w = def.w, h = def.h;
    const pad = 14, roomTop = 80;
    const cw = (w + h) * TW2 + pad * 2;
    const ch = (w + h) * TH2 + roomTop + pad;
    const c = cv(cw, ch), ctx = c.getContext('2d');
    const ax = h * TW2 + pad;         // anchor: local px of grid point (0,0)
    const ay = roomTop;
    const b = { x: ax, y: ay };       // local origin for isoPt-based drawing

    /* ground pad */
    ctx.beginPath();
    const g0 = isoPt(0, 0), g1 = isoPt(w, 0), g2 = isoPt(w, h), g3 = isoPt(0, h);
    ctx.moveTo(b.x + g0.x, b.y + g0.y);
    ctx.lineTo(b.x + g1.x, b.y + g1.y);
    ctx.lineTo(b.x + g2.x, b.y + g2.y);
    ctx.lineTo(b.x + g3.x, b.y + g3.y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(40,42,48,0.55)';
    ctx.fill();

    const M = pc.main;
    switch (type) {
      case 'hq': {
        /* concrete apron with expansion joints */
        ctx.strokeStyle = 'rgba(255,255,255,0.07)';
        ctx.lineWidth = 1;
        for (let k = 1; k < 3; k++) {
          const a = isoPt(k, 0.08), q = isoPt(k, 2.92);
          ctx.beginPath();
          ctx.moveTo(b.x + a.x, b.y + a.y); ctx.lineTo(b.x + q.x, b.y + q.y);
          ctx.stroke();
        }
        /* main office block with two window bands */
        isoBox(ctx, b.x, b.y, 0.25, 0.25, 2.5, 2.5, 32, '#6d737c');
        windowsAlong(ctx, b, 0.35, 2.75, 1, 0, 6, 0.39, 26, 5, 6, true);
        windowsAlong(ctx, b, 0.35, 2.75, 1, 0, 6, 0.39, 14, 5, 6, false);
        windowsAlong(ctx, b, 2.75, 2.7, 0, -1, 6, 0.39, 26, 5, 6, true);
        windowsAlong(ctx, b, 2.75, 2.7, 0, -1, 6, 0.39, 14, 5, 6, false);
        /* rooftop AC units + vent */
        isoBox(ctx, b.x, b.y, 0.5, 2.05, 0.35, 0.35, 6, '#9aa1aa', 32);
        isoBox(ctx, b.x, b.y, 2.05, 0.5, 0.35, 0.35, 6, '#8d949d', 32);
        /* command tower in owner colors with a glazed operations deck */
        isoBox(ctx, b.x, b.y, 0.85, 0.85, 1.3, 1.3, 58, M);
        windowsAlong(ctx, b, 0.92, 2.15, 1, 0, 3, 0.39, 50, 6, 5, true);
        windowsAlong(ctx, b, 2.15, 2.08, 0, -1, 3, 0.39, 50, 6, 5, true);
        ctx.fillStyle = pc.light; /* trim band under the deck */
        const tb1 = isoPt(0.85, 2.15), tb2 = isoPt(2.15, 2.15), tb3 = isoPt(2.15, 0.85);
        ctx.beginPath();
        ctx.moveTo(b.x + tb1.x, b.y + tb1.y - 42);
        ctx.lineTo(b.x + tb2.x, b.y + tb2.y - 42);
        ctx.lineTo(b.x + tb3.x, b.y + tb3.y - 42);
        ctx.lineTo(b.x + tb3.x, b.y + tb3.y - 40);
        ctx.lineTo(b.x + tb2.x, b.y + tb2.y - 40);
        ctx.lineTo(b.x + tb1.x, b.y + tb1.y - 40);
        ctx.closePath(); ctx.fill();
        /* comms mast with cross-arms, dish and beacon */
        const tp = isoPt(1.5, 1.5);
        const mx = b.x + tp.x, my = b.y + tp.y;
        ctx.strokeStyle = '#d6dbe2'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(mx, my - 58); ctx.lineTo(mx, my - 98); ctx.stroke();
        ctx.lineWidth = 1;
        for (let k = 0; k < 3; k++) {
          const yy = my - 68 - k * 9, ww = 7 - k * 1.8;
          ctx.beginPath(); ctx.moveTo(mx - ww, yy); ctx.lineTo(mx + ww, yy); ctx.stroke();
        }
        ctx.fillStyle = '#c9cfd8'; /* dish */
        ctx.beginPath(); ctx.ellipse(mx - 7, my - 72, 4.5, 6, -0.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#e05038'; /* beacon */
        ctx.beginPath(); ctx.arc(mx, my - 98, 2.2, 0, Math.PI * 2); ctx.fill();
        /* entrance: steps, posts, canopy and glass doors */
        const en = isoPt(1.5, 2.75);
        const ex = b.x + en.x, ey = b.y + en.y;
        ctx.fillStyle = '#23303e'; /* glass double door */
        ctx.beginPath();
        ctx.moveTo(ex - 6, ey - 13); ctx.lineTo(ex + 6, ey - 7); ctx.lineTo(ex + 6, ey + 3); ctx.lineTo(ex - 6, ey - 3);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(220,228,238,0.6)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(ex, ey - 10); ctx.lineTo(ex, ey); ctx.stroke();
        isoBox(ctx, b.x, b.y, 1.2, 2.78, 0.62, 0.2, 2, '#7d838c');       /* step */
        isoBox(ctx, b.x, b.y, 1.24, 2.74, 0.54, 0.22, 2, '#8d939c', 12); /* canopy slab */
        ctx.strokeStyle = '#3a3f46'; ctx.lineWidth = 1.6;                /* canopy posts */
        const cp1 = isoPt(1.28, 2.95), cp2 = isoPt(1.74, 2.95);
        ctx.beginPath();
        ctx.moveTo(b.x + cp1.x, b.y + cp1.y - 2); ctx.lineTo(b.x + cp1.x, b.y + cp1.y - 12);
        ctx.moveTo(b.x + cp2.x, b.y + cp2.y - 2); ctx.lineTo(b.x + cp2.x, b.y + cp2.y - 12);
        ctx.stroke();
        /* flag at the south corner */
        const fp = isoPt(0.3, 2.8);
        flagPole(ctx, b.x + fp.x, b.y + fp.y, 38, M);
        break;
      }
      case 'power': {
        /* turbine hall with corrugated roof and glowing window band */
        isoBox(ctx, b.x, b.y, 0.1, 0.1, 1.32, 1.8, 26, '#5f6771');
        roofSeams(ctx, b, 0.1, 0.1, 1.32, 1.8, 26, 6);
        windowsAlong(ctx, b, 0.16, 1.9, 1, 0, 3, 0.42, 19, 7, 6, true);
        windowsAlong(ctx, b, 1.42, 1.85, 0, -1, 4, 0.42, 19, 6, 5, true);
        /* rooftop intake duct + owner band on the wall */
        isoBox(ctx, b.x, b.y, 0.32, 0.5, 0.42, 0.42, 8, '#7c848e', 26);
        ctx.fillStyle = M;
        const pb1 = isoPt(0.14, 1.9), pb2 = isoPt(1.38, 1.9);
        ctx.beginPath();
        ctx.moveTo(b.x + pb1.x, b.y + pb1.y - 7);
        ctx.lineTo(b.x + pb2.x, b.y + pb2.y - 7);
        ctx.lineTo(b.x + pb2.x, b.y + pb2.y - 4);
        ctx.lineTo(b.x + pb1.x, b.y + pb1.y - 4);
        ctx.closePath(); ctx.fill();
        /* twin smokestacks with red/white aviation bands */
        for (const s of [[1.68, 0.5], [1.68, 1.28]]) {
          const pt = isoPt(s[0], s[1]);
          const px = b.x + pt.x, py = b.y + pt.y;
          ctx.fillStyle = s[1] > 1 ? '#828992' : '#8d949d';
          ctx.beginPath();
          ctx.moveTo(px - 9, py); ctx.lineTo(px - 5.5, py - 46); ctx.lineTo(px + 5.5, py - 46); ctx.lineTo(px + 9, py);
          ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#c8503c';
          ctx.fillRect(px - 6.2, py - 46, 12.4, 5);
          ctx.fillStyle = '#e8e4dc';
          ctx.fillRect(px - 6.6, py - 41, 13.2, 4);
          ctx.fillStyle = '#33383f';
          ctx.beginPath(); ctx.ellipse(px, py - 46, 5.5, 2, 0, 0, Math.PI * 2); ctx.fill();
        }
        /* transformer yard: insulator stacks and feed wires */
        const ty = isoPt(1.68, 0.92);
        const tx = b.x + ty.x, tyy = b.y + ty.y;
        for (const off of [-6, 4]) {
          for (let k = 0; k < 3; k++) {
            ctx.fillStyle = k % 2 ? '#9aa1aa' : '#7c848e';
            ctx.beginPath(); ctx.ellipse(tx + off, tyy - 3 - k * 3.2, 3.2 - k * 0.5, 1.6, 0, 0, Math.PI * 2); ctx.fill();
          }
        }
        ctx.strokeStyle = 'rgba(40,44,50,0.8)'; ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(tx - 6, tyy - 12); ctx.quadraticCurveTo(tx - 14, tyy - 16, tx - 22, tyy - 22);
        ctx.moveTo(tx + 4, tyy - 12); ctx.quadraticCurveTo(tx - 6, tyy - 18, tx - 20, tyy - 24);
        ctx.stroke();
        break;
      }
      case 'mine': {
        /* churned-up dirt yard */
        const dp = isoPt(1, 1);
        ctx.fillStyle = 'rgba(96,76,50,0.55)';
        ctx.beginPath(); ctx.ellipse(b.x + dp.x, b.y + dp.y, 54, 26, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(60,46,28,0.4)'; ctx.lineWidth = 1;
        for (let k = 0; k < 4; k++) { /* tire ruts */
          ctx.beginPath();
          ctx.ellipse(b.x + dp.x, b.y + dp.y, 40 - k * 9, 19 - k * 4.5, 0, 0.6, 1.9);
          ctx.stroke();
        }
        /* spoil mound with timber-framed shaft entrance */
        const ad = isoPt(0.55, 0.6);
        const ax2 = b.x + ad.x, ay2 = b.y + ad.y;
        ctx.fillStyle = '#77664a';
        ctx.beginPath(); ctx.ellipse(ax2, ay2 - 4, 17, 11, 0, Math.PI, 0); ctx.fill();
        ctx.fillStyle = '#161311'; /* adit opening */
        ctx.beginPath();
        ctx.moveTo(ax2 - 5, ay2 + 1); ctx.lineTo(ax2 - 4, ay2 - 8); ctx.lineTo(ax2 + 4, ay2 - 8); ctx.lineTo(ax2 + 5, ay2 + 1);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#6b4a2b'; ctx.lineWidth = 2; /* timber frame */
        ctx.beginPath();
        ctx.moveTo(ax2 - 6, ay2 + 1); ctx.lineTo(ax2 - 5, ay2 - 9);
        ctx.lineTo(ax2 + 5, ay2 - 9); ctx.lineTo(ax2 + 6, ay2 + 1);
        ctx.stroke();
        /* rails + ore cart */
        ctx.strokeStyle = '#4a4a4e'; ctx.lineWidth = 1.2;
        const r1 = isoPt(0.62, 0.72), r2 = isoPt(1.05, 1.5);
        ctx.beginPath();
        ctx.moveTo(b.x + r1.x - 3, b.y + r1.y); ctx.lineTo(b.x + r2.x - 3, b.y + r2.y);
        ctx.moveTo(b.x + r1.x + 3, b.y + r1.y); ctx.lineTo(b.x + r2.x + 3, b.y + r2.y);
        ctx.stroke();
        const ct = isoPt(0.88, 1.18);
        ctx.fillStyle = '#3c424a';
        ctx.fillRect(b.x + ct.x - 5, b.y + ct.y - 8, 10, 6);
        ctx.fillStyle = '#8fa3c0'; /* ore heaped in the cart */
        ctx.beginPath(); ctx.ellipse(b.x + ct.x, b.y + ct.y - 8, 4, 2, 0, Math.PI, 0); ctx.fill();
        ctx.fillStyle = '#23262b';
        ctx.beginPath(); ctx.arc(b.x + ct.x - 3, b.y + ct.y - 1.4, 1.4, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(b.x + ct.x + 3, b.y + ct.y - 1.4, 1.4, 0, Math.PI * 2); ctx.fill();
        /* cross-braced headframe with winding wheel */
        const tp = isoPt(1.42, 1.32);
        const px = b.x + tp.x, py = b.y + tp.y;
        ctx.strokeStyle = '#57503e'; ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(px - 13, py); ctx.lineTo(px - 3, py - 46);
        ctx.moveTo(px + 13, py); ctx.lineTo(px + 3, py - 46);
        ctx.stroke();
        ctx.lineWidth = 1.3; /* lattice bracing */
        for (let k = 0; k < 3; k++) {
          const yy = py - 8 - k * 13, ww = 10.5 - k * 2.2;
          ctx.beginPath();
          ctx.moveTo(px - ww, yy); ctx.lineTo(px + ww - 2, yy - 13);
          ctx.moveTo(px + ww, yy); ctx.lineTo(px - ww + 2, yy - 13);
          ctx.moveTo(px - ww, yy); ctx.lineTo(px + ww, yy);
          ctx.stroke();
        }
        ctx.strokeStyle = '#2f333a'; ctx.lineWidth = 2; /* winding wheel */
        ctx.beginPath(); ctx.arc(px, py - 51, 6, 0, Math.PI * 2); ctx.stroke();
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px - 6, py - 51); ctx.lineTo(px + 6, py - 51);
        ctx.moveTo(px, py - 57); ctx.lineTo(px, py - 45);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(40,40,44,0.8)'; /* hoist cable to the shaft */
        ctx.beginPath(); ctx.moveTo(px - 5, py - 49); ctx.lineTo(ax2, ay2 - 6); ctx.stroke();
        /* winch house with owner-color roof */
        isoBox(ctx, b.x, b.y, 1.35, 1.42, 0.5, 0.42, 12, '#6b6046');
        gableRoof(ctx, b, 1.32, 1.39, 0.56, 0.48, 12, 19, shade(M, -8));
        /* mineral stockpile */
        const op = isoPt(0.42, 1.55);
        for (const pk of [[-6, 0, 8], [5, 2, 6], [0, -3, 7]]) {
          ctx.fillStyle = pk[2] > 6 ? '#8fa3c0' : '#7d92b2';
          ctx.beginPath();
          ctx.ellipse(b.x + op.x + pk[0], b.y + op.y + pk[1], pk[2], pk[2] * 0.5, 0, Math.PI, 0);
          ctx.fill();
        }
        break;
      }
      case 'pump': {
        /* brick pump house with pitched roof, door and window */
        isoBox(ctx, b.x, b.y, 0.12, 0.5, 1.0, 1.3, 18, '#8a6a54');
        gableRoof(ctx, b, 0.06, 0.44, 1.12, 1.42, 18, 30, '#5f7285');
        ctx.strokeStyle = 'rgba(60,40,28,0.35)'; ctx.lineWidth = 0.8; /* brick courses */
        const bw1 = isoPt(0.16, 1.8), bw2 = isoPt(1.08, 1.8);
        for (let k = 1; k < 4; k++) {
          ctx.beginPath();
          ctx.moveTo(b.x + bw1.x, b.y + bw1.y - k * 4.5);
          ctx.lineTo(b.x + bw2.x, b.y + bw2.y - k * 4.5);
          ctx.stroke();
        }
        const dr = isoPt(0.45, 1.8); /* door */
        ctx.fillStyle = '#3a3026';
        ctx.beginPath();
        ctx.moveTo(b.x + dr.x - 3.5, b.y + dr.y - 12);
        ctx.lineTo(b.x + dr.x + 3.5, b.y + dr.y - 9);
        ctx.lineTo(b.x + dr.x + 3.5, b.y + dr.y + 2);
        ctx.lineTo(b.x + dr.x - 3.5, b.y + dr.y - 1);
        ctx.closePath(); ctx.fill();
        windowsAlong(ctx, b, 1.12, 1.55, 0, -1, 1, 0.6, 13, 6, 5, true);
        /* riveted water tank with ladder and level gauge */
        const px = b.x + isoPt(1.52, 0.62).x, py = b.y + isoPt(1.52, 0.62).y;
        const g2 = ctx.createLinearGradient(px - 12, 0, px + 12, 0);
        g2.addColorStop(0, '#6d9cbe'); g2.addColorStop(0.45, '#89b4d2'); g2.addColorStop(1, '#54809f');
        ctx.fillStyle = g2;
        ctx.fillRect(px - 12, py - 38, 24, 34);
        ctx.fillStyle = '#3f6a8c';
        ctx.beginPath(); ctx.ellipse(px, py - 4, 12, 4.2, 0, 0, Math.PI); ctx.fill();
        ctx.fillStyle = '#9cc2dc';
        ctx.beginPath(); ctx.ellipse(px, py - 38, 12, 4.2, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(30,50,66,0.5)'; ctx.lineWidth = 1; /* riveted bands */
        for (const yy of [-27, -16]) {
          ctx.beginPath(); ctx.moveTo(px - 12, py + yy); ctx.lineTo(px + 12, py + yy); ctx.stroke();
          ctx.fillStyle = 'rgba(30,50,66,0.55)';
          for (let k = -9; k <= 9; k += 4.5) ctx.fillRect(px + k, py + yy - 1.6, 1.2, 1.2);
        }
        ctx.fillStyle = M; /* owner band */
        ctx.fillRect(px - 12, py - 12, 24, 3.5);
        ctx.strokeStyle = '#2f3b44'; ctx.lineWidth = 1.2; /* ladder */
        ctx.beginPath();
        ctx.moveTo(px - 15, py - 2); ctx.lineTo(px - 15, py - 36);
        ctx.moveTo(px - 18, py - 2); ctx.lineTo(px - 18, py - 36);
        ctx.stroke();
        for (let k = 0; k < 7; k++) {
          ctx.beginPath();
          ctx.moveTo(px - 18, py - 5 - k * 5); ctx.lineTo(px - 15, py - 5 - k * 5);
          ctx.stroke();
        }
        /* flanged pipe run with valve wheel + intake to the water */
        ctx.strokeStyle = '#4a5a64'; ctx.lineWidth = 4;
        const vp = isoPt(1.05, 1.55);
        ctx.beginPath();
        ctx.moveTo(px - 4, py - 2);
        ctx.lineTo(b.x + vp.x, b.y + vp.y);
        ctx.stroke();
        ctx.lineWidth = 3.4;
        const ip = isoPt(1.9, 1.55);
        ctx.beginPath();
        ctx.moveTo(px + 6, py - 3);
        ctx.lineTo(b.x + ip.x, b.y + ip.y - 2);
        ctx.lineTo(b.x + ip.x + 4, b.y + ip.y + 4);
        ctx.stroke();
        const vx = b.x + (px - b.x + vp.x) / 2, vy = b.y + (py - b.y + vp.y) / 2 - 2;
        ctx.strokeStyle = '#c8503c'; ctx.lineWidth = 1.6; /* valve wheel */
        ctx.beginPath(); ctx.arc(vx, vy - 4, 3, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(vx, vy - 7); ctx.lineTo(vx, vy - 1); ctx.stroke();
        break;
      }
      case 'dam': {
        /* concrete gravity wall across the river */
        isoBox(ctx, b.x, b.y, 0, 0.55, 2, 0.9, 42, '#a8adb5');
        /* buttress ribs on the downstream face */
        ctx.fillStyle = 'rgba(70,76,86,0.35)';
        for (const rx of [0.35, 1.0, 1.65]) {
          const rp = isoPt(rx, 1.45);
          ctx.beginPath();
          ctx.moveTo(b.x + rp.x - 2, b.y + rp.y - 40);
          ctx.lineTo(b.x + rp.x + 2, b.y + rp.y - 38);
          ctx.lineTo(b.x + rp.x + 4, b.y + rp.y + 2);
          ctx.lineTo(b.x + rp.x - 4, b.y + rp.y);
          ctx.closePath(); ctx.fill();
        }
        /* twin spillway gates with churning water */
        const s1 = isoPt(0.55, 1.0), s2 = isoPt(1.45, 1.0);
        ctx.fillStyle = 'rgba(150,205,240,0.85)';
        ctx.beginPath();
        ctx.moveTo(b.x + s1.x, b.y + s1.y - 32);
        ctx.lineTo(b.x + s2.x, b.y + s2.y - 32);
        ctx.lineTo(b.x + s2.x + 5, b.y + s2.y + 13);
        ctx.lineTo(b.x + s1.x - 5, b.y + s1.y + 13);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#5d646e'; /* gate divider + frames */
        const gm = isoPt(1.0, 1.0);
        ctx.fillRect(b.x + gm.x - 1.5, b.y + gm.y - 33, 3, 40);
        ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1.5;
        for (let k = 0; k < 5; k++) {
          ctx.beginPath();
          ctx.moveTo(b.x + s1.x + 4 + k * 6.5, b.y + s1.y - 28 + k * 1.6);
          ctx.lineTo(b.x + s1.x + 2 + k * 6.5, b.y + s1.y + 11);
          ctx.stroke();
        }
        /* foam boiling at the stilling basin */
        for (let k = 0; k < 5; k++) {
          ctx.fillStyle = 'rgba(235,245,252,' + (0.5 + (k % 2) * 0.25) + ')';
          const fx = b.x + s1.x - 4 + k * 8.5, fy = b.y + s1.y + 12 + (k % 2) * 2.5;
          ctx.beginPath(); ctx.ellipse(fx, fy, 5, 2.2, 0, 0, Math.PI * 2); ctx.fill();
        }
        /* crest road, railing posts and lamps */
        const cA = isoPt(0.08, 1.0), cB = isoPt(1.92, 1.0);
        ctx.strokeStyle = '#c9ced6'; ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(b.x + cA.x, b.y + cA.y - 47);
        ctx.lineTo(b.x + cB.x, b.y + cB.y - 47);
        ctx.stroke();
        for (let k = 0; k <= 5; k++) {
          const t = k / 5;
          const px2 = b.x + cA.x + (cB.x - cA.x) * t;
          const py2 = b.y + cA.y + (cB.y - cA.y) * t;
          ctx.beginPath();
          ctx.moveTo(px2, py2 - 42); ctx.lineTo(px2, py2 - 47);
          ctx.stroke();
          if (k === 1 || k === 4) { /* lamp heads */
            ctx.fillStyle = '#ffe9a8';
            ctx.beginPath(); ctx.arc(px2, py2 - 49, 1.6, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = '#c9ced6';
          }
        }
        /* control cabin on the west crest, in owner colors */
        isoBox(ctx, b.x, b.y, 0.1, 0.68, 0.42, 0.55, 9, shade(M, -6), 42);
        windowsAlong(ctx, b, 0.14, 1.23, 1, 0, 1, 0.36, 48, 5, 4, true);
        break;
      }
      case 'barracks': {
        /* olive-drab hut with corrugated gable roof */
        isoBox(ctx, b.x, b.y, 0.15, 0.15, 1.7, 1.05, 19, '#6b7050');
        gableRoof(ctx, b, 0.08, 0.08, 1.84, 1.19, 19, 32, '#575c42', '#494e36');
        ctx.strokeStyle = 'rgba(0,0,0,0.16)'; ctx.lineWidth = 1; /* roof corrugation */
        for (let k = 1; k < 8; k++) {
          const t = 0.08 + 1.84 * k / 8;
          const ra = isoPt(t, 0.675), rb = isoPt(t, 1.27);
          ctx.beginPath();
          ctx.moveTo(b.x + ra.x, b.y + ra.y - 32);
          ctx.lineTo(b.x + rb.x, b.y + rb.y - 19);
          ctx.stroke();
        }
        /* door + windows along the south wall */
        const bd2 = isoPt(0.5, 1.2);
        ctx.fillStyle = '#33382a';
        ctx.beginPath();
        ctx.moveTo(b.x + bd2.x - 4, b.y + bd2.y - 13);
        ctx.lineTo(b.x + bd2.x + 4, b.y + bd2.y - 10);
        ctx.lineTo(b.x + bd2.x + 4, b.y + bd2.y + 2);
        ctx.lineTo(b.x + bd2.x - 4, b.y + bd2.y - 1);
        ctx.closePath(); ctx.fill();
        windowsAlong(ctx, b, 0.75, 1.2, 1, 0, 3, 0.34, 13, 5, 4.5, true);
        windowsAlong(ctx, b, 1.85, 1.12, 0, -1, 2, 0.45, 13, 5, 4.5, false);
        /* sandbag emplacement guarding the entrance */
        sandbags(ctx, b, 0.2, 1.55, 0.85, 1.72, 6);
        sandbags(ctx, b, 0.24, 1.62, 0.82, 1.79, 5);
        /* field tent */
        const tt = isoPt(1.55, 1.55);
        const tx2 = b.x + tt.x, ty2 = b.y + tt.y;
        ctx.fillStyle = '#7a8060';
        ctx.beginPath();
        ctx.moveTo(tx2 - 10, ty2); ctx.lineTo(tx2 - 2, ty2 - 12); ctx.lineTo(tx2 + 9, ty2 - 7); ctx.lineTo(tx2 + 2, ty2 + 4);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#5d6248';
        ctx.beginPath();
        ctx.moveTo(tx2 - 10, ty2); ctx.lineTo(tx2 - 2, ty2 - 12); ctx.lineTo(tx2 - 4, ty2 + 1);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#2e3226'; /* tent opening */
        ctx.beginPath();
        ctx.moveTo(tx2 - 8, ty2); ctx.lineTo(tx2 - 3.5, ty2 - 7); ctx.lineTo(tx2 - 4.5, ty2 + 0.5);
        ctx.closePath(); ctx.fill();
        /* crates + flag */
        isoBox(ctx, b.x, b.y, 1.72, 0.2, 0.22, 0.22, 6, '#9a7b4f');
        isoBox(ctx, b.x, b.y, 1.5, 0.14, 0.2, 0.2, 5, '#8a6d45');
        const fp = isoPt(1.08, 1.78);
        flagPole(ctx, b.x + fp.x, b.y + fp.y, 36, M);
        break;
      }
      case 'factory': {
        /* production hall */
        isoBox(ctx, b.x, b.y, 0.1, 0.1, 2.55, 1.8, 24, '#616872');
        /* sawtooth roof with north-light glazing */
        for (let k = 0; k < 4; k++) {
          const x0 = 0.1 + k * 0.6375, x1 = x0 + 0.45, x2 = x0 + 0.6375;
          const a0 = isoPt(x0, 0.1), a1 = isoPt(x1, 0.1);
          const c0 = isoPt(x0, 1.9), c1 = isoPt(x1, 1.9);
          ctx.fillStyle = shade('#616872', 22); /* slope */
          ctx.beginPath();
          ctx.moveTo(b.x + a0.x, b.y + a0.y - 24);
          ctx.lineTo(b.x + a1.x, b.y + a1.y - 36);
          ctx.lineTo(b.x + c1.x, b.y + c1.y - 36);
          ctx.lineTo(b.x + c0.x, b.y + c0.y - 24);
          ctx.closePath(); ctx.fill();
          const b1 = isoPt(x2, 0.1), d1 = isoPt(x2, 1.9); /* vertical glass face */
          ctx.fillStyle = '#3c5a74';
          ctx.beginPath();
          ctx.moveTo(b.x + a1.x, b.y + a1.y - 36);
          ctx.lineTo(b.x + c1.x, b.y + c1.y - 36);
          ctx.lineTo(b.x + d1.x, b.y + d1.y - 24);
          ctx.lineTo(b.x + b1.x, b.y + b1.y - 24);
          ctx.closePath(); ctx.fill();
        }
        /* banded chimney */
        const cp = isoPt(2.75, 0.35);
        const cx2 = b.x + cp.x, cy2 = b.y + cp.y;
        ctx.fillStyle = '#4a505a';
        ctx.fillRect(cx2 - 5, cy2 - 52, 10, 52);
        ctx.fillStyle = M;
        ctx.fillRect(cx2 - 5, cy2 - 48, 10, 4);
        ctx.fillRect(cx2 - 5, cy2 - 30, 10, 4);
        ctx.fillStyle = '#2b2f35';
        ctx.beginPath(); ctx.ellipse(cx2, cy2 - 52, 5, 1.9, 0, 0, Math.PI * 2); ctx.fill();
        /* big rolling door with hazard chevrons + crew door */
        const dp = isoPt(1.35, 1.9);
        const dx2 = b.x + dp.x, dy2 = b.y + dp.y;
        ctx.fillStyle = '#383d45';
        ctx.beginPath();
        ctx.moveTo(dx2 - 15, dy2 - 24);
        ctx.lineTo(dx2 + 4, dy2 - 14);
        ctx.lineTo(dx2 + 4, dy2 + 3);
        ctx.lineTo(dx2 - 15, dy2 - 7);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(180,188,198,0.3)'; ctx.lineWidth = 1; /* slats */
        for (let k = 1; k < 5; k++) {
          ctx.beginPath();
          ctx.moveTo(dx2 - 15, dy2 - 24 + k * 3.4);
          ctx.lineTo(dx2 + 4, dy2 - 14 + k * 3.4);
          ctx.stroke();
        }
        for (let k = 0; k < 5; k++) { /* hazard chevrons on the lintel */
          ctx.fillStyle = k % 2 ? '#23262b' : '#e0b23f';
          ctx.beginPath();
          ctx.moveTo(dx2 - 15 + k * 4, dy2 - 25.5 + k * 2);
          ctx.lineTo(dx2 - 11 + k * 4, dy2 - 23.5 + k * 2);
          ctx.lineTo(dx2 - 11 + k * 4, dy2 - 21.5 + k * 2);
          ctx.lineTo(dx2 - 15 + k * 4, dy2 - 23.5 + k * 2);
          ctx.closePath(); ctx.fill();
        }
        const cd = isoPt(2.2, 1.9); /* crew door */
        ctx.fillStyle = '#2b2f35';
        ctx.beginPath();
        ctx.moveTo(b.x + cd.x - 3, b.y + cd.y - 12);
        ctx.lineTo(b.x + cd.x + 3, b.y + cd.y - 9);
        ctx.lineTo(b.x + cd.x + 3, b.y + cd.y + 1);
        ctx.lineTo(b.x + cd.x - 3, b.y + cd.y - 2);
        ctx.closePath(); ctx.fill();
        /* east wall windows */
        windowsAlong(ctx, b, 2.65, 1.75, 0, -1, 3, 0.55, 17, 6, 5, true);
        /* yard: drums and a crate */
        const y1 = isoPt(0.35, 1.95);
        drum(ctx, b.x + y1.x, b.y + y1.y, 3.4, 8, '#8a3f34');
        drum(ctx, b.x + y1.x + 8, b.y + y1.y + 3, 3.4, 8, '#55707c');
        isoBox(ctx, b.x, b.y, 0.14, 1.62, 0.22, 0.22, 6, '#9a7b4f');
        break;
      }
      case 'airfield': {
        /* asphalt runway strip with centerline, thresholds and edge lights */
        const rw = [isoPt(0.08, 1.25), isoPt(2.92, 1.25), isoPt(2.92, 1.85), isoPt(0.08, 1.85)];
        ctx.fillStyle = '#43484f';
        ctx.beginPath();
        ctx.moveTo(b.x + rw[0].x, b.y + rw[0].y);
        for (let k = 1; k < 4; k++) ctx.lineTo(b.x + rw[k].x, b.y + rw[k].y);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(230,232,238,0.75)'; ctx.lineWidth = 1.4;
        ctx.setLineDash([6, 7]); /* centerline */
        const rc0 = isoPt(0.2, 1.55), rc1 = isoPt(2.8, 1.55);
        ctx.beginPath();
        ctx.moveTo(b.x + rc0.x, b.y + rc0.y);
        ctx.lineTo(b.x + rc1.x, b.y + rc1.y);
        ctx.stroke();
        ctx.setLineDash([]);
        for (const tx3 of [0.16, 2.84]) { /* threshold bars */
          for (let k = 0; k < 3; k++) {
            const t0 = isoPt(tx3, 1.32 + k * 0.18);
            ctx.beginPath();
            ctx.moveTo(b.x + t0.x - 3, b.y + t0.y);
            ctx.lineTo(b.x + t0.x + 3, b.y + t0.y + 3);
            ctx.stroke();
          }
        }
        for (let k = 0; k < 5; k++) { /* edge lights */
          const e0 = isoPt(0.35 + k * 0.55, 1.22);
          ctx.fillStyle = '#9fd8ff';
          ctx.beginPath(); ctx.arc(b.x + e0.x, b.y + e0.y - 1, 1.3, 0, Math.PI * 2); ctx.fill();
        }
        /* barrel-roof hangar */
        isoBox(ctx, b.x, b.y, 0.15, 0.12, 1.5, 0.95, 16, shade(M, -14));
        const hg0 = isoPt(0.15, 0.6), hg1 = isoPt(1.65, 0.6);
        ctx.fillStyle = shade(M, 4); /* curved roof: arched band along the ridge */
        ctx.beginPath();
        ctx.moveTo(b.x + isoPt(0.15, 0.12).x, b.y + isoPt(0.15, 0.12).y - 16);
        ctx.quadraticCurveTo(b.x + hg0.x - 6, b.y + hg0.y - 34, b.x + isoPt(0.15, 1.07).x, b.y + isoPt(0.15, 1.07).y - 16);
        ctx.lineTo(b.x + isoPt(1.65, 1.07).x, b.y + isoPt(1.65, 1.07).y - 16);
        ctx.quadraticCurveTo(b.x + hg1.x - 6, b.y + hg1.y - 34, b.x + isoPt(1.65, 0.12).x, b.y + isoPt(1.65, 0.12).y - 16);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1; /* roof ribs */
        for (let k = 1; k < 6; k++) {
          const t = 0.15 + 1.5 * k / 6;
          ctx.beginPath();
          ctx.moveTo(b.x + isoPt(t, 0.14).x, b.y + isoPt(t, 0.14).y - 17);
          ctx.quadraticCurveTo(b.x + isoPt(t, 0.6).x - 4, b.y + isoPt(t, 0.6).y - 33,
            b.x + isoPt(t, 1.05).x, b.y + isoPt(t, 1.05).y - 17);
          ctx.stroke();
        }
        /* arched hangar door facing the runway */
        const hd = isoPt(0.85, 1.07);
        ctx.fillStyle = '#23262c';
        ctx.beginPath();
        ctx.moveTo(b.x + hd.x - 13, b.y + hd.y - 1);
        ctx.quadraticCurveTo(b.x + hd.x - 12, b.y + hd.y - 22, b.x + hd.x, b.y + hd.y - 24);
        ctx.quadraticCurveTo(b.x + hd.x + 12, b.y + hd.y - 18, b.x + hd.x + 13, b.y + hd.y + 6);
        ctx.lineTo(b.x + hd.x - 13, b.y + hd.y - 1);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(180,188,198,0.25)';
        for (let k = -8; k <= 8; k += 4) { /* door panels */
          ctx.beginPath();
          ctx.moveTo(b.x + hd.x + k, b.y + hd.y - 20 + Math.abs(k) * 0.3 + k * 0.25);
          ctx.lineTo(b.x + hd.x + k, b.y + hd.y + k * 0.25);
          ctx.stroke();
        }
        /* control tower with glazed cab and radar */
        isoBox(ctx, b.x, b.y, 2.38, 0.3, 0.32, 0.32, 26, '#79808a');
        isoBox(ctx, b.x, b.y, 2.3, 0.22, 0.48, 0.48, 9, '#2e4356', 26);
        isoBox(ctx, b.x, b.y, 2.28, 0.2, 0.52, 0.52, 2, '#9aa1aa', 35);
        const twr = isoPt(2.54, 0.46);
        ctx.strokeStyle = '#d6dbe2'; ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(b.x + twr.x, b.y + twr.y - 37); ctx.lineTo(b.x + twr.x, b.y + twr.y - 45);
        ctx.moveTo(b.x + twr.x - 4, b.y + twr.y - 45); ctx.lineTo(b.x + twr.x + 4, b.y + twr.y - 45);
        ctx.stroke();
        ctx.fillStyle = '#e05038';
        ctx.beginPath(); ctx.arc(b.x + twr.x, b.y + twr.y - 46.5, 1.5, 0, Math.PI * 2); ctx.fill();
        /* windsock */
        const ws = isoPt(2.72, 1.05);
        const wx2 = b.x + ws.x, wy2 = b.y + ws.y;
        ctx.strokeStyle = '#c9cfd8'; ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.moveTo(wx2, wy2); ctx.lineTo(wx2, wy2 - 18); ctx.stroke();
        ctx.fillStyle = '#e07b28';
        ctx.beginPath();
        ctx.moveTo(wx2, wy2 - 18); ctx.lineTo(wx2 + 10, wy2 - 16.5); ctx.lineTo(wx2 + 10, wy2 - 14); ctx.lineTo(wx2, wy2 - 13.5);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#e8e4dc';
        ctx.fillRect(wx2 + 3.5, wy2 - 17.4, 3, 3.4);
        /* fuel dump */
        const fd = isoPt(1.95, 0.3);
        drum(ctx, b.x + fd.x, b.y + fd.y, 3.2, 7.5, '#8a3f34');
        drum(ctx, b.x + fd.x + 8, b.y + fd.y + 3, 3.2, 7.5, '#55707c');
        break;
      }
      case 'turret': {
        /* concrete emplacement ringed with sandbags */
        isoBox(ctx, b.x, b.y, 0.14, 0.14, 0.72, 0.72, 10, '#6a7078');
        for (let k = 0; k < 4; k++) { /* hazard band */
          const hz = isoPt(0.2 + k * 0.16, 0.86);
          ctx.fillStyle = k % 2 ? '#23262b' : '#e0b23f';
          ctx.beginPath();
          ctx.moveTo(b.x + hz.x, b.y + hz.y - 4);
          ctx.lineTo(b.x + hz.x + 5, b.y + hz.y - 1.5);
          ctx.lineTo(b.x + hz.x + 5, b.y + hz.y + 1);
          ctx.lineTo(b.x + hz.x, b.y + hz.y - 1.5);
          ctx.closePath(); ctx.fill();
        }
        sandbags(ctx, b, 0.06, 0.98, 0.62, 0.98, 4);
        sandbags(ctx, b, 0.98, 0.9, 0.98, 0.2, 4);
        /* armored turret: ring, dome, twin barrels with muzzle brakes */
        const tp = isoPt(0.5, 0.5);
        const px = b.x + tp.x, py = b.y + tp.y - 10;
        ctx.fillStyle = '#3a3f46';
        ctx.beginPath(); ctx.ellipse(px, py - 2, 10, 5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = shade(M, -6);
        ctx.beginPath(); ctx.ellipse(px, py - 6, 8, 6.2, 0, Math.PI, 0); ctx.fill();
        ctx.fillStyle = shade(M, 16);
        ctx.beginPath(); ctx.ellipse(px - 2, py - 8, 4, 2.6, -0.4, Math.PI, 0); ctx.fill();
        ctx.strokeStyle = '#2b2f35'; ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(px + 2, py - 7); ctx.lineTo(px + 16, py - 12);
        ctx.moveTo(px + 3, py - 4.5); ctx.lineTo(px + 17, py - 9.5);
        ctx.stroke();
        ctx.lineWidth = 3.4; /* muzzle brakes */
        ctx.beginPath();
        ctx.moveTo(px + 14.5, py - 11.5); ctx.lineTo(px + 16, py - 12);
        ctx.moveTo(px + 15.5, py - 9); ctx.lineTo(px + 17, py - 9.5);
        ctx.stroke();
        ctx.fillStyle = '#23262b'; /* hatch */
        ctx.beginPath(); ctx.ellipse(px - 4, py - 10, 2.4, 1.4, 0, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'house': {
        /* three cottage variants so the town looks lived-in */
        const wallCols = ['#b3a288', '#9f9483', '#a89076'];
        const roofCols = ['#9e523e', '#5d7183', '#74452f'];
        const wc = wallCols[variant % 3], rc2 = roofCols[variant % 3];
        isoBox(ctx, b.x, b.y, 0.16, 0.16, 0.68, 0.68, 14, wc);
        gableRoof(ctx, b, 0.08, 0.08, 0.84, 0.84, 14, 26, rc2);
        ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 0.8; /* shingle courses */
        for (let k = 1; k < 3; k++) {
          const s0 = isoPt(0.08, 0.5 + k * 0.14), s5 = isoPt(0.92, 0.5 + k * 0.14);
          ctx.beginPath();
          ctx.moveTo(b.x + s0.x, b.y + s0.y - 26 + k * 4);
          ctx.lineTo(b.x + s5.x, b.y + s5.y - 26 + k * 4);
          ctx.stroke();
        }
        /* chimney with cap */
        const ch = isoPt(0.32, 0.42);
        ctx.fillStyle = '#7c7168';
        ctx.fillRect(b.x + ch.x - 2.5, b.y + ch.y - 30, 5, 9);
        ctx.fillStyle = '#5d554e';
        ctx.fillRect(b.x + ch.x - 3.5, b.y + ch.y - 31.5, 7, 2);
        /* door + lit window */
        const hd2 = isoPt(0.38, 0.84);
        ctx.fillStyle = '#4a3828';
        ctx.beginPath();
        ctx.moveTo(b.x + hd2.x - 2.8, b.y + hd2.y - 10);
        ctx.lineTo(b.x + hd2.x + 2.8, b.y + hd2.y - 8);
        ctx.lineTo(b.x + hd2.x + 2.8, b.y + hd2.y + 1);
        ctx.lineTo(b.x + hd2.x - 2.8, b.y + hd2.y - 1);
        ctx.closePath(); ctx.fill();
        windowsAlong(ctx, b, 0.6, 0.84, 1, 0, 1, 0.26, 10, 4.5, 4, variant !== 1);
        windowsAlong(ctx, b, 0.84, 0.76, 0, -1, 1, 0.5, 10, 4.5, 4, variant === 1);
        /* garden fence for two of the variants */
        if (variant !== 1) {
          ctx.strokeStyle = '#8a7a5c'; ctx.lineWidth = 1.2;
          for (let k = 0; k < 4; k++) {
            const fp2 = isoPt(0.98, 0.15 + k * 0.26);
            ctx.beginPath();
            ctx.moveTo(b.x + fp2.x, b.y + fp2.y);
            ctx.lineTo(b.x + fp2.x, b.y + fp2.y - 6);
            ctx.stroke();
          }
          const fr0 = isoPt(0.98, 0.12), fr1 = isoPt(0.98, 0.95);
          ctx.beginPath();
          ctx.moveTo(b.x + fr0.x, b.y + fr0.y - 4.5);
          ctx.lineTo(b.x + fr1.x, b.y + fr1.y - 4.5);
          ctx.stroke();
        }
        break;
      }
      case 'depot': {
        /* warehouse with gabled roof and loading dock */
        isoBox(ctx, b.x, b.y, 0.1, 0.1, 1.8, 1.25, 20, '#8d8478');
        gableRoof(ctx, b, 0.04, 0.04, 1.92, 1.37, 20, 32, '#9a917f', '#7a7261');
        roofSeams(ctx, b, 0.04, 0.7, 1.92, 0.71, 26, 7, 'rgba(0,0,0,0.12)');
        /* sliding freight door with rail */
        const sd = isoPt(0.85, 1.35);
        ctx.fillStyle = '#5d564b';
        ctx.beginPath();
        ctx.moveTo(b.x + sd.x - 9, b.y + sd.y - 16);
        ctx.lineTo(b.x + sd.x + 9, b.y + sd.y - 7);
        ctx.lineTo(b.x + sd.x + 9, b.y + sd.y + 3);
        ctx.lineTo(b.x + sd.x - 9, b.y + sd.y - 6);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(40,34,26,0.6)'; ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(b.x + sd.x - 11, b.y + sd.y - 18);
        ctx.lineTo(b.x + sd.x + 11, b.y + sd.y - 8);
        ctx.stroke();
        /* loading dock with pallets, crates and drums */
        isoBox(ctx, b.x, b.y, 0.25, 1.45, 1.1, 0.35, 6, '#6f675c');
        isoBox(ctx, b.x, b.y, 0.35, 1.5, 0.26, 0.26, 7, '#9a7b4f', 6);
        isoBox(ctx, b.x, b.y, 0.68, 1.52, 0.22, 0.22, 5, '#8a6d45', 6);
        isoBox(ctx, b.x, b.y, 1.55, 0.2, 0.3, 0.3, 8, '#9a7b4f');
        const dd = isoPt(1.62, 1.7);
        drum(ctx, b.x + dd.x, b.y + dd.y, 3.2, 7.5, '#55707c');
        drum(ctx, b.x + dd.x + 7, b.y + dd.y + 3, 3.2, 7.5, '#8a3f34');
        break;
      }
    }
    return { c: c, ax: ax, ay: ay };
  }

  function building(type, ownerIdx, variant) {
    variant = variant || 0;
    const oi = (ownerIdx === 0 || ownerIdx === 1) ? ownerIdx : 2;
    const key = 'b' + type + '_' + oi + '_' + variant;
    return cache[key] || (cache[key] = buildBuilding(type, ownerIdx, variant));
  }

  /* construction scaffold sprite for a w×h footprint */
  function scaffold(w, h) {
    const key = 'sc' + w + '_' + h;
    if (cache[key]) return cache[key];
    const pad = 8, roomTop = 50;
    const cw = (w + h) * TW2 + pad * 2, ch = (w + h) * TH2 + roomTop + pad;
    const c = cv(cw, ch), ctx = c.getContext('2d');
    const ax = h * TW2 + pad, ay = roomTop;
    isoBox(ctx, ax, ay, 0.1, 0.1, w - 0.2, h - 0.2, 8, '#7a6f58');
    ctx.strokeStyle = '#b89d6a'; ctx.lineWidth = 2;
    const corners = [[0.15, 0.15], [w - 0.15, 0.15], [w - 0.15, h - 0.15], [0.15, h - 0.15]];
    for (const cr of corners) {
      const p = isoPt(cr[0], cr[1]);
      ctx.beginPath();
      ctx.moveTo(ax + p.x, ay + p.y - 8);
      ctx.lineTo(ax + p.x, ay + p.y - 34);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(184,157,106,0.7)';
    for (let k = 0; k < corners.length; k++) {
      const p1 = isoPt(corners[k][0], corners[k][1]);
      const p2 = isoPt(corners[(k + 1) % 4][0], corners[(k + 1) % 4][1]);
      ctx.beginPath();
      ctx.moveTo(ax + p1.x, ay + p1.y - 30);
      ctx.lineTo(ax + p2.x, ay + p2.y - 30);
      ctx.stroke();
    }
    return (cache[key] = { c: c, ax: ax, ay: ay });
  }

  /* ---------------- units (8 cached facings each) ---------------- */
  const US = 56; // unit sprite canvas size

  function buildUnit(type, ownerIdx, dir8, frame) {
    const pc = ownerCol(ownerIdx);
    const c = cv(US, US), ctx = c.getContext('2d');
    const cx = US / 2, cy = US / 2 + 6;
    const ang = dir8 * Math.PI / 4;
    ctx.save();
    ctx.translate(cx, cy);

    if (type === 'worker' || type === 'infantry' || type === 'rocket') {
      /* soldier: shadow, animated legs, uniform torso, arms, head with headgear */
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.ellipse(0, 2.5, 6.5, 2.8, 0, 0, Math.PI * 2); ctx.fill();
      const step = frame ? 2 : -2;
      /* legs with boots */
      ctx.strokeStyle = '#2e3238'; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-1.6, -5); ctx.lineTo(-2.6 + step, 2);
      ctx.moveTo(1.6, -5); ctx.lineTo(2.6 - step, 2);
      ctx.stroke();
      ctx.fillStyle = '#1b1e22';
      ctx.fillRect(-4.4 + step, 1, 3.4, 2); ctx.fillRect(1.2 - step, 1, 3.4, 2);
      /* torso */
      if (type === 'worker') {
        ctx.fillStyle = '#e07b28'; // hi-vis overalls
        ctx.beginPath(); ctx.roundRect(-4, -13, 8, 10, 2.4); ctx.fill();
        ctx.fillStyle = '#f4d64a'; // reflective stripes
        ctx.fillRect(-4, -10.4, 8, 1.6);
        ctx.fillRect(-1, -13, 2, 10);
        ctx.fillStyle = pc.main; // owner armband
        ctx.fillRect(-4.6, -12.2, 2, 3);
      } else {
        ctx.fillStyle = shade(pc.main, -14);
        ctx.beginPath(); ctx.roundRect(-4, -13, 8, 10, 2.4); ctx.fill();
        ctx.fillStyle = shade(pc.main, 14); // chest plate
        ctx.beginPath(); ctx.roundRect(-2.8, -12, 5.6, 5.4, 1.6); ctx.fill();
        ctx.strokeStyle = '#23262b'; ctx.lineWidth = 1.2; // gear strap
        ctx.beginPath(); ctx.moveTo(-3.6, -12.4); ctx.lineTo(3.6, -8); ctx.stroke();
        ctx.fillStyle = '#4a4438'; // backpack edge
        ctx.fillRect(-5.4, -11.8, 1.8, 5.6);
      }
      /* arms toward facing */
      const awx = Math.cos(ang), awy = Math.sin(ang) * 0.5;
      ctx.strokeStyle = type === 'worker' ? '#e07b28' : shade(pc.main, -22);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-2.5, -10.5); ctx.lineTo(awx * 5 - 1, -9.5 + awy * 5);
      ctx.moveTo(2.5, -10.5); ctx.lineTo(awx * 5.5 + 1, -9.5 + awy * 5.5);
      ctx.stroke();
      /* head + skin */
      ctx.fillStyle = '#e5b48c';
      ctx.beginPath(); ctx.arc(0, -15.5, 3.1, 0, Math.PI * 2); ctx.fill();
      if (type === 'worker') {
        /* yellow hard hat with brim */
        ctx.fillStyle = '#f2c93c';
        ctx.beginPath(); ctx.arc(0, -16.3, 3.3, Math.PI, 0); ctx.fill();
        ctx.beginPath(); ctx.ellipse(0, -16.2, 4.6, 1.4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#d9ae1f';
        ctx.fillRect(-1, -19.3, 2, 3.2); // ridge
      } else {
        /* combat helmet in owner color */
        ctx.fillStyle = shade(pc.dark, 26);
        ctx.beginPath(); ctx.arc(0, -16, 3.6, Math.PI * 1.05, Math.PI * -0.05); ctx.fill();
        ctx.fillStyle = shade(pc.dark, 8);
        ctx.fillRect(-3.6, -16.2, 7.2, 1.5); // helmet rim
        if (type === 'rocket') {
          ctx.fillStyle = '#d8433a'; // goggle band
          ctx.fillRect(-3.1, -15.4, 6.2, 1.3);
        }
      }
      /* weapon */
      const wx = Math.cos(ang) * 9.5, wy = Math.sin(ang) * 4.8;
      if (type === 'worker') {
        ctx.strokeStyle = '#7a5a30'; ctx.lineWidth = 1.8; // wrench/tool
        ctx.beginPath(); ctx.moveTo(0, -9.5); ctx.lineTo(wx * 0.7, -9.5 + wy * 0.7); ctx.stroke();
        ctx.fillStyle = '#9aa2ab';
        ctx.beginPath(); ctx.arc(wx * 0.7, -9.5 + wy * 0.7, 1.6, 0, Math.PI * 2); ctx.fill();
      } else if (type === 'rocket') {
        /* launcher tube on the shoulder */
        ctx.strokeStyle = '#3c424a'; ctx.lineWidth = 3.4;
        ctx.beginPath(); ctx.moveTo(-wx * 0.45, -13 - wy * 0.45); ctx.lineTo(wx * 0.9, -13 + wy * 0.9); ctx.stroke();
        ctx.strokeStyle = '#c8503c'; ctx.lineWidth = 3.4; // warhead tip
        ctx.beginPath(); ctx.moveTo(wx * 0.78, -13 + wy * 0.78); ctx.lineTo(wx * 0.95, -13 + wy * 0.95); ctx.stroke();
      } else {
        /* rifle with stock */
        ctx.strokeStyle = '#23262b'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-wx * 0.25, -9.5 - wy * 0.25); ctx.lineTo(wx, -9.5 + wy); ctx.stroke();
        ctx.strokeStyle = '#6b4a2b'; ctx.lineWidth = 2.6;
        ctx.beginPath(); ctx.moveTo(-wx * 0.28, -9.5 - wy * 0.28); ctx.lineTo(-wx * 0.05, -9.5 - wy * 0.05); ctx.stroke();
      }
    } else if (type === 'tank' || type === 'artillery') {
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath(); ctx.ellipse(0, 2, 12, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.scale(1, 0.55);       // iso squash, then rotate in plane
      ctx.rotate(ang);
      const long = type === 'artillery';
      /* tracks */
      ctx.fillStyle = '#23262b';
      ctx.beginPath(); ctx.roundRect(-13, -10, long ? 24 : 26, 6, 2); ctx.fill();
      ctx.beginPath(); ctx.roundRect(-13, 4, long ? 24 : 26, 6, 2); ctx.fill();
      /* hull */
      ctx.fillStyle = shade(pc.main, -12);
      ctx.beginPath(); ctx.roundRect(-12, -7, long ? 20 : 24, 14, 3); ctx.fill();
      ctx.fillStyle = pc.main;
      ctx.beginPath(); ctx.roundRect(-9, -5, long ? 14 : 18, 10, 2); ctx.fill();
      /* turret + barrel */
      ctx.fillStyle = shade(pc.dark, 20);
      ctx.beginPath(); ctx.arc(long ? -3 : 1, 0, 5.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#2b2f35'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(long ? -3 : 1, 0); ctx.lineTo(long ? 22 : 17, 0); ctx.stroke();
      if (long) { // artillery recoil spade
        ctx.strokeStyle = shade(pc.dark, 0); ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(-12, -4); ctx.lineTo(-17, -6); ctx.moveTo(-12, 4); ctx.lineTo(-17, 6); ctx.stroke();
      }
    } else if (type === 'gunship') {
      /* drawn flying: shadow handled at render time */
      ctx.scale(1, 0.6);
      ctx.rotate(ang);
      ctx.fillStyle = shade(pc.main, -10);
      ctx.beginPath();
      ctx.moveTo(14, 0); ctx.quadraticCurveTo(6, -7, -8, -4.5);
      ctx.quadraticCurveTo(-15, 0, -8, 4.5); ctx.quadraticCurveTo(6, 7, 14, 0);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#20242a';
      ctx.beginPath(); ctx.ellipse(6, 0, 4.5, 3, 0, 0, Math.PI * 2); ctx.fill(); // canopy
      /* tail */
      ctx.fillStyle = pc.dark;
      ctx.fillRect(-16, -1.5, 9, 3);
      /* stub wings + rocket pods */
      ctx.fillStyle = pc.dark;
      ctx.fillRect(-2, -9, 7, 3.4); ctx.fillRect(-2, 5.6, 7, 3.4);
      /* rotor (two animation frames) */
      ctx.strokeStyle = 'rgba(220,228,238,0.85)'; ctx.lineWidth = 1.6;
      ctx.beginPath();
      if (frame) { ctx.moveTo(-14, 0); ctx.lineTo(18, 0); }
      else { ctx.moveTo(2, -15); ctx.lineTo(2, 15); }
      ctx.stroke();
      ctx.fillStyle = '#12151a';
      ctx.beginPath(); ctx.arc(2, 0, 1.8, 0, Math.PI * 2); ctx.fill();
    } else if (type === 'fighter') {
      ctx.scale(1, 0.6);
      ctx.rotate(ang);
      /* delta-wing jet */
      ctx.fillStyle = shade(pc.main, -6);
      ctx.beginPath();
      ctx.moveTo(16, 0);
      ctx.lineTo(0, -3); ctx.lineTo(-8, -12); ctx.lineTo(-11, -10.5); ctx.lineTo(-8, -2.5);
      ctx.lineTo(-13, -1.5); ctx.lineTo(-13, 1.5); ctx.lineTo(-8, 2.5);
      ctx.lineTo(-11, 10.5); ctx.lineTo(-8, 12); ctx.lineTo(0, 3);
      ctx.closePath(); ctx.fill();
      /* fuselage highlight + canopy */
      ctx.fillStyle = shade(pc.main, 20);
      ctx.beginPath(); ctx.ellipse(2, 0, 10, 2.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#20242a';
      ctx.beginPath(); ctx.ellipse(7, 0, 4, 2, 0, 0, Math.PI * 2); ctx.fill();
      /* tail fin + wingtip stripes */
      ctx.fillStyle = pc.light;
      ctx.fillRect(-13, -1.2, 2.5, 2.4);
      ctx.fillRect(-10.5, -12, 2, 2.5); ctx.fillRect(-10.5, 9.5, 2, 2.5);
      /* afterburner flicker */
      ctx.fillStyle = frame ? 'rgba(255,170,70,0.9)' : 'rgba(255,220,140,0.7)';
      ctx.beginPath();
      ctx.moveTo(-13.5, -1.2); ctx.lineTo(frame ? -19 : -17, 0); ctx.lineTo(-13.5, 1.2);
      ctx.closePath(); ctx.fill();
    } else if (type === 'bomber') {
      ctx.scale(1, 0.6);
      ctx.rotate(ang);
      /* broad twin-prop bomber */
      ctx.fillStyle = shade(pc.dark, 10);
      ctx.beginPath(); // wings
      ctx.moveTo(4, -1.5); ctx.lineTo(-2, -16); ctx.lineTo(-6.5, -16); ctx.lineTo(-6, -1.5);
      ctx.lineTo(-6, 1.5); ctx.lineTo(-6.5, 16); ctx.lineTo(-2, 16); ctx.lineTo(4, 1.5);
      ctx.closePath(); ctx.fill();
      /* fuselage */
      ctx.fillStyle = shade(pc.main, -4);
      ctx.beginPath(); ctx.ellipse(0, 0, 15, 3.6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = shade(pc.main, 18);
      ctx.beginPath(); ctx.ellipse(3, -0.8, 10, 1.6, 0, 0, Math.PI * 2); ctx.fill();
      /* nose glazing + tail */
      ctx.fillStyle = '#20242a';
      ctx.beginPath(); ctx.ellipse(12, 0, 3.4, 2.2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = pc.light;
      ctx.fillRect(-15.5, -4.5, 3, 9);
      /* engines + spinning props (2 frames) */
      ctx.fillStyle = '#2b2f35';
      ctx.beginPath(); ctx.ellipse(0, -9, 4, 2.2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(0, 9, 4, 2.2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(220,228,238,0.8)'; ctx.lineWidth = 1.4;
      for (const py of [-9, 9]) {
        ctx.beginPath();
        if (frame) { ctx.moveTo(4, py - 4); ctx.lineTo(4, py + 4); }
        else { ctx.moveTo(1, py); ctx.lineTo(7, py); }
        ctx.stroke();
      }
    }
    ctx.restore();
    return c;
  }

  function unit(type, ownerIdx, dir8, frame) {
    const key = 'u' + type + '_' + ownerIdx + '_' + dir8 + '_' + (frame || 0);
    return cache[key] || (cache[key] = buildUnit(type, ownerIdx, dir8, frame || 0));
  }

  function init() {
    art = new U.Mulberry32(1234567);
    /* pre-warm the most common sprites */
    for (const t in TILE_BASE) {
      for (let v = 0; v < 3; v++) tile(+t, v, 0);
    }
    tile(T.WATER, 0, 1); tile(T.WATER, 0, 2);
    tile(T.RIVER, 0, 1); tile(T.RIVER, 0, 2);
  }

  return {
    init: init, tile: tile, road: road, deposit: deposit, decor: decor,
    building: building, scaffold: scaffold, unit: unit,
    shade: shade, US: US
  };
})();
