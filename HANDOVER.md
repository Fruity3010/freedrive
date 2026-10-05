# Free Drive Lagos: handover for the next session

Last updated 2026-10-05. Read this before touching the code.

## State of the repo (check first)

- Branch `feature/lagos-delivery`. **All Lagos work is uncommitted** (about 36 paths: every new `src/*.js`, `static/models/*`, `static/textures/*`). Commit before anything risky.
- Malware fix (payload in `vite.config.js`) is committed on local `main` as `890f502` and on `fix/remove-vite-config-malware`. **Not pushed.** `origin/main` (Fruity3010/freedrive) is still infected. The user hasn't answered offers to push or commit, so ask before pushing.
- `dist/` is tracked in git and gets rewritten by `npx vite build`. Undecided whether to keep tracking it.

## Run and test

- `npm install && npm run dev` serves http://localhost:5173 (root `src/`, assets from `static/`). Check `npx vite build --logLevel error` after edits.
- Controls: WASD or arrows, M map, R reset/repair, 1/2 to settle or face the mob.
- Debug hook: `window.game = { scene, car, bike, camera, renderer, drive, keys, traffic, people, zombies, debris, step, places, peopleSlots, mob, isDrivable }`.
- Browser testing via Chrome MCP:
  - Background tabs pause `requestAnimationFrame`, so drive the game with `game.step(1/60)` in loops.
  - JS calls time out at 45 s, so step in chunks of ~60 frames.
  - The first frame after load can take ~2 s (shader compile).
  - The game loop overwrites the camera every frame.
  - Screenshots sometimes time out when the tab is busy or hidden.
- Wallet lives in `localStorage['freedrive-naira']`. Reset it to 15000 if tests drain it.

## User preferences (follow these)

- **Plan first** for big features; user says when to implement.
- **Removed on purpose:** sound (`sound.js`), LASTMA (`lastma.js`), keke, conductors. The code stays in the repo, unhooked.
- Hawkers shout in speech bubbles but **never sell to the player**.
- Moped feel: slow acceleration, top speed 16 m/s.
- Optimise hard: "only render what the user sees".
- The mob is called **Egbon Adugbo**. Area boys and touts are the main mix, with some zombies.
- **Code style:**
  - Match the existing style: short comments that explain why, named constants at the top of each module.
  - Do edits with Python exact-match replacement or the Edit tool. **Don't use `sed` for code edits**: one corrupted `index.js` earlier.

## Architecture

| File | Owns |
|---|---|
| `src/index.js` | Game loop `step()`, bike physics (`moveStep` substeps, `canRide`, `groundAt`, suspension), crashes and wreck, hospital, mob rating and settle dialog, HUD, credits |
| `src/world.js` | Map generation and collision: districts, roads and markings, bridge, footbridges, markets and stalls, places, police, hawker and walker routes, potholes, trash. Exports `isDrivable`, `groundHeight`, `roadHeight`, `footbridgeSurface`, `railHit`, `stallHit`, `places`, `peopleSlots`, `trash`, `potholes`, `parkedSlots` |
| `src/traffic.js` | Road graph, lanes, lights, turn planning, danfo stops and boarding, seated passengers, LOD, OBB collisions |
| `src/people.js` | Pedestrian pool (8 per type × 6 types, nearest within 90 m), sidestep, knockdown and anger, wheelbarrows, hawker trays and bubbles |
| `src/zombies.js` | Mob: touts (`casual.glb` recoloured, caps, weapons via `attachToBone`) and zombies (`zombie_number_10_animated_gltf/Untitled.glb`) |
| `src/animals.js` | Chickens (procedural) and goats (`static/models/props/goat.glb`, static mesh): wander, peck/graze, flee the bike; instanced |
| `src/seated.js` | Bakes a sitting pose into static geometry for bus passengers |
| `src/props.js` | `loadProp` (merge per material, normalise size) and `placeProps` (instanced, range-culled) |
| `src/environment.js`, `src/debris.js`, `src/boats.js` | Sky and water; stall debris; canoes and yachts |
| `src/zombieGame.js` (+ `GameManager.js`, `car.js`, `road.js`, `pedestran.js`, `script.js`, `utils.js`) | Original zombie game, unused |

### Key facts

- **Coordinates:**
  - MAINLAND x −690..−150; ISLAND x 450..870; z −240..240.
  - Grid STEP 60, ROAD 20, KERB 0.2. SPAWN (−210, 0).
  - Bridge height 18 m, ramp 100 m.
- **Performance tricks:**
  - Static scenery merged per material per 250 m chunk.
  - Objects under 6 m go on `DYNAMIC_LAYER` (1) so the water reflection skips them.
  - Instanced meshes with `frustumCulled = false` plus our own distance culling.
- **Heights:** compare the bike height against `groundHeight(x, z)`, never 0. Comparing against 0 made the bridge unclimbable once.
- **Models:**
  - GLTFLoader strips dots from bone names (`UpperLeg.L` becomes `UpperLegL`).
  - Quaternius characters face +z, and their walk has root drift. Attach carried props to a bone (Head or Hips).
- **Bike:**
  - Wheels are pivots in `bikeWheels`.
  - `barsPivot` steers the model's `Controls` node together with the front wheel.
  - `bike.rotation.z` is the lean.
- **Density now:** 140 Mainland walkers, 70 Mainland hawkers, traffic 40 bridge + 100 city + 70 Mainland-only (cap 260). Last measured near Yaba Market: ~710 draw calls, 2.6M triangles, ~50 ms per frame in a test tab. Re-measure.

## Open items

1. Commit the branch; push the `main` malware fix (ask first).
2. **Unverified on screen:** tout caps and weapons placement; goat size, facing and no glow; frame time after the density bump.
3. **Flashy Island cars:** waiting on the user to download Sketchfab models:
   - G-Class `3782846f37314e9aa4078e072824ccd3`
   - Cullinan `61f16a1d5be2403abcdd8fa552f730f7`
   - SL65 `dc937a228add44889251dfc5fc8dd886`
   - AMG One `77b02e5a555d4819b490f67eeb348d22`

   Plan: about 40% of Island traffic, parked at banks and hotels, colour variants.
4. **Vulcanizer:** waiting on a price decision (proposed ₦50 per 1% damage; R stays free).
5. **Rider hands:** they don't follow the steering handlebars.
6. **Animated chicken and goat models:** the user is looking for them; keep under ~5k triangles.
7. **Multiplayer (max 4), proposed but not started:**
   - Seed the city RNG first (69 random calls in `world.js`).
   - Then add a Node `ws` relay with room codes and ghost riders sending position at 10 Hz.
   - Traffic and NPCs stay local.
8. **Credits gaps:**
   - Zombie model came with the repo and has no licence (exported from Fab).
   - The Boer goat needs a credit in `readme.md` once its author is known.
9. **4-digit OTP:** the user asked for it, but no OTP exists in this game. Probably another project; ask which.
10. **Original goal not yet built:** delivery jobs, earnings, buying better vehicles.

Human-readable version: https://claude.ai/artifact/GsCdQzihzMStEtRAY2ChTU
