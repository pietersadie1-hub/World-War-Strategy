# World War Strategy

A browser-based real-time strategy game built with plain HTML5 Canvas, CSS and JavaScript — no build step, no external assets (every sprite is generated procedurally at startup).

![genre](https://img.shields.io/badge/genre-RTS-blue) ![tech](https://img.shields.io/badge/tech-HTML5%20Canvas%20%2B%20Vanilla%20JS-green)

## Features

- **Isometric world (~30°)** — procedurally generated maps with rivers, forests, mountains, mineral fields, a neutral town with a road grid, and a highway with bridges linking the two start zones.
- **Ready-to-fight start** — both sides begin with a working base (HQ, Power Plant, Mine, Water Pump, Barracks, War Factory), 5 Engineers and 10 Rifle Squads, so the opening is about expanding and probing, not scrambling. Each difficulty guarantees a peace window before the AI's first assault (Easy: 5 min, Normal: ~3.5 min, Hard: ~2 min), and AI attacks come as escalating detachments rather than all-in blobs.
- **Base building** — HQ, Power Plants, Mineral Mines, Water Pumps, Barracks, War Factories, Airfields, Guard Turrets, and Hydro Dams (dams generate big energy *and* double as river crossings).
- **Resource management** — three stockpiles: **minerals ◆, energy ⚡, water 💧**, each with live income rates. Running out of energy slows production and turret fire.
- **Military production** — Engineers (hard hats included), Rifle Squads, Rocket Teams, Battle Tanks, Artillery, and a full air wing: Gunships, **Fighters** (interceptors with a big bonus vs aircraft) and **Strike Bombers** (dropped bombs with splash damage; ground targets only — as are artillery shells, so planes can only be shot down by direct-fire weapons and fighters).
- **Combat** — projectiles, splash damage, damage bonuses vs buildings/air, directional muzzle flashes, shockwaves, fire, dirt and debris, staged secondary explosions when buildings collapse, lasting scorch craters and smoldering tank wrecks, screen shake.
- **Battlefield intel** — a live blue-vs-red power-balance bar in the top HUD; click it for a full report (military power, units fielded, buildings, kills, structures razed and a verdict on how the war is going).
- **Command feel** — context-sensitive right-click (attack / capture / repair / assist-build / move) with a hovering hint that tells you what the click will do, colored order-confirmation pulses on the battlefield, and idle defenders that automatically converge on attackers shelling your base ("call for help").
- **Sound** — fully synthesized WebAudio effects (no audio files): gunfire, cannon and rocket shots, explosions scaled to blast size, order acknowledgements, unit-ready and construction-complete jingles, low-funds buzz and a base-under-attack klaxon with pulsing red minimap pings. Distance-attenuated, throttled in big battles, mutable via the ♪ button.
- **Attack readiness / stances** — Guard, Assault, Hold, plus Patrol routes and attack-move.
- **Strategic expansion** — pave roads (units move ~45 % faster on them), bridge rivers, dam rivers, and capture neutral town buildings with Engineers for bonus income.
- **Fog of war** — unexplored black, explored-but-unseen dimmed, live vision from your units and buildings. Fog weather reduces sight range.
- **Pathfinding** — A* over terrain costs (roads cheap, forests/hills slow, water/mountains blocked) with string-pulling smoothing and soft unit separation.
- **Day/night cycle & weather** — dusk glow, night darkness with building lights, rain and rolling fog.
- **Player vs AI** — three difficulties; the AI expands, builds an economy, defends, captures the town, and launches scaling assault waves.
- **Multiplayer (beta)** — deterministic lockstep-lite over WebSockets with a tiny Node relay server.
- **Save/Load** — full game state persisted to `localStorage` (F5 / F9 quick save & load).
- **Desktop & mobile** — mouse + keyboard on desktop; tap, drag-pan, pinch-zoom and long-press attack-move on touch screens.

## Run it

It's a static site — serve the folder and open it:

```bash
# any static server works
npx serve .
# or
python3 -m http.server 8080
```

Then open http://localhost:8080 (or the printed URL) in a modern browser.

## Multiplayer (beta)

1. Start the relay server (requires Node.js):

   ```bash
   npm install ws
   node server/server.js          # listens on ws://0.0.0.0:8765
   ```

2. Both players open the game, click **Multiplayer (beta)**, enter the same server address (`ws://<host>:8765`) and the same room code, and click **Join / Host**. The match starts automatically when the second player joins.

Both clients run the same fixed-step simulation from a shared seed; only commands travel over the wire.

## Controls

| Input | Action |
|---|---|
| Left click / drag | Select unit(s) |
| Double-click unit | Select all of that type on screen |
| Right click | Context order: move / attack / capture / repair / set rally |
| Mouse wheel, pinch | Zoom |
| Arrow keys / W, edge pan, middle-mouse drag, drag (touch) | Pan camera |
| **A** | Attack-move mode |
| **P** | Patrol mode |
| **S** | Stop |
| **G / F / H** | Guard / Assault / Hold stance |
| **Ctrl+1–9 / 1–9** | Assign / select control groups (double-press to center) |
| **F5 / F9** | Quick save / quick load |
| **Esc** | Cancel mode → deselect → pause |
| Long-press (touch) | Attack-move |

## Project structure

```
index.html          page shell + HUD + menus
css/style.css       responsive UI styling
js/util.js          seeded RNG, value noise, binary heap, helpers
js/config.js        all game data & balance (tiles, buildings, units, economy)
js/map.js           procedural map generation (rivers, town, highway, decor)
js/path.js          A* pathfinding + smoothing
js/sprites.js       procedural sprite atlas (tiles, roads, buildings, units)
js/entities.js      unit/building behaviour, combat, projectiles
js/game.js          simulation core, command bus, fog, weather, victory
js/ai.js            computer opponent
js/save.js          localStorage save/load
js/net.js           WebSocket lockstep client (beta)
js/render.js        isometric renderer, particles, lighting, weather FX
js/ui.js            HUD, minimap, build menu, selection panel
js/input.js         mouse / keyboard / touch controls
js/main.js          bootstrap + fixed-step game loop
server/server.js    Node WebSocket relay for multiplayer
```

The simulation runs at a fixed 20 Hz inside a `requestAnimationFrame` loop with render interpolation; every player intent (human, AI or network) flows through one command bus, which is what makes the multiplayer lockstep possible.

## Notes

- The AI has full map vision (a common RTS AI simplification); the human player plays under fog of war.
- Multiplayer is labelled beta: it relies on both clients simulating deterministically and has no resync/reconnect yet.
