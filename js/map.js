/* ============ map.js — procedural world generation ============
   Terrain, rivers, forests, mountains, mineral fields, a neutral town
   with a road grid, and highway + bridges linking the two start zones. */
window.RTS = window.RTS || {};

RTS.map = (function () {
  'use strict';
  const U = RTS.util, C = RTS.config, T = C.T;

  function idx(map, x, y) { return y * map.w + x; }
  function inBounds(map, x, y) { return x >= 0 && y >= 0 && x < map.w && y < map.h; }

  function isWaterTile(t) { return t === T.WATER || t === T.RIVER; }

  function generate(seed) {
    const rng = new U.Mulberry32(seed);
    const w = C.MAP_W, h = C.MAP_H;
    const map = {
      w: w, h: h,
      terrain: new Uint8Array(w * h),
      road: new Uint8Array(w * h),      // 0 none, 1 road, 2 bridge, 3 dam crest
      deposit: new Uint8Array(w * h),   // mineral field flags
      occupied: new Int32Array(w * h),  // building id + 1 (0 = free), managed by game
      decor: [],                        // trees / rocks / bushes
      decorAt: {}                       // tileKey -> [decor indices]
    };

    const heightN = U.makeNoise(rng);
    const moistN = U.makeNoise(rng);

    /* --- base terrain from fbm noise --- */
    const elev = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const nx = x / w * 7, ny = y / h * 7;
        let e = heightN.fbm(nx, ny, 5, 2.05, 0.5);
        /* raise the corners a little so start zones aren't underwater */
        const cx = Math.min(U.dist(x, y, 10, 10), U.dist(x, y, w - 11, h - 11));
        if (cx < 16) e = Math.max(e, 0.46);
        elev[idx(map, x, y)] = e;
        const m = moistN.fbm(nx + 40, ny + 40, 4);
        let t;
        if (e < 0.335) t = T.WATER;
        else if (e < 0.365) t = T.SAND;
        else if (e > 0.78) t = T.MOUNTAIN;
        else if (e > 0.665) t = T.HILL;
        else t = (m > 0.585 && e > 0.4) ? T.FOREST : T.GRASS;
        map.terrain[idx(map, x, y)] = t;
      }
    }

    /* --- river: meanders from north edge to south edge --- */
    carveRiver(map, rng, elev);
    if (rng.next() < 0.6) carveRiver(map, rng, elev); // sometimes a tributary

    /* --- start zones: opposite corners, nudged off rivers/mountains, flattened --- */
    const starts = [findStartZone(map, 12, 12), findStartZone(map, w - 13, h - 13)];
    for (const s of starts) clearZone(map, s.x, s.y, 8);

    /* --- mineral fields --- */
    placeDeposits(map, rng, starts);

    /* --- neutral town near the middle --- */
    const town = buildTown(map, rng);

    /* --- highway connecting both starts through the town (creates bridges) --- */
    buildHighway(map, starts[0], town.center, rng);
    buildHighway(map, town.center, starts[1], rng);

    /* --- decor: trees, rocks, bushes --- */
    placeDecor(map, rng);

    return { map: map, starts: starts, townBuildings: town.buildings };
  }

  function carveRiver(map, rng, elev) {
    const w = map.w, h = map.h;
    let x = rng.int(Math.floor(w * 0.3), Math.floor(w * 0.7));
    let drift = 0;
    for (let y = 0; y < h; y++) {
      drift += rng.range(-0.9, 0.9);
      drift = U.clamp(drift, -2.2, 2.2);
      x = U.clamp(Math.round(x + drift * 0.55), 4, w - 5);
      const width = 1 + (Math.floor(y / 24) % 2); // gently varying width
      for (let dx = -width; dx <= width; dx++) {
        const xx = x + dx;
        if (!inBounds(map, xx, y)) continue;
        const i = idx(map, xx, y);
        if (Math.abs(dx) <= width - 1 || rng.next() < 0.6) {
          if (map.terrain[i] !== T.WATER) map.terrain[i] = T.RIVER;
        } else if (map.terrain[i] !== T.WATER && map.terrain[i] !== T.RIVER) {
          map.terrain[i] = T.SAND; // banks
        }
      }
    }
  }

  /* nearest spot to (px,py) whose 9x9 neighborhood is free of water & mountains */
  function findStartZone(map, px, py) {
    for (let r = 0; r < 26; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const cx = px + dx, cy = py + dy;
          if (cx < 6 || cy < 6 || cx >= map.w - 6 || cy >= map.h - 6) continue;
          let ok = true;
          for (let y = cy - 4; y <= cy + 4 && ok; y++) {
            for (let x = cx - 4; x <= cx + 4 && ok; x++) {
              const t = map.terrain[idx(map, x, y)];
              if (t === T.WATER || t === T.RIVER || t === T.MOUNTAIN) ok = false;
            }
          }
          if (ok) return { x: cx, y: cy };
        }
      }
    }
    return { x: px, y: py };
  }

  function clearZone(map, cx, cy, r) {
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (!inBounds(map, x, y)) continue;
        if (U.dist(x, y, cx, cy) > r) continue;
        const i = idx(map, x, y);
        const t = map.terrain[i];
        if (t !== T.WATER && t !== T.RIVER) map.terrain[i] = T.GRASS;
      }
    }
  }

  function placeDeposits(map, rng, starts) {
    const clusters = [];
    /* guaranteed fields near each start */
    for (const s of starts) {
      clusters.push({ x: s.x + rng.int(-6, 6), y: s.y + rng.int(4, 7), n: 6 });
      clusters.push({ x: s.x + rng.int(4, 7), y: s.y + rng.int(-6, 6), n: 5 });
    }
    for (let k = 0; k < 11; k++) {
      clusters.push({ x: rng.int(8, map.w - 9), y: rng.int(8, map.h - 9), n: rng.int(4, 7) });
    }
    for (const c of clusters) {
      let placed = 0, tries = 0;
      while (placed < c.n && tries++ < 60) {
        const x = U.clamp(c.x + rng.int(-3, 3), 1, map.w - 2);
        const y = U.clamp(c.y + rng.int(-3, 3), 1, map.h - 2);
        const i = idx(map, x, y);
        const t = map.terrain[i];
        if ((t === T.GRASS || t === T.HILL || t === T.SAND) && !map.deposit[i]) {
          map.deposit[i] = 1;
          if (t === T.FOREST) map.terrain[i] = T.GRASS;
          placed++;
        }
      }
    }
  }

  function buildTown(map, rng) {
    /* find a flat-ish grass area near map center */
    const w = map.w, h = map.h;
    let best = { x: w >> 1, y: h >> 1, score: -1 };
    for (let a = 0; a < 40; a++) {
      const cx = rng.int(w * 0.32 | 0, w * 0.68 | 0), cy = rng.int(h * 0.32 | 0, h * 0.68 | 0);
      let score = 0;
      for (let y = cy - 6; y <= cy + 6; y++) {
        for (let x = cx - 7; x <= cx + 7; x++) {
          if (!inBounds(map, x, y)) continue;
          const t = map.terrain[idx(map, x, y)];
          if (t === T.GRASS || t === T.SAND) score++;
          else if (t === T.RIVER) score += 0.4; // river towns are nice
          else if (t === T.MOUNTAIN) score -= 3;
        }
      }
      if (score > best.score) best = { x: cx, y: cy, score: score };
    }
    const cx = best.x, cy = best.y;
    const buildings = [];

    /* road grid */
    for (let gx = -6; gx <= 6; gx += 3) {
      for (let y = cy - 5; y <= cy + 5; y++) layRoadTile(map, cx + gx, y);
    }
    for (let gy = -5; gy <= 5; gy += 5) {
      for (let x = cx - 6; x <= cx + 6; x++) layRoadTile(map, x, cy + gy);
    }

    /* houses along the roads */
    for (let y = cy - 5; y <= cy + 5; y++) {
      for (let x = cx - 6; x <= cx + 6; x++) {
        if (!inBounds(map, x, y)) continue;
        const i = idx(map, x, y);
        if (map.road[i]) continue;
        const t = map.terrain[i];
        if (t !== T.GRASS && t !== T.SAND) continue;
        if (!nextToRoad(map, x, y)) continue;
        if (rng.next() < 0.42) {
          if (t === T.FOREST) map.terrain[i] = T.GRASS;
          buildings.push({ type: 'house', gx: x, gy: y });
        }
      }
    }
    /* one supply depot near the center */
    outer:
    for (let r = 1; r < 5; r++) {
      for (let y = cy - r; y <= cy + r; y++) {
        for (let x = cx - r; x <= cx + r; x++) {
          if (canPlaceRect(map, x, y, 2, 2, buildings)) {
            buildings.push({ type: 'depot', gx: x, gy: y });
            break outer;
          }
        }
      }
    }
    return { center: { x: cx, y: cy }, buildings: buildings };
  }

  function canPlaceRect(map, gx, gy, bw, bh, pending) {
    for (let y = gy; y < gy + bh; y++) {
      for (let x = gx; x < gx + bw; x++) {
        if (!inBounds(map, x, y)) return false;
        const i = idx(map, x, y);
        const t = map.terrain[i];
        if (t !== T.GRASS && t !== T.SAND) return false;
        if (map.road[i] || map.deposit[i]) return false;
      }
    }
    for (const b of pending) {
      const d = RTS.config.BUILDINGS[b.type];
      if (gx < b.gx + d.w && gx + bw > b.gx && gy < b.gy + d.h && gy + bh > b.gy) return false;
    }
    return true;
  }

  function nextToRoad(map, x, y) {
    return (inBounds(map, x + 1, y) && map.road[idx(map, x + 1, y)]) ||
           (inBounds(map, x - 1, y) && map.road[idx(map, x - 1, y)]) ||
           (inBounds(map, x, y + 1) && map.road[idx(map, x, y + 1)]) ||
           (inBounds(map, x, y - 1) && map.road[idx(map, x, y - 1)]);
  }

  function layRoadTile(map, x, y) {
    if (!inBounds(map, x, y)) return;
    const i = idx(map, x, y);
    const t = map.terrain[i];
    if (t === T.MOUNTAIN) return;
    if (t === T.WATER || t === T.RIVER) { map.road[i] = 2; return; } // bridge
    if (t === T.FOREST) map.terrain[i] = T.GRASS;
    map.road[i] = 1;
  }

  /* A* a highway between two points; river tiles become bridges (few, since
     crossing is expensive in the cost function). */
  function buildHighway(map, from, to, rng) {
    const w = map.w, h = map.h;
    const costFn = function (x, y) {
      const i = idx(map, x, y);
      const t = map.terrain[i];
      if (t === T.MOUNTAIN) return 60;
      if (t === T.WATER) return 45;
      if (t === T.RIVER) return 22;
      if (map.road[i]) return 0.4;
      if (t === T.FOREST) return 3;
      if (t === T.HILL) return 4;
      return 1;
    };
    const pts = RTS.path.astarGeneric(w, h, costFn, from.x, from.y, to.x, to.y, 40000);
    if (!pts) return;
    function lay(x, y) {
      const i = idx(map, x, y);
      if (map.terrain[i] === T.MOUNTAIN) map.terrain[i] = T.HILL;
      layRoadTile(map, x, y);
    }
    let prev = from;
    for (const p of pts) {
      /* 4-connect diagonal steps so units (which cannot cut corners past
         blocked tiles) can always follow the highway, including bridges */
      if (Math.abs(p.x - prev.x) === 1 && Math.abs(p.y - prev.y) === 1) {
        lay(p.x, prev.y);
      }
      lay(p.x, p.y);
      prev = p;
    }
  }

  function placeDecor(map, rng) {
    for (let y = 0; y < map.h; y++) {
      for (let x = 0; x < map.w; x++) {
        const i = idx(map, x, y);
        if (map.road[i] || map.deposit[i]) continue;
        const t = map.terrain[i];
        let d = null;
        if (t === T.FOREST) {
          const n = rng.int(1, 2);
          for (let k = 0; k < n; k++) {
            addDecor(map, x, y, rng.next() < 0.45 ? 'pine' : 'tree', rng);
          }
          continue;
        } else if (t === T.MOUNTAIN) d = 'peak';
        else if (t === T.HILL && rng.next() < 0.3) d = 'rock';
        else if (t === T.GRASS && rng.next() < 0.045) d = rng.next() < 0.6 ? 'bush' : 'tree';
        else if (t === T.SAND && rng.next() < 0.03) d = 'rock';
        if (d) addDecor(map, x, y, d, rng);
      }
    }
  }

  function addDecor(map, x, y, type, rng) {
    const item = {
      gx: x, gy: y, type: type,
      ox: rng.range(-0.3, 0.3), oy: rng.range(-0.3, 0.3),
      s: rng.range(0.85, 1.25)
    };
    const k = y * map.w + x;
    map.decor.push(item);
    (map.decorAt[k] = map.decorAt[k] || []).push(item);
  }

  /* remove trees/rocks under a new building footprint */
  function clearDecorRect(map, gx, gy, bw, bh) {
    for (let y = gy; y < gy + bh; y++) {
      for (let x = gx; x < gx + bw; x++) {
        const k = y * map.w + x;
        const list = map.decorAt[k];
        if (!list) continue;
        for (const item of list) item.dead = true;
        delete map.decorAt[k];
      }
    }
    map.decor = map.decor.filter(function (d) { return !d.dead; });
  }

  return {
    generate: generate,
    idx: idx, inBounds: inBounds, isWaterTile: isWaterTile,
    clearDecorRect: clearDecorRect, layRoadTile: layRoadTile
  };
})();
