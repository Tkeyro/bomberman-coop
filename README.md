# Bomberman Co-op Lab

Browser extension for **Bomberman (1990), TurboGrafx-16, USA**. The long-term goal is people on separate computers cooperating in the original campaign.

**v0.3 adds a generated NEW campaign, matching lives-icon colors, monster-aware local AI and independent teammate bomb inventories.** Exact-position saves, a paused campaign inventory and original Battle with AI opponents remain available. Online rooms are not implemented. Campaign teammates are independent extension actors rendered from the ROM's loaded sprites; their bombs, block destruction and enemy kills use the original game engine. They are not additional native campaign controller ports.

## Play

1. Serve `dist/`, for example `python3 -m http.server 8080 --directory dist`.
2. Open `http://localhost:8080` and load your local `Bomberman (USA).pce`.
3. Choose your color. The original title screen opens automatically. Use **Up/Down** to select **1P - SOLO**, **1-5P - NEW**, **2-5P - CAMPAIGN**, or **2-5P - BATTLE (A.I)**, **Left/Right** to choose players (1–5 in NEW, 2–5 in the other multiplayer modes), and **Enter** to start. You can also click a menu row. Campaign uses local AI teammates; Battle uses native controller ports driven by AI.
4. Campaign retains the original opening introduction (about 40 seconds). The selected color includes the rear-facing introduction pose.

The six choices appear inside the original title screen using the ROM's loaded font, native red cursor and landscape. There is no web menu overlay. C-Link and password choices are hidden from the first title-menu frame, including startup and departure. The original copyright glyphs sit eight game pixels lower to leave room below the player-count hint. **2-5P - BATTLE (Online)** is dimmed and displays an unavailable message until online rooms exist. **LOAD SAVE** restores the latest browser save paused after loading the ROM. The original PASSWORD option was a stage/round code; the new save controls preserve the exact emulator and AI state instead.

**Main menu** holds your current game in memory while you browse choices. **Continue game** returns to it. Selecting a new game replaces that session; save/export first if you want to keep it after reloading the page.

| Action | Control |
| --- | --- |
| Main menu choice / player count / start | Up/Down / Left/Right / Enter |
| Move | Arrows / WASD |
| Place bomb | Space |
| Button II | X |
| Run / advance Battle results | Enter |
| Select | Shift |
| Paused campaign inventory | F2 or Admin button |

Click the game screen to focus keyboard controls. Losing focus releases held keys; switching windows pauses play. Browser audio, fullscreen and physical gamepad testing remain outstanding.

## NEW campaign

Choose **1-5P - NEW** for one human plus zero to four local AI teammates. Seeded maps start larger than the opening original map and grow from native bounds 27×21 to 31×29, with more breakable blocks and 14–28 native monsters depending on round and team size. A protected starting area and guaranteed fire-up give you room to begin. Other power-ups are scattered around the map; the blue exit is hidden under a block. Kill every monster and uncover/reach the exit to generate the next round. Each round resets the seven-minute clock and brings a fresh team. Maps, round number and generator state are saved with your session.

This mode currently reuses the original opening region’s loaded tiles and Ballom model, with native music, pickups, bombs, explosions and collisions. Both camera axes follow the larger maps. Difficulty grows through density, size and monster count; comparison with every original late stage/boss has not been playtested. Separate-computer human co-op remains pending.

## Colors

White, black, blue, green, red, violet, orange and yellow. Nonwhite variants use the selected color for their helmet and blue body regions. Arms and legs use the face's orange skin tone with shading. Hands and feet retain their original pink color for every variant, including red. Original white keeps its complete native appearance. The lives-counter head also matches the selected helmet, including black, orange and yellow; its face and the surrounding HUD retain their native colors. Faces, outlines and original numeric palette/ROM remain intact. Opening rear pose and stage 1 are integration-tested; later campaign stages and all boss scenes still need visual QA.

## Save and continue

- **Save progress** writes a quick save to this browser's IndexedDB. **LOAD SAVE** restores it paused; press Resume to continue.
- **Export save** downloads a `.bmsave` backup. **Import save** can continue it on another computer after loading the same ROM.
- Saves include emulator CPU/RAM/video/audio synthesis state, screen, color, AI actors/plans and menu launch progress. They do not contain the ROM file. The live audio output buffer is cleared on restoration.
- Clearing site data removes the browser quick save. Export backups for long-term storage. Save format is tied to this extension version and pinned emulator core; incompatible/corrupt files are rejected.

## Local admin inventory and AI

During an active campaign stage, press **F2**. Emulation pauses. Choose an empty tile on the grid, then spawn an item, bomb, monster or AI Bomberman. Close the dialog/F2 to resume. If already paused, closing keeps it paused.

All 15 native item IDs are available: fire up, bomb up, remote control, roller shoes, bomb pass, wall pass, fireproof vest, extra life, skull and six bonus items. Monster buttons clone living, non-boss templates already loaded in the current stage. Unloaded species and bosses are not offered because they require additional graphics and initialization research. Item and enemy slots retain original engine limits. Pickups activate when collected, not merely when spawned. The fireproof vest grants about 60 seconds of bomb-blast protection; enemies still cause damage, matching the original game.

Up to four local AI teammates receive a random color, including white. They seek breakable blocks and enemies, place original-engine bombs when an escape route exists, avoid known blast paths and nearby monsters, turn back when an enemy approaches during a step, take explosion/enemy damage, and seek a revealed exit only when no living monsters remain. They prioritize reachable enemy attack positions and keep moving when a current bomb position is unsafe. Defeated teammates stop moving/placing bombs, play the original 104-frame collapse/explosion animation, then disappear. A save made during that animation continues it on load. Teammates carry across stage transitions. Their planner is experimental and they can die. Their feet collide with pillars and breakable blocks, and sprite placement uses the same camera alignment as the native player. Native player palette flashes do not hide teammates. Each teammate has its own bomb allowance and reserved slots, separate from the human and native enemy bomb slots. Allowances start at one, with room for five per bot; the inventory shows each actor's active bombs. Native timer handling covers these extra slots without double-ticking enemy bombs. Fire range still follows the primary player; AI pickup collection, individual power-ups, lives/revival and native enemy targeting of teammates are not implemented. Solo's native player rules remain authoritative.

Admin privileges apply to the local browser session; this is not an online account/role system. No network server or authentication service is present.

## Verification

`npm test` runs dependency-free Node tests. Include an external game file to run integration checks:

```sh
BOMBERMAN_TEST_ROM=/absolute/path/to/game.pce npm test
```

Checks cover revision rejection, palette restoration and suit colors, rear-facing intro, native menu font/cursor pixels and navigation, original campaign controls, lives-icon recoloring, generated map connectivity/scrolling/exit progression, native item pickup/monster spawning, independent bomb inventories and monster avoidance, independent AI block clearing and enemy kills, native Battle actors/controllers/bombs, exposed-exit stage clear, and deterministic emulator/AI save replay. A mocked DOM integration test exercises keyboard menu/admin/save wiring, LOAD SAVE and returning from the menu to the current game; it is **not real browser QA**. Remaining browser checks include audio, layout, fullscreen, real gamepads, mobile and long sessions.

Local research helpers:

```sh
node scripts/investigate.mjs /absolute/path/to/game.pce /outside/repository/output
node scripts/headless.mjs /absolute/path/to/game.pce /outside/repository/output
```

Keep generated RAM, video, traces and saves outside the public repository. The browser research panel downloads an 8 KiB RAM dump or a bounded 120-frame player-region write trace.

The ROM is read in browser memory. There is no upload endpoint, bundled ROM, extracted artwork/music, screenshot or save file in this repository. Each page load requires selecting the same verified USA ROM revision. A ROM contains compiled machine code; original source names, comments and build files are not recoverable automatically.

See [research findings](docs/research.md) and the [co-op plan](docs/coop-plan.md). Public source: [Tkeyro/bomberman-coop](https://github.com/Tkeyro/bomberman-coop).

## Emulator provenance

[yhzmr442/jspce](https://github.com/yhzmr442/jspce), pinned to `d4339bae5fb2253b8b3d110e256405d928a3afc4`. `dist/vendor/pce.js` preserves upstream `PCE.js` with an ES-module export appended; its MIT license is included.

Native [Beetle PCE Fast](https://github.com/libretro/beetle-pce-fast-libretro) was used for independent reference checks and is not bundled. Application code is MIT licensed. This independent project does not provide a license to the original game.
