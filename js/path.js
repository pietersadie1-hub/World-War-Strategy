/* ============ path.js — A* pathfinding over the tile grid ============ */
window.RTS = window.RTS || {};

RTS.path = (function () {
  'use strict';
  const U = RTS.util, C = RTS.config, T = C.T;

  const DIRS = [
    { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
    { x: 1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: 1 }, { x: -1, y: -1 }
  ];

  /* Ground-movement cost of entering tile (x,y). Infinity = blocked.
     ignoreBuildingId: a building the mover may overlap (its own construction site). */
  function tileCost(map, x, y, ignoreBuildingId) {
    const i = y * map.w + x;
    const occ = map.occupied[i];
    if (occ && occ !== (ignoreBuildingId | 0) + 1) return Infinity;
    if (map.road[i]) return C.ROAD_COST;              // road / bridge / dam crest
    return C.MOVE_COST[map.terrain[i]];
  }

  function passable(map, x, y, ignoreBuildingId) {
    return x >= 0 && y >= 0 && x < map.w && y < map.h &&
           tileCost(map, x, y, ignoreBuildingId) !== Infinity;
  }

  /* Generic A* over an arbitrary cost function — used by both unit movement
     and map-gen highway routing. costFn(x,y) returns entry cost (Infinity = wall). */
  function astarGeneric(w, h, costFn, sx, sy, tx, ty, maxExpand) {
    /* default must cover every cell — a cap below w*h makes legitimately
       reachable cross-map paths fail on maps with large blocked regions */
    maxExpand = maxExpand || (w * h + 16);
    if (sx === tx && sy === ty) return [];
    const size = w * h;
    const g = new Float64Array(size).fill(Infinity);
    const parent = new Int32Array(size).fill(-1);
    const closed = new Uint8Array(size);
    const si = sy * w + sx, ti = ty * w + tx;
    g[si] = 0;
    const heap = new U.Heap(function (n) { return n.f; });
    heap.push({ i: si, f: heuristic(sx, sy, tx, ty) });
    let expanded = 0;

    while (heap.size > 0 && expanded < maxExpand) {
      const node = heap.pop();
      const ci = node.i;
      if (closed[ci]) continue;
      closed[ci] = 1;
      expanded++;
      if (ci === ti) return reconstruct(parent, ci, w);
      const cx = ci % w, cy = (ci / w) | 0;
      for (let d = 0; d < 8; d++) {
        const nx = cx + DIRS[d].x, ny = cy + DIRS[d].y;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (closed[ni]) continue;
        let step = costFn(nx, ny);
        if (step === Infinity) continue;
        if (d >= 4) {
          /* diagonal: forbid corner cutting through blocked orthogonals */
          if (costFn(cx + DIRS[d].x, cy) === Infinity || costFn(cx, cy + DIRS[d].y) === Infinity) continue;
          step *= 1.4142;
        }
        const ng = g[ci] + step;
        if (ng < g[ni]) {
          g[ni] = ng;
          parent[ni] = ci;
          heap.push({ i: ni, f: ng + heuristic(nx, ny, tx, ty) });
        }
      }
    }
    return null;
  }

  function heuristic(x, y, tx, ty) {
    const dx = Math.abs(x - tx), dy = Math.abs(y - ty);
    return (dx + dy) * 0.6 + Math.max(dx, dy) * 0.4; // slightly weighted octile-ish
  }

  function reconstruct(parent, i, w) {
    const out = [];
    while (i >= 0) {
      out.push({ x: i % w, y: (i / w) | 0 });
      i = parent[i];
    }
    out.reverse();
    out.shift(); // drop the start tile
    return out;
  }

  /* Find nearest passable tile to (tx,ty) — spiral search. */
  function nearestPassable(map, tx, ty, ignoreBuildingId) {
    tx = U.clamp(Math.round(tx), 0, map.w - 1);
    ty = U.clamp(Math.round(ty), 0, map.h - 1);
    if (passable(map, tx, ty, ignoreBuildingId)) return { x: tx, y: ty };
    for (let r = 1; r < 14; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = tx + dx, y = ty + dy;
          if (passable(map, x, y, ignoreBuildingId)) return { x: x, y: y };
        }
      }
    }
    return null;
  }

  /* Unit path: A* + string-pulling smoothing. Returns array of waypoints in
     tile-center world coords, or null. Air units fly straight. */
  function findPath(map, sx, sy, tx, ty, air, ignoreBuildingId) {
    if (air) return [{ x: tx, y: ty }];
    const s = nearestPassable(map, sx, sy, ignoreBuildingId);
    const t = nearestPassable(map, tx, ty, ignoreBuildingId);
    if (!s || !t) return null;
    const pts = astarGeneric(map.w, map.h,
      function (x, y) { return tileCost(map, x, y, ignoreBuildingId); },
      s.x, s.y, t.x, t.y);
    if (!pts) return null;
    const path = smooth(map, { x: Math.round(sx), y: Math.round(sy) }, pts, ignoreBuildingId)
      .map(function (p) { return { x: p.x + 0.5, y: p.y + 0.5 }; });
    /* head to the exact click point if the final tile matches the request */
    if (path.length && Math.round(tx - 0.5) === t.x && Math.round(ty - 0.5) === t.y) {
      path[path.length - 1] = { x: tx, y: ty };
    }
    return path;
  }

  /* Line-of-sight tile walk (supercover-ish) */
  function losClear(map, ax, ay, bx, by, ignoreBuildingId) {
    let x0 = ax, y0 = ay;
    const dx = bx - ax, dy = by - ay;
    const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 3);
    for (let s = 1; s <= steps; s++) {
      const x = Math.round(ax + dx * s / steps), y = Math.round(ay + dy * s / steps);
      if (x === x0 && y === y0) continue;
      x0 = x; y0 = y;
      if (!passable(map, x, y, ignoreBuildingId)) return false;
    }
    return true;
  }

  function smooth(map, start, pts, ignoreBuildingId) {
    if (pts.length < 3) return pts;
    const out = [];
    let anchor = start, i = 0;
    while (i < pts.length) {
      let j = Math.min(i + 8, pts.length - 1); // look ahead a bounded window
      while (j > i && !losClear(map, anchor.x, anchor.y, pts[j].x, pts[j].y, ignoreBuildingId)) j--;
      out.push(pts[j]);
      anchor = pts[j];
      i = j + 1;
    }
    return out;
  }

  return {
    astarGeneric: astarGeneric,
    findPath: findPath,
    tileCost: tileCost,
    passable: passable,
    nearestPassable: nearestPassable,
    losClear: losClear
  };
})();
