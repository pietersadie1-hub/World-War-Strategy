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

  /* extruded iso prism with top face + two visible walls */
  function isoBox(ctx, ox, oy, gx, gy, gw, gh, ht, col) {
    const A = isoPt(gx, gy), B = isoPt(gx + gw, gy), Cp = isoPt(gx + gw, gy + gh), D = isoPt(gx, gy + gh);
    function P(p, up) { return { x: ox + p.x, y: oy + p.y - (up ? ht : 0) }; }
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
    return { A1: A1, B1: B1, C1: C1, D1: D1, C0: C0 };
  }

  function ownerCol(ownerIdx) {
    if (ownerIdx < 0 || ownerIdx > 1) return C.NEUTRAL_COLOR;
    return C.PLAYER_COLORS[ownerIdx];
  }

  function buildBuilding(type, ownerIdx) {
    const def = C.BUILDINGS[type];
    const pc = ownerCol(ownerIdx);
    const w = def.w, h = def.h;
    const pad = 8, roomTop = 78;
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
        isoBox(ctx, b.x, b.y, 0.15, 0.15, 2.7, 2.7, 30, '#5a6068');
        isoBox(ctx, b.x, b.y, 0.55, 0.55, 1.9, 1.9, 52, M);
        isoBox(ctx, b.x, b.y, 1.0, 1.0, 1.0, 1.0, 70, shade('#5a6068', 15));
        /* antenna */
        const tp = isoPt(1.5, 1.5);
        ctx.strokeStyle = '#d6dbe2'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(b.x + tp.x, b.y + tp.y - 70); ctx.lineTo(b.x + tp.x, b.y + tp.y - 96); ctx.stroke();
        ctx.fillStyle = pc.light;
        ctx.beginPath(); ctx.arc(b.x + tp.x, b.y + tp.y - 96, 3, 0, Math.PI * 2); ctx.fill();
        /* banner stripe */
        ctx.fillStyle = pc.light;
        const s1 = isoPt(0.55, 2.45), s2 = isoPt(2.45, 2.45);
        ctx.fillRect(b.x + s1.x - 2, b.y + s1.y - 46, 4, 14);
        break;
      }
      case 'power': {
        isoBox(ctx, b.x, b.y, 0.1, 0.1, 1.8, 1.8, 20, '#565c64');
        /* twin cooling stacks */
        for (const p of [[0.6, 0.6], [1.35, 1.35]]) {
          const pt = isoPt(p[0], p[1]);
          const px = b.x + pt.x, py = b.y + pt.y - 20;
          ctx.fillStyle = shade('#8d939c', p[0] > 1 ? -18 : 0);
          ctx.beginPath();
          ctx.moveTo(px - 10, py); ctx.lineTo(px - 7, py - 34); ctx.lineTo(px + 7, py - 34); ctx.lineTo(px + 10, py);
          ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#3a3f46';
          ctx.beginPath(); ctx.ellipse(px, py - 34, 7, 2.6, 0, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = M;
        const lp = isoPt(0.95, 1.7);
        ctx.fillRect(b.x + lp.x - 8, b.y + lp.y - 14, 16, 5); // painted band
        break;
      }
      case 'mine': {
        isoBox(ctx, b.x, b.y, 0.1, 0.1, 1.8, 1.1, 22, '#6b6046');
        /* headframe tower */
        const tp = isoPt(1.35, 1.4);
        const px = b.x + tp.x, py = b.y + tp.y;
        ctx.strokeStyle = '#4a4436'; ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(px - 12, py); ctx.lineTo(px, py - 44);
        ctx.moveTo(px + 12, py); ctx.lineTo(px, py - 44);
        ctx.moveTo(px - 7, py - 18); ctx.lineTo(px + 7, py - 18);
        ctx.stroke();
        ctx.fillStyle = M;
        ctx.beginPath(); ctx.arc(px, py - 44, 5.5, 0, Math.PI * 2); ctx.fill();
        /* conveyor + ore pile */
        ctx.fillStyle = '#8fa3c0';
        const op = isoPt(0.5, 1.6);
        ctx.beginPath(); ctx.ellipse(b.x + op.x, b.y + op.y, 9, 4.5, 0, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'pump': {
        isoBox(ctx, b.x, b.y, 0.1, 0.1, 1.2, 1.8, 18, '#4f6a76');
        /* water tank */
        const tp = isoPt(1.35, 0.8);
        const px = b.x + tp.x, py = b.y + tp.y;
        ctx.fillStyle = shade('#5a91b8', 0);
        ctx.beginPath(); ctx.rect(px - 10, py - 40, 20, 30); ctx.fill();
        ctx.fillStyle = '#3f6a8c';
        ctx.beginPath(); ctx.ellipse(px, py - 10, 10, 3.6, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#78aacc';
        ctx.beginPath(); ctx.ellipse(px, py - 40, 10, 3.6, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = M;
        ctx.fillRect(px - 10, py - 28, 20, 4);
        /* intake pipe */
        ctx.strokeStyle = '#3c4d57'; ctx.lineWidth = 4;
        const pp = isoPt(0.4, 1.85);
        ctx.beginPath(); ctx.moveTo(px - 6, py - 6); ctx.lineTo(b.x + pp.x, b.y + pp.y + 4); ctx.stroke();
        break;
      }
      case 'dam': {
        /* concrete wall across the tile */
        isoBox(ctx, b.x, b.y, 0, 0.55, 2, 0.9, 42, '#a8adb5');
        /* spillway */
        const s1 = isoPt(0.6, 1.0), s2 = isoPt(1.4, 1.0);
        ctx.fillStyle = 'rgba(150,205,240,0.85)';
        ctx.beginPath();
        ctx.moveTo(b.x + s1.x, b.y + s1.y - 34);
        ctx.lineTo(b.x + s2.x, b.y + s2.y - 34);
        ctx.lineTo(b.x + s2.x + 4, b.y + s2.y + 12);
        ctx.lineTo(b.x + s1.x - 4, b.y + s1.y + 12);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.5;
        for (let k = 0; k < 3; k++) {
          ctx.beginPath();
          ctx.moveTo(b.x + s1.x + k * 8, b.y + s1.y - 30 + k * 2);
          ctx.lineTo(b.x + s1.x + k * 8 - 2, b.y + s1.y + 10);
          ctx.stroke();
        }
        /* crest railing + owner band */
        ctx.fillStyle = M;
        const c1 = isoPt(0.15, 0.75);
        ctx.fillRect(b.x + c1.x, b.y + c1.y - 46, 10, 4);
        break;
      }
      case 'barracks': {
        isoBox(ctx, b.x, b.y, 0.1, 0.1, 1.8, 1.8, 24, shade(M, -25));
        /* pitched roof look: lighter top stripe */
        isoBox(ctx, b.x, b.y, 0.35, 0.35, 1.3, 1.3, 34, '#6a7078');
        ctx.fillStyle = pc.light;
        const fp = isoPt(0.9, 1.85);
        ctx.fillRect(b.x + fp.x - 1.5, b.y + fp.y - 40, 3, 16); // flag pole
        ctx.beginPath();
        ctx.moveTo(b.x + fp.x + 1.5, b.y + fp.y - 40);
        ctx.lineTo(b.x + fp.x + 13, b.y + fp.y - 36);
        ctx.lineTo(b.x + fp.x + 1.5, b.y + fp.y - 31);
        ctx.closePath();
        ctx.fillStyle = M; ctx.fill();
        break;
      }
      case 'factory': {
        isoBox(ctx, b.x, b.y, 0.1, 0.1, 2.8, 1.8, 30, '#5d636c');
        isoBox(ctx, b.x, b.y, 0.3, 0.3, 1.2, 1.2, 44, shade(M, -10));
        /* chimney */
        const cp = isoPt(2.35, 0.6);
        ctx.fillStyle = '#464c55';
        ctx.fillRect(b.x + cp.x - 5, b.y + cp.y - 66, 10, 40);
        ctx.fillStyle = '#33383f';
        ctx.beginPath(); ctx.ellipse(b.x + cp.x, b.y + cp.y - 66, 5, 2, 0, 0, Math.PI * 2); ctx.fill();
        /* big rolling door */
        const dp = isoPt(1.5, 1.85);
        ctx.fillStyle = '#31353c';
        ctx.beginPath();
        ctx.moveTo(b.x + dp.x - 14, b.y + dp.y - 6);
        ctx.lineTo(b.x + dp.x + 2, b.y + dp.y + 2);
        ctx.lineTo(b.x + dp.x + 2, b.y + dp.y - 22);
        ctx.lineTo(b.x + dp.x - 14, b.y + dp.y - 28);
        ctx.closePath(); ctx.fill();
        break;
      }
      case 'airfield': {
        isoBox(ctx, b.x, b.y, 0.1, 0.1, 2.8, 1.8, 6, '#4e535b');
        /* hangar arch */
        const hp = isoPt(0.8, 0.9);
        ctx.fillStyle = shade(M, -18);
        ctx.beginPath();
        ctx.ellipse(b.x + hp.x, b.y + hp.y - 6, 22, 26, 0, Math.PI, 0);
        ctx.fill();
        ctx.fillStyle = '#2c3037';
        ctx.beginPath();
        ctx.ellipse(b.x + hp.x + 8, b.y + hp.y - 2, 12, 16, 0, Math.PI, 0);
        ctx.fill();
        /* landing pad circle */
        const lp = isoPt(2.1, 1.25);
        ctx.strokeStyle = '#c9cfd8'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(b.x + lp.x, b.y + lp.y - 6, 16, 8, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#c9cfd8'; ctx.font = 'bold 9px sans-serif';
        ctx.fillText('H', b.x + lp.x - 3, b.y + lp.y - 3);
        break;
      }
      case 'turret': {
        isoBox(ctx, b.x, b.y, 0.12, 0.12, 0.76, 0.76, 14, '#5a6068');
        const tp = isoPt(0.5, 0.5);
        const px = b.x + tp.x, py = b.y + tp.y - 14;
        ctx.fillStyle = shade(M, -8);
        ctx.beginPath(); ctx.arc(px, py - 4, 8.5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#2f333a'; ctx.lineWidth = 3.4;
        ctx.beginPath(); ctx.moveTo(px, py - 5); ctx.lineTo(px + 14, py - 11); ctx.stroke();
        break;
      }
      case 'house': {
        isoBox(ctx, b.x, b.y, 0.12, 0.12, 0.76, 0.76, 16, '#8d8579');
        /* roof */
        const r0 = isoPt(0.12, 0.12), r1 = isoPt(0.88, 0.12), r2 = isoPt(0.88, 0.88), r3 = isoPt(0.12, 0.88);
        const rc = isoPt(0.5, 0.5);
        ctx.beginPath();
        ctx.moveTo(b.x + r3.x, b.y + r3.y - 16);
        ctx.lineTo(b.x + rc.x, b.y + rc.y - 27);
        ctx.lineTo(b.x + r2.x, b.y + r2.y - 16);
        ctx.closePath();
        ctx.fillStyle = '#a05a45'; ctx.fill();
        ctx.beginPath();
        ctx.moveTo(b.x + r2.x, b.y + r2.y - 16);
        ctx.lineTo(b.x + rc.x, b.y + rc.y - 27);
        ctx.lineTo(b.x + r1.x, b.y + r1.y - 16);
        ctx.closePath();
        ctx.fillStyle = '#7c4231'; ctx.fill();
        /* window (lit at night via render glow) */
        ctx.fillStyle = '#e8d9a0';
        const wp = isoPt(0.72, 0.72);
        ctx.fillRect(b.x + wp.x - 2, b.y + wp.y - 12, 4, 4);
        break;
      }
      case 'depot': {
        isoBox(ctx, b.x, b.y, 0.1, 0.1, 1.8, 1.8, 22, '#7d7466');
        isoBox(ctx, b.x, b.y, 0.35, 0.35, 1.3, 1.3, 30, '#8d8478');
        /* crates */
        isoBox(ctx, b.x, b.y, 1.55, 0.15, 0.35, 0.35, 8, '#9a7b4f');
        isoBox(ctx, b.x, b.y, 0.15, 1.55, 0.35, 0.35, 8, '#8a6d45');
        break;
      }
    }
    return { c: c, ax: ax, ay: ay };
  }

  function building(type, ownerIdx) {
    const oi = (ownerIdx === 0 || ownerIdx === 1) ? ownerIdx : 2;
    const key = 'b' + type + '_' + oi;
    return cache[key] || (cache[key] = buildBuilding(type, ownerIdx));
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
