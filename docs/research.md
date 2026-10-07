# Verified findings — 2026-10-06

## ROM identity

| Property | Value |
| --- | --- |
| File size | 262,144 bytes |
| CRC32 | `5F6F3C2A` |
| SHA-1 | `DC63680E579764BBACB7F07514F4F49AB888D3B1` |
| SHA-256 | `b9f98ce3d8b8baf1c6d02c2c0af72f8c0c554e533f13deb8f389853fe33bbf9e` |

The CRC32 and SHA-1 match the Bomberman (USA) entry in the [libretro PC Engine database](https://github.com/libretro/libretro-database/blob/master/metadat/no-intro/NEC%20-%20PC%20Engine%20-%20TurboGrafx%2016.dat).

## Reproducible campaign boot

JavaScript and native reference runs used: idle 180 frames, Run on port 1 for 8 frames, idle 120, Run for 8, idle 2,520. Total: 2,836 frames. Both reached stage 1 with the original map, enemies and white Bomberman.

Native RAM offsets `0x400–0x43f` matched JavaScript byte for byte at that checkpoint. Overall 8 KiB RAM differed by 122 bytes, including timing and enemy state. The two cores are therefore not claimed to be frame-identical. Native save/load replay produced identical video and RAM for repeated 20-frame sequences.

From the same native state, holding port 2 Right and I for 20 frames produced the same video as idle. Only input buffers `0x201` and `0x206` changed. Holding port 1 Right changed the video and candidate X coordinate from 40 to 55. The JavaScript integration test independently confirms this behavior.

## Player-state candidates

Offsets are into the 8 KiB RAM array, not ROM-file offsets. Under the observed campaign memory map, CPU addresses are `0x2000 + offset`.

| RAM offset | Observed role | Evidence / confidence |
| --- | --- | --- |
| `0x436` | Movement input | Right = `0x20`, down = `0x40`; confirmed read from zero-page input |
| `0x438` | Lives candidate | Initial value 2; lifecycle not yet traced |
| `0x43a` | Movement/death or invulnerability gate | Low three bits checked by movement routine; exact meaning pending |
| `0x43b` | Facing direction | Right 1, down 2, left 3, up 0 in disassembly |
| `0x43c` | Animation counter | Cycles while moving; reset while idle |
| `0x43d–0x43e` | X coordinate, little endian | Right path adds movement delta with carry |
| `0x43f–0x440` | Y coordinate candidate | Initial Y 24; vertical movement and high byte need further verification |
| `0x444` | Fractional speed candidate | Repeating `0 → 192 → 128 → 64` sequence |
| `0x445` | Integer movement delta | Set during speed update, then cleared after movement |

## Movement code

Disassembly was checked using the HuC6280 instruction table in [MAME's decoder](https://github.com/mamedev/mame/blob/master/src/devices/cpu/h6280/6280dasm.cpp). No full disassembly or ROM instruction bytes are bundled.

In the observed bank-9 mapping, CPU `0x8000` corresponds to ROM file offset `0x12000`.

- CPU `0x83b6`: caller of the movement dispatcher, observed once per campaign frame. The surrounding player-update chain calls `0x8716`, `0x8aad`, `0x88fb`, `0x873f`, `0x8b51` and `0xc121`; their side effects still need classification.
- CPU `0x83c8`: movement gate and input dispatcher. Checks `0x243a`/`0x2437`, reads movement bits from zero-page `0x3f`, stores them to `0x2436`.
- CPU `0x83e3`: calls animation routine `0x8be6`.
- CPU `0x83e6`: calls speed/delta routine `0x8b19`.
- CPU `0x83e9`: calls direction dispatcher `0x83fa`.
- CPU `0x844b`: right movement and collision/alignment paths.
- CPU `0x8500–0x850a`: adds `0x2445` to X at `0x243d–0x243e`.
- CPU `0x83ec`: clears the movement delta after the update.

The absolute player-state references show why a second controller cannot simply be enabled. A second character needs its own state and must be included in movement, rendering, bomb ownership, damage, power-ups and stage transitions. These routines are identified entry points, not a finished patch.

## Rendering and color proof

The first campaign player occupies the first two SATB sprite entries and uses sprite palette 12. Its observed pattern references are in `640–703`. Grayscale suit entries in palette addresses `0x1c0–0x1cf` can be tinted without changing face colors or the enemy palette 3.

A matched one-frame comparison changed **66 pixels**, all within original frame coordinates **x=58–70, y=59–74**, when blue was selected. Numeric palette RAM and all game RAM remained unchanged at selection; enemy palette 3 remained unchanged. Restoring original white restores the original rendering-cache colors.

This proves stage-one recoloring, not full-game coverage.

## Verification limits

The emulator and controls were exercised headlessly in Node and through mocked DOM events. No real browser, audio output, fullscreen, physical gamepad or remote multiplayer QA was performed in this environment. The site currently has no online transport; additional campaign characters use the local extension described below.

## v0.2 extension findings

Recoloring targets campaign sprite palette 12 across the intro and gameplay, including rear-facing pattern `0x318` (792). Nonwhite variants recolor indices 8, 9, 10, 15 (helmet) and 2, 3, 4 (blue body). Limb indices 11, 13, 14 derive their skin tone from native face index 7, with shading. Full-bright skin RGB is (252, 144, 0); using the current face palette preserves native fade steps. Pink glove/boot index 5 and face indices 6/7 remain native. Original white bypasses all recoloring. Numeric palette RAM remains unchanged; render-cache colors are themed.

The stage-frame hook is CPU PC `0x83b0`, ROM bank 9. Campaign world/area are RAM `0x84a/0x84b`; Battle world is 8. Stage dimensions are `0x434/0x435`, camera X/Y are zero-page `0x25..0x28`. The 32-column-stride tile grid begins at `0x44a`. Low tile bits: 1 pillar, 2 block, 3 hidden item, 4 hidden exit, 7 pickup, 8 exposed exit, 10 floor, 11/12 flames.

Original campaign bombs occupy the first ten slots of the 40-slot arrays starting at `0x84f` (flags), `0x877` (tile X), `0x89f` (tile Y), `0x8c7` (animation), `0x8ef` (fuse), and `0x917` (fire group). Verified spawning invokes native rendering, explosions, block destruction and enemy death. Only zero-valued inactive slots are reused.

Item flags/types at `0xf9b`, X at `0xfb4`, Y at `0xfcd` have 25 slots. Native redraw queue arrays at `0xfe6`, `0x1066`, `0x10e6`, `0x1166` use read/write indices `0x76/0x77`. Fifteen item IDs were rendered; original fire-up pickup was verified. Bonus item labels derive from matching game icons/score handlers and are not claims of recovered source symbols.

Living enemy flag is bit 7 at `0xd98`; type is `0xeb8`; positions are SoA words across `0xdb8/0xdd8` and `0xdf8/0xe18`. Native stage-1 Ballom is type 2. Some live actors have `0xf18 == 128`; that byte must not be treated as a death flag. Monster spawning clones loaded non-boss templates, resets transient fields and the all-enemies-cleared flag `0xd96`.

Native Battle supports 2–5 independent controller ports. Actor state at `0x3bd+port` is 0 alive, 2 dying, 1 dead. Position arrays are `0x3cc/0x3d1` and `0x3d6/0x3db`; capacity/fire range are `0x3ea/0x3ef`. Configured/active/alive player counts are `0x4b/0x4a/0x4e`. Four final RUN presses after selecting player count complete setup; an extra RUN pauses an already active match.

Local AI campaign actors have independent extension movement/life/planner state and draw using loaded native sprite patterns through the normal compositor. Original native routines process their spawned bombs and enemy kills. On a cleared stage, an AI reaching tile 8 requests the native exit through `0x437 = 1`. A fixture verifies this trigger; full campaign/boss completion and transition QA remain outstanding.

Complete save snapshots capture mutable emulator state without live DOM/audio/ROM mapping objects. ROM SHA-256, pinned core and format version gate import; bounded decoding and validation precede mutation. Exact CPU/RAM/screen replay and separate AI-state replay pass. Saves are local/private user data and must not be committed to source.


## Sprite/collision and vest corrections

Campaign activity uses the recent bank-9 stage-frame hook independently of the first SATB sprite palette. Native vest effects change the primary sprite palette, so sprite-palette gating incorrectly hid all extension actors during those flashes. AI drawing now stays active throughout the native palette cycle. Recorded pose X offsets included the initial eight-pixel camera origin; normalizing that origin before subtracting the live camera aligns AI sprites with their world-coordinate collisions.

AI movement checks a five-pixel feet radius against pillars, breakable/hidden blocks and breaking blocks at each step, including stale destinations and interrupted turns. A native sprite comparison covers all four directions and four animation phases; the extension uses the same visible bitmap pixels as the native actor.

The spawned vest pickup sets RAM `0x43a` bit 7 and timer `0x446/0x447` to 3600 frames. Native flame-damage tests verify protection after pickup and death without it. Native enemy collision still kills the protected player; this vest is bomb-blast protection, not full immunity. Inventory text now states the effect and collection requirement.

## Native title menu

The menu uses loaded background font tiles at `0x200 + ASCII` and the original SATB cursor pattern 918. Native title SATB entries 1–11 draw the old choices/prompt/devices; hiding these during composition preserves the remaining title artwork. Five rows replace them at screen Y 138, 154, 170, 186 and 202, with a player-count hint at Y 218. Temporary font tile-map substitutions are restored after each native background scanline. Only the font ink is composited over the unchanged landscape. No glyph or title bitmap is bundled.

Extension menu input consumes Up/Down, Left/Right and Run before the original four-choice menu receives them. Solo/Campaign dispatch into native Solo; Battle (A.I) dispatches into native Battle setup for 2–5 controller ports. Online and missing-save choices stay on the menu with an explanatory message. Keyboard/gamepad navigation, all five labels' font pixels, fifth-row native cursor, unchanged CPU/RAM/VRAM/palette and native intro/Battle launches pass headless checks. A current game is captured in memory while browsing the main menu and restored by Continue game; explicit browser saves remain separate.

## AI death animation and startup refinements

Both native flame and enemy deaths use thirteen poses, each held for eight frames. Pattern references are 696/704 for the initial collapse, then 682, 712, 714, 720, 722, 728 and 730 for the mirrored burst frames. These sprite patterns are already loaded during stage one; death requires no additional ROM extraction or VRAM upload. Extension actors retain their position/color, stop planning immediately and remain drawable for 104 frames. Animation progress is saved. Older saves without this field retain living actors and keep already defeated actors hidden. Death effects draw above native enemies/flames while preserving the primary player's sprite priority.

Title composition is prepared before boot input runs, then controls unlock when initialization finishes. The replacement remains visible until native dispatch leaves the title, preventing flashes of C-Link/password labels. The original background copyright ink is composited eight pixels lower; its vacated band is filled with the adjacent native water background. No copyright glyph bitmap is bundled.

## v0.3 HUD, AI and generated campaign

The lives-counter head uses background tile references 0x268/269, 0x278/279 and 0x288/289 with background palette 11. Helmet indices 2, 6 and 7 receive the chosen color and native shading/fade in an isolated rendering palette starting at 576. Only those head tiles are remapped during background composition; face indices 8/9, other HUD pixels, numeric palette RAM and VRAM remain unchanged. Pixel tests cover all eight choices and restoring original white.

Campaign companions reserve slots 20–39 as four independent five-slot banks; native human slots 0–9 and enemy slots 10–19 remain separate. Each bot starts with allowance one, stored alongside its bank in saves. The native campaign fuse loop begins at bank-9 CPU PC 0x9080; the CPU hook raises its initial X to 39, then skips from 20 to 9 after the loop's decrement. The existing enemy timer loop retains slots 10–19, avoiding duplicate ticks. Bot flags include automatic-fuse bit 6 so human remote control does not hold their timers. Native drawing, explosions, block destruction and damage process the extra slots. Tests fill every human slot, place four independent bot bombs and verify enemy timers still tick once.

The AI planner includes nearby monster tiles in route danger, reevaluates interrupted steps and retreats along unobstructed axes. It can recover by decreasing an existing feet/block overlap, while rejecting movement into additional blockage. Reachable positions within three floor steps of enemies supply safe trap targets. If the current position cannot plant safely, objective search excludes that same tile, preventing zero-length goals from freezing exploration. Exit requests require both the native cleared flag and an empty living-enemy list. Save replay remains deterministic without additional motion-history state.

NEW uses deterministic seeded maps and the opening region's already loaded floor/block/pillar tiles and Ballom initialization template. Logical tiles and initial 2×2 background references are rebuilt together; loaded sprite/glyph bitmaps are not extracted or bundled. Native bounds grow from 27×21 to 31×29, wall density grows, and monster count scales up to 28. A clear start, scattered native pickups and one hidden-exit tile are generated. An actual explosion proves the original encoded exit is 0x24 (low type 4); type 3 reveals an item. Native block explosions expose the exit, and native primary/extension exit requests schedule a new generated round only after all living enemies are gone. Each round restarts the native minutes/seconds/subsecond clock at RAM 0xd8d–0xd8f with 6/59/59, clears timeout flag 0xd90, and recreates the team.

Native camera writes to zero-page 0x25–0x28 are constrained to the larger map's player-follow coordinates while NEW is active. Original Solo/Campaign/Battle camera behavior is preserved when it is disabled. Generator seed, round, initialization references, pending transition and independent bot inventories are included in session saves; old saves without these optional fields remain loadable. Headless integration covers real pickups, human block collision, both scroll axes, native hidden-exit reveal, locked exit, round transition, bombs and exact replay. The six menu rows use native font/cursor at Y 130/144/158/172/186/200, with NEW supporting one through five players.

Browser audio/layout/gamepad QA and late-game/boss comparisons remain outstanding. NEW uses local AI teammates and has no online transport or new monster-asset loading.


## v0.3.1 floor restoration and spectators

Generated ordinary floor and blocks now retain native high-bit redraw metadata (0xca/0xc2). Without 0xc0, explosion cleanup queued black background tiles 0x300/0x301 instead of green floor references 0x3304/0x3305/0x3314/0x3315. Real explosions verify green restoration near the start and beyond the original bounds while retaining active flames. NEW updates normalize old ordinary ground/block/flame metadata and repair already blank floor references in prior saves; hidden items/exits keep their own encoding.

Player-count zero selects four AI actors and is rendered as AI ONLY - WATCH in the native menu. The campaign spectator keeps the unused native controller outside the arena, suppresses its two sprite entries, blocks its input and follows an AI actor with survivor fallback. Bot bomb planning excludes the unused human. Campaign completion waits for the full team death animations. Generator/companions/spectator state replay together in saves. Battle spectator mode includes native port zero in the AI loop. Existing saves without the optional spectator fields default to normal play.

## v0.3.2 watch counts and power-up handling

Startup watch choices now use counts -1 through -4 for one through four AI actors, with native Left/Right navigation and matching HTML selector options. Legacy count zero restores as four bots. Solo, original Campaign and NEW accept all four counts; native Battle retains its two-player minimum and supports watching two through four. The selected count survives saves and returning through Main menu. NEW uses that count when generating a fresh team each round.

Campaign pickup removal clears the native item flag and queues the tile through 0xfe6/0x1066 with redraw kind 1 at 0x10e6 and palette 3 at 0x1166. The original logical floor and green background references are restored. Native item effects establish the extension's individual upgrade bounds: fire range caps at five, bomb allowance at the reserved five slots per teammate, shoes speed up movement, remote/pass flags apply to their owner, vest protection lasts 3600 frames and extra lives permit revival after the native 104-frame death sequence. Enemy damage still bypasses the vest. Skull pickups are avoided. Bonus types 9–14 are counted without awarding their native score to the human.

The bank-9 campaign explosion range read uses CPU PC 0x9112, address 0x284d and X as the bomb slot. Reads for extension slots 20–39 return a saved placement-time range; native human/enemy reads retain their original behavior. Danger predictions use the same per-bomb range. Remote timers hold owned fuses until the living team is outside the blast and no visible item would be hit. A zero fuse is left untouched so the native explosion step can complete, including after chain reactions.

Safe reachable useful pickups outrank enemy/block objectives in both planners. Proposed bomb blasts are rejected if they intersect any visible item, even when it is not yet reachable. Monster/flame escape still takes priority. Campaign pass abilities affect both route search and feet collision; acquired powers and remote timers are independent per actor. Optional save fields preserve older saves, while new range, power and timer fields receive bounded validation. Spectator completion waits for available extra lives as well as death animations.

Native integration verifies green floor after AI pickup, upgrades isolated from the human and other bots, a real five-cell explosion, remote escape before detonation, vest expiry, revival, skull avoidance, item-safe bomb rejection and exact emulator/extension replay. Native Battle pickup effects and mocked startup launches for every watch count pass. Real browser and long-session AI QA remain outstanding.
