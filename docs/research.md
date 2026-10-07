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

## v0.3.3 pickup terrain, sound, retry and monster prediction

Repeated native explosions through freshly collected human/bot pickups succeeded, including far beyond the original bounds. The reported incomplete blast was not reproduced in those fresh states. NEW now normalizes all ordinary terrain metadata to 0xc0 rather than only repairing values below 32, and clears logical pickup markers that no longer have a live native item slot. Restoring floor queues native redraw kind 1 with the terrain palette. Live pickups and hidden item/exit encoding are preserved. Tests corrupt previously collected terrain to 0x8a/0x47, verify repair, then place repeated real bombs through and on it and destroy a block beyond it; floor graphics restore green each time.

Native animation routine 0x8be6 requests sound 1 through bank-0 0xea57 for steps, or 0x12 in world 2. Flame death at bank-9 0x8ad0 requests sound 4. Bank-4 sound entry 0x4006 checks masks/priorities from 0x4de8/0x4dc8, then writes RAM queue 0x1487 and channel ownership at 0x1480. SFX active flags are at 0x14f8. Extension requests use those loaded ROM masks/priorities, preserving higher-priority queued/active effects without patching CPU registers or bundling audio. Steps occur only on successful movement; defeat queues its effect once. Tests observe native PSG channels becoming audible and replay the queued sound state exactly. Browser listening QA remains outstanding.

Campaign motion observations are bounded to 32 native enemy slots. Smoothed frame-to-frame velocity supplies projections at 8, 16 and 24 frames; projection stops at blocked terrain. Planning/retreat destinations and proposed bomb escapes include those positions in danger. Feet movement checks actual monster clearance so a forecast does not trap a bot in its own bomb's path. Retreat no longer chooses an empty wait route when an approaching threat and an unobstructed escape exist. Optional validated motion history preserves deterministic saves; old saves begin with empty history. A fixture verifies retreat while the actual approaching enemy remains beyond the old 32-pixel reaction distance. This does not predict every future turn or guarantee survival.

When NEW watching loses the whole team, after 104-frame death animations and available extra lives, the app retries the same seed/round and keeps the chosen bot count. Surviving teammates prevent a retry. Ordinary native human campaign death behavior remains in force. Rebuilding clears the 175 native fire-group flags at 0x96d as well as bomb/item/enemy flags, so the previous attempt's explosions do not burn the fresh map. The existing round callback recreates the team and the spectator resumes automatically. Mocked UI save/load during the last death sequence verifies the same round, count and running state after retry; original Solo/Campaign watching retains its pause-on-defeat behavior.

## v0.3.4 opening skip and remote controls

The native opening checks pressed Run with `TST #8, $220a` at bank 1, PC `0xb269`. A queued Space request supplies that bit once at this specific read. The gate starts with a new Solo/Campaign/NEW launch and closes on the first active campaign frame. It never writes held Run or Shot I, and later stage transitions/Battle remain native. Holding Space after requesting a skip is consumed until keyup, preventing an accidental first bomb. Pending/requested skip flags are saved; earlier saves infer the gate from an unfinished campaign launch.

Remote Control is native item type 2 and sets RAM `0x43a` bit 4. Player bombs stop their native fuse countdown after collection. Native Button II clears the fuse of the oldest bomb recorded in the player placement queue, one per press. Keyboard B and X both map to that button; releasing either while the other stays held preserves the input. Automatic bomb flags keep companion and enemy bombs independent. Native tests use actual Shot I placement so the original queue is populated, rather than assuming an admin-spawned bomb was registered by a controller press.

## v0.3.5 native transitions and corridor combat

The previous NEW implementation consumed the native stage-clear flag at RAM `0x437` and immediately rebuilt the map. Watching defeat also rebuilt immediately after the extension death animation. Both bypassed the native music, fade and stage-card path. A validated clear now retains the flag, allowing bank-9 `0x8947` to run normally. Native human defeat reaches `0x8df0`, which starts music `0x2a`; the watched team's last defeat sets the hidden native player's death flag to use the same sequence while the visible bots animate. Available extra lives or surviving teammates prevent a watched-team retry. Human life deduction and game over remain native; watched NEW rounds can retry indefinitely.

Bank-8 `0x7ca2` (clear reload) and `0x7cae` (death reload) mark the generator as loading. World/area return to zero so NEW always reloads the original opening region's tiles and monster assets. Bank-9 `0x802a` runs the original stage card, music `0x24`, waits and fades. Only its digit read at `0x816c`, addresses `0x284a/0x284b`, returns the generated round's display indices. Cards count eight rounds per region and cycle after 64; the UI retains the full round number. The first subsequent active `0x83b0` frame rebuilds the generated map before native movement/rendering. Saves retain clear/death/loading phase and target round, and legacy queued clears enter this sequence. The pinned core stores full 16-bit VCE words during native card loads, so save validation accepts those exact words rather than incorrectly restricting palette RAM to nine color bits.

AI flags formerly used bit 6 to force their timers past the human remote-power check. Native explosion routine `0x9167` also interprets that bit as an enemy's directional bomb: `0x9193` uses its low bits to stop one arm, and `0x93d7` stops a directional bomb at an earlier flame center. This reproduced the reported empty upward path. New bombs in AI slots 20–39 use normal `0x80` flags. A read at `0x90a0`, address `0x243a`, ignores only the human remote bit for those timers. Old saved AI bombs mask bit 6 at the indexed flag reads `0x905a`, `0x9193` and `0x93d7`, preserving full blasts and ordinary fire-group allocation. Native human/enemy/Battle bomb behavior stays unchanged. Native tests exercise all four AI banks, human remote control, old flags and overlapping flame centers in all four directions.

The old enemy bombing goal accepted every floor cell within three walking steps of a monster, regardless of range or intervening pillars. Goals now follow actual blast rows/columns for the bot's own saved fire range. Observed straight patrol corridors supply interception cells; terrain stops the projection. Normal bomb placement forecasts around the 150-frame fuse and corridor reversals. Slower average speed measurements avoid pixel-step jitter over that longer forecast, while the existing fast velocity estimate retains immediate monster avoidance. Both speed observations are optional, bounded save fields. A safe interception cell can wait for favorable timing; pickup protection, monster avoidance and escape-route checks still apply. These predictions do not model every unexpected turn or ensure victory.

Headless checks cover native 1–2/1–3/2–1 cards, clear/death music, full-black fades, same-round human/watch retries, life deduction, hidden-player suppression, transition save replay and legacy saves. The mocked UI covers automatic restart after loading a defeated watched team. Browser listening, layout/gamepads, long campaigns and real remote-human play still require testing. The co-op plan separates per-client camera composition from shared world/replay state; online rooms and remote-human cameras remain unimplemented.


## v0.3.6 watch recovery, final item and inventory previews

Original SOLO/CAMPAIGN AI-only defeat formerly called the app pause function after the final bot animation. It now sets the hidden native player's death flag, retains a minimum retry life, and follows the original death music, black fades and same-stage card. Bank-8 CPU 0x7cae marks loading; bank-9 0x83b0 queues fresh bots only after play resumes. The team is spawned after Run returns and the campaign tracker is active. Selected counts one through four and loading-phase saves are covered. A native defeat independently triggered during watching is adopted too; NEW's native defeat path also keeps its retry life. Human game-over rules remain unchanged.

Extra-life revival searches connected safe floor and then safe floor elsewhere on the map. Occupied human/bot cells and predicted monster/flame cells remain excluded. A missing safe cell leaves the life available and retries later. Native Roller Shoes measurements establish 36 pixels over 48 frames normally and 48 pixels after pickup: 0.75 to 1 pixel per frame. The former bot bonus of 1.5 was too large. Bot shoes now match the native increase and repeated pickups do not stack speed.

SOLO, CAMPAIGN and NEW use a saved shared final-item objective. After the last living monster is gone, a reachable ordinary wall receives a pulsing glow composed from loaded background references; no artwork is bundled. A native bomb breaks the wall, then a required Bomb Up appears after flames clear. If a visible required item is burned, it returns after the flame. Both native exit writes and extension exit requests wait until the required item is collected. Bots prefer a reachable barrier-bombing position with a safe escape, then the exact required item slot, before seeking the exit. A native loader resets the requirement for retries and subsequent stages; already committed legacy clear sequences may finish.

Human item collection is identified by the actual bank-9 Set at CPU PC 0x8750 that clears a picked-up item flag. Flame destruction and extension pickups use separate paths, so neither increments the human totals or satisfies the human objective by proximity alone. The saved human HUD counts all 15 item IDs cumulatively, caps each total at 1,000,000, and pages on a bounded saved clock. Full native 16-pixel item icons and font counts replace only the original HIGH SCORE rectangle, logical screen X160–248/Y8–32; lives, timer, player score and arena remain native. A complete acquired-item count list is shown below the canvas. Legacy saves begin these counters at zero.

Red alone recolors palette entry 5 (hands/feet) to the native red Battle actor's green RGB 0/180/36, scaled by the native fade. The common color path covers intro, campaign, companions and Battle. Other variants retain pink ends and skin-colored limbs; original white remains native.

Admin previews decode native sprite streams, compressed graphics and palettes from the user's ROM at runtime. The catalog includes living actor types 0–44, including boss forms/parts, rather than treating every multipart component as an independent species. Type 45 is a death-only effect. Every catalog entry has its native model icon. Only a living non-boss template already initialized in the current stage is spawnable; boss forms and unloaded templates remain disabled. No atlas, sprite bitmap, palette asset or ROM bytes are committed.

Real-ROM checks cover original watch retries, stage cards/music/fades, final-item barrier destruction and pickup, blocked exits, burned-item recovery, safe objective bombing positions, extra-life recovery, measured movement speeds, red colors, all catalog previews and human inventory replay. The mocked DOM integration covers the admin icons, saved counters, legacy imports and AI-only restarts in all campaign modes. Admin items, monsters, bombs and teammates now select a persistent placement tool: each empty tile click places another copy, clicking the same tool or Deselect turns it off, and closing the dialog clears it. Slot-capacity errors retain the tool for recovery; the focused admin test verifies multiple placements without an intervening item click. Live browser visual/audio/gamepad and long-session QA remain outstanding.
