# Bomberman Co-op Lab

Browser extension for **Bomberman (1990), TurboGrafx-16, USA**. The long-term goal is people on separate computers cooperating in the original campaign.

**v0.3.5 restores native NEW stage/death transitions and corrects AI explosion directions and corridor combat.** B for remote detonation, Space to skip the opening, watching 1–4 bots, individual teammate upgrades, generated maps, matching lives-icon colors, exact-position saves, a paused campaign inventory and original Battle with AI opponents remain available. Online rooms are not implemented. Campaign teammates are independent extension actors rendered from the ROM's loaded sprites; their bombs, block destruction and enemy kills use the original game engine. They are not additional native campaign controller ports.

## Play

1. Serve `dist/`, for example `python3 -m http.server 8080 --directory dist`.
2. Open `http://localhost:8080` and load your local `Bomberman (USA).pce`.
3. Choose your color. The original title screen opens automatically. Use **Up/Down** to select **1P - SOLO**, **1-5P - NEW**, **2-5P - CAMPAIGN**, or **2-5P - BATTLE (A.I)**, **Left/Right** to choose players (1–5 in NEW, 2–5 in the other multiplayer modes), and **Enter** to start. You can also click a menu row. Campaign uses local AI teammates; Battle uses native controller ports driven by AI.
4. Campaign retains the original opening introduction (about 40 seconds). Press **Space** to skip it, including during the opening fade; holding the skip key will not place a bomb when gameplay starts. The selected color includes the rear-facing introduction pose.

The six choices appear inside the original title screen using the ROM's loaded font, native red cursor and landscape. There is no web menu overlay. C-Link and password choices are hidden from the first title-menu frame, including startup and departure. The original copyright glyphs sit eight game pixels lower to leave room below the player-count hint. **2-5P - BATTLE (Online)** is dimmed and displays an unavailable message until online rooms exist. **LOAD SAVE** restores the latest browser save paused after loading the ROM. The original PASSWORD option was a stage/round code; the new save controls preserve the exact emulator and AI state instead.

**Main menu** holds your current game in memory while you browse choices. **Continue game** returns to it. Selecting a new game replaces that session; save/export first if you want to keep it after reloading the page.

| Action | Control |
| --- | --- |
| Main menu choice / player count / start | Up/Down / Left/Right / Enter |
| Move | Arrows / WASD |
| Place bomb | Space |
| Remote detonation / Button II | B or X |
| Skip opening cutscene | Space |
| Run / advance Battle results | Enter |
| Select | Shift |
| Paused campaign inventory | F2 or Admin button |

Collect **Remote Control** first. Your bombs then wait for **B** or **X** (native controller Button II), which detonates them one at a time in placement order. AI teammates control their own bombs.

Click the game screen to focus keyboard controls. Losing focus releases held keys; switching windows pauses play. Browser audio, fullscreen and physical gamepad testing remain outstanding.

## NEW campaign

Choose **1-5P - NEW** for one human plus zero to four local AI teammates. Seeded maps start larger than the opening original map and grow from native bounds 27×21 to 31×29, with more breakable blocks and 14–28 native monsters depending on round and team size. A protected starting area and guaranteed fire-up give you room to begin. Other power-ups are scattered around the map; the blue exit is hidden under a block. Kill every monster and uncover/reach the exit to generate the next round. Each round resets the seven-minute clock and brings a fresh team. Maps, round number and generator state are saved with your session. Explosion cleanup restores the original green floor, including outside the original map bounds; previous NEW saves repair their blackened floor on resume.

This mode currently reuses the original opening region’s loaded tiles and Ballom model, with native music, pickups, bombs, explosions and collisions. Both camera axes follow the larger maps. Difficulty grows through density, size and monster count; comparison with every original late stage/boss has not been playtested. Separate-computer human co-op remains pending.

Clearing a round runs the original clear music, animation and black fade, then the native stage card (1–2, 1–3 and onward) before the next generated map starts. Human defeat uses the original death music, fades, life deduction and same-round restart; original game-over rules still apply. NEW watching retries a defeated team through that sequence, preserving the selected bot count. Stage cards count eight rounds per displayed region and cycle after 8–8; the page always shows the full NEW round number. Saves resume an unfinished clear, death, fade or stage card.

## Colors

White, black, blue, green, red, violet, orange and yellow. Nonwhite variants use the selected color for their helmet and blue body regions. Arms and legs use the face's orange skin tone with shading. Hands and feet retain their original pink color for every variant, including red. Original white keeps its complete native appearance. The lives-counter head also matches the selected helmet, including black, orange and yellow; its face and the surrounding HUD retain their native colors. Faces, outlines and original numeric palette/ROM remain intact. Opening rear pose and stage 1 are integration-tested; later campaign stages and all boss scenes still need visual QA.

## Save and continue

- **Save progress** writes a quick save to this browser's IndexedDB. **LOAD SAVE** restores it paused; press Resume to continue.
- **Export save** downloads a `.bmsave` backup. **Import save** can continue it on another computer after loading the same ROM.
- Saves include emulator CPU/RAM/video/audio synthesis state, screen, color, AI actors/plans and menu launch progress. They do not contain the ROM file. The live audio output buffer is cleared on restoration.
- Clearing site data removes the browser quick save. Export backups for long-term storage. Save format is tied to this extension version and pinned emulator core; incompatible/corrupt files are rejected.

## Watch AI play

Choose **AI only — watch (1 bot)**, **(2 bots)**, **(3 bots)** or **(4 bots)** in the player-count selector before starting. In the native menu, press Right past five players, then Left/Right to choose the number of bots. Solo, NEW and Campaign support all four choices; original Battle requires at least two players and supports watching 2–4 bots.

Campaign modes use the selected number of independent AI actors with no visible or controllable human player. The camera follows a living bot and switches when it dies. In NEW, losing the whole team with no extra lives starts the native death music while the bots finish their death animations, followed by black fades and the same-round stage card. The same seeded round then restarts automatically with fresh monsters, items, clock and the selected number of bots. One bot dying does not restart a surviving team. Original Solo/Campaign watching pauses after team defeat; use Main menu to start another game. Battle drives the selected native controller ports; Enter advances results/retry. Save/load and Main menu → Continue game preserve spectator mode and the selected count, including a save during the final death sequence. Earlier four-bot watch saves remain loadable. The campaign planner remains experimental, so bots can die or wait when no safe route exists.

## Local admin inventory and AI

During an active campaign stage, press **F2**. Emulation pauses. Choose an empty tile on the grid, then spawn an item, bomb, monster or AI Bomberman. Close the dialog/F2 to resume. If already paused, closing keeps it paused.

All 15 native item IDs are available: fire up, bomb up, remote control, roller shoes, bomb pass, wall pass, fireproof vest, extra life, skull and six bonus items. Monster buttons clone living, non-boss templates already loaded in the current stage. Unloaded species and bosses are not offered because they require additional graphics and initialization research. Item and enemy slots retain original engine limits. Pickups activate when collected, not merely when spawned. The fireproof vest grants about 60 seconds of bomb-blast protection; enemies still cause damage, matching the original game.

Up to four local AI teammates receive a random color, including white. Safety comes first: they avoid known blast paths and nearby monsters, and turn back when an enemy approaches during a step. Campaign bots observe monster movement and check projected positions up to 24 frames ahead. Bomb escape routes avoid that predicted danger. They back away from an approaching monster instead of waiting at a barely safe cell when an escape is available. Motion history is saved. On safe ground they prioritize reachable useful power-ups before fighting or clearing blocks, avoid skulls, and reject bomb placements whose blast would hit any visible item. Hidden items become goals after they are revealed. Battle AI follows the collection/protection priorities, using the native player pickup effects.

Campaign teammates collect their own upgrades: fire range up to five tiles, bomb allowance up to five, roller shoes, remote control, bomb pass, wall pass, a 60-second fireproof vest and extra lives. These do not upgrade the human or other bots. Remote bombs wait until the team is outside their blast and visible items are safe; active bombs retain their owner's placement-time range. Bonus items are collected and counted, but extension actors do not add their native bonus score to the human's score. Teammate upgrades, remote timers and active bomb ranges are included in saves.

They seek breakable blocks and enemies, place original-engine bombs when an escape route exists, keep moving when a bomb position is unsafe, and seek a revealed exit only when no living monsters remain. Defeated teammates stop moving/placing bombs and play the original 104-frame collapse/explosion animation; an extra life revives them on safe floor when available. A save made during that animation continues it on load. Teammates and upgrades carry across original stage transitions; NEW rounds bring a fresh team. Their planner is experimental and they can die. Their feet collide with pillars and blocks unless they have the corresponding pass upgrade, and sprite placement uses the native camera alignment. Native player palette flashes do not hide teammates. Each teammate has its own reserved bomb slots, separate from the human and native enemies; native timers cover these slots without double-ticking enemy bombs. The inventory shows each actor's bombs, fire range and collected-item count. Native enemy targeting of extension teammates remains unimplemented. Solo's native player rules remain authoritative.

Monster bombing positions use each bot's actual fire range and unobstructed rows/columns. Observed horizontal or vertical patrols supply interception positions; pillars and blocks stop the prediction. Normal bombs consider the monster's expected corridor position around fuse expiry, including reversals, before planting. Bots can approach a corridor opening and wait for an interception opportunity instead of repeatedly bombing behind a pillar. Unexpected turns can still make a trap miss.

Campaign footsteps and death request the original ROM sound effects through its sound manager. Steps only play while feet actually move; death plays once when damage defeats the actor. Native sound priorities protect higher-priority effects, and the existing mute/pause controls apply. No extracted audio files are bundled.

AI bombs now use normal Bomberman explosions in all four directions. The earlier automatic-fuse flag also selected the native enemy bomb's directional behavior, suppressing upward blasts and stopping propagation at fading flame centers. New AI bombs avoid that flag; compatibility reads correct existing saved AI bombs while keeping the human's remote power separate from their timers. NEW also repairs stale ordinary terrain and collected-pickup markers, while preserving live pickups and hidden item/exit encoding.

Admin privileges apply to the local browser session; this is not an online account/role system. No network server or authentication service is present.

For planned online co-op, each browser will follow its assigned human player with its own local camera. Players will share monsters, bombs, pickups and stage progress, but can see different parts of the map. Camera offsets must be separated from shared emulator state before network replay is added; the current local camera hooks are not a completed online implementation. See the [camera plan](docs/coop-plan.md#independent-online-cameras).

## Verification

`npm test` runs dependency-free Node tests. Include an external game file to run integration checks:

```sh
BOMBERMAN_TEST_ROM=/absolute/path/to/game.pce npm test
```

Checks cover revision rejection, palette restoration and suit colors, rear-facing intro, native menu font/cursor pixels and navigation, original campaign controls, lives-icon recoloring, generated map connectivity/scrolling/exit progression, native item pickup/monster spawning, independent bomb inventories and monster avoidance, independent AI block clearing and enemy kills, native Battle actors/controllers/bombs, exposed-exit stage clear, and deterministic emulator/AI save replay. Power-up checks cover collection priority, visible-item protection, skull avoidance, individual upgrades, extended native blasts, remote detonation, pass abilities, vest expiry, extra-life revival and upgraded save replay. Additional checks cover repeated blasts on collected/stale pickup terrain, native PSG step/death output and pending-audio replay, predictive monster retreat and cleared fire groups on retry. A mocked DOM integration test exercises keyboard menu/admin/save wiring, all four watch counts, LOAD SAVE, returning from the menu and an automatic NEW retry after loading a dying team, early/held Space intro skipping, and B/X shared-button release; it is **not real browser QA**. Native checks also cover queued intro-skip save replay, normal bomb timers and the human Remote Control pickup, waiting bombs, ordered detonation and separate AI/enemy bombs. v0.3.5 adds stage-card digits, clear/death music and full-black fades, human/watch same-round retry, saves during native transitions, four-direction blasts in every AI bank including legacy saves and overlapping flame centers, and a surviving range-one bot killing a corridor monster after approaching the opening. Remaining browser checks include audible playback, layout, fullscreen, real gamepads, mobile and long sessions.

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
