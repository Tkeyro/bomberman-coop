# Bomberman Co-op Lab

Browser extension for **Bomberman (1990), TurboGrafx-16, USA**. Public source: [Tkeyro/bomberman-coop](https://github.com/Tkeyro/bomberman-coop). Each player supplies the same verified game file locally.

**v0.4.6 lets human and AI campaign teammates walk through each other.** Walls and bombs remain solid; AI still prefers separate routes and safe bombing positions. Guest catch-up avoids drawing some intermediate camera views while preserving every simulation frame and native hardware collision flags. Online status shows game FPS, available connection round-trip time and pending frames. Online campaigns now use finite spare rounds: after the entire team exhausts its lives, the original death music and fade finish before all players return to the main menu. The final frame is acknowledged before the host closes the room. Existing v0.4.4 and v0.4.0 online saves can still reopen a fresh-level lobby; everyone must reload the same current build to connect.

**v0.4.5 makes game-screen clicks focus only.** Click to return keyboard control, then use the keys to choose a menu option. Clicking does not select an option or resume a paused game; use Resume for that.

**v0.4.4 allows AI teammates to pass through each other while preferring separate routes and goals.** Bots coordinate a firing position and wait for teammates to reach shelter before bombing. Round placement uses safe floor connected to the original entrance, including temporary overlap when the opening is small. Surviving admin-added DLC teammates retain their identities, colors and upgrades into the next round. Online guests can catch up after falling behind; the host limits outstanding frames instead of letting delay grow into a queue overflow. Temporary lobby-service interruptions retry while healthy peer gameplay continues.

**v0.4.3 gives Solo AI the original finite campaign life stock.** When its final life is lost, the original death music and fade finish and the main menu becomes usable again. Solo AI no longer receives a forced spare life on each defeat. Existing cooperative watch and online team retry rules are preserved.

**v0.4.2 fixes reproduced online startup and pause/resume freezes.** Browser audio can no longer block snapshot synchronization, and guests keep authoritative frames that arrive while paused. Startup and pause status are visible, and incomplete startup reports a timeout. The idle demo is disabled while the custom menu is open. Original single-player Campaign now asks Human or AI before the world picker; AI watches one bot in the chosen world. Bots reject bombs and remote detonations whose blast would reach an exposed blue exit, including existing bomb chains.

**v0.4.1 makes color selection visible above the game and inside the online lobby.** Click one of eight named colors before loading the ROM or while choosing your lobby settings. A lobby color change updates the roster and clears readiness. Online colors stay fixed after starting; this UI patch preserves the v0.4.0 online/save protocol.

**v0.4.0 adds online campaign and Battle lobbies, shared campaign upgrades, cooperative AI, a world picker and fresh-level online save recovery.** It also removes the living-template requirement for all 23 regular enemy types and rearranges the HUD with smaller inventory icons and a completely recolored lives head. Campaign companions and remote humans use independent extension actors with the original ROM models and native bombs, collisions and enemy damage. They are additional campaign characters implemented by this extension rather than extra native campaign controller ports.

## Play

For local offline play, serve the source assets with `python3 -m http.server 8080 --directory dist`, open `http://localhost:8080` and load your local `Bomberman (USA).pce`. Online rooms need the Worker/D1 deployment described below; the static local server does not provide its API.

Choose your color before starting. The original title screen contains these five choices:

| Main menu | Selection |
| --- | --- |
| **1P - CAMPAIGN** | Choose **HUMAN** or **AI**, then the world submenu: **1-0**, **2-0** through **8-0**. Start at the selected world's first regular stage. |
| **1P - DLC** | Generated larger campaign maps, with optional local AI/watch counts. |
| **2-5P - CAMPAIGN** | Choose **AI** or **ONLINE**. |
| **2-5P - BATTLE** | Choose **AI** or **ONLINE**; both use original Battle rules. |
| **LOAD SAVE** | Load the latest browser save; online campaign saves reopen the lobby. |

Use **Up/Down** to select, **Left/Right** to change player/watch counts and **Enter** to choose. In the world submenu, Left/Right also moves between worlds. **B/X** returns from a submenu. Click the game screen to focus keyboard controls without selecting a menu option. These choices use the ROM's loaded font, cursor and landscape inside the game screen. C-Link and PASSWORD are hidden; the native copyright line is eight game pixels lower. The former password entry was a stage code, replaced by the save controls.

The original campaign introduction remains available. **Space** skips it, including during its opening fade, without placing a bomb when gameplay begins. The selected color includes the rear-facing introduction pose.

**Main menu** holds an offline game in memory; **Continue game** returns to it. Starting another game replaces that session, so export a save first. For online recovery, return to a reconstructed lobby with the saved player roster.

| Action | Control |
| --- | --- |
| Menu / player count / choose | Up/Down / Left/Right / Enter |
| Move | Arrows / WASD |
| Place bomb | Space |
| Remote detonation / Button II | B or X |
| Skip opening | Space |
| Run / advance Battle results | Enter |
| Select | Shift |
| Paused local campaign inventory | F2 or Admin button |

After collecting **Remote Control**, your bombs wait for **B/X**. Native solo bombs detonate in placement order; online humans operate their own remote bombs. Local AI chooses its own safe detonation time. Click the canvas to focus controls. Leaving the game screen releases held keys; switching windows or hiding the tab also pauses play. Press Resume to continue a paused game.

## Online rooms

Choose Campaign → ONLINE or Battle → ONLINE. Enter your name and color, create a lobby and copy its invitation link, or enter a friend's room code and join. The roster shows each person's name, color and readiness. Every player loads the verified local ROM before connecting. The host starts after at least two players are ready and their peer connections are established; rooms support up to five players. The ROM is never sent to the lobby service or another browser.

In online campaign, each human has a separate actor, bomb inventory and camera. Clients receive the host's ordered input frames and simulate the same shared world. Teammates can share floor; bodies do not block passage. Beneficial campaign pickups improve everyone. A single death leaves surviving players in the round. Collected Extra Life powers revive actors before a total team defeat spends a native spare round. With no spare rounds left, the native death music, fade and game-over sequence end the session for everyone. Battle uses the original independent controller ports, movement and competitive pickup rules.

Lobby rosters, readiness and WebRTC signaling use same-origin HTTP requests, polled about once per second. Actual gameplay frames and the initial ROM-free emulator snapshot travel over ordered WebRTC data channels. The host samples each participant's latest input for each emulated frame; this version uses neither rollback nor client prediction. Runtime checksums every 120 frames detect divergence. A disconnect, frame-order error or checksum mismatch pauses play; recreate the lobby and load a saved campaign to recover.

The host's computer already controls the shared game; the hosted Worker handles the lobby rather than running the emulator. Guests also emulate every frame to keep their independent views. The status below the screen reports shared game speed (about 60 FPS is full speed), peer round-trip time when the browser provides it, and queued/outstanding frames. Host lag counts include frames in transit and guest processing; these readings help distinguish slow emulation from connection delay. Catch-up can omit an intermediate presentation and draw the next consumed frame fully, including when the time budget yields between them. No input frame is dropped.

A possible later mode would have the host emulate once and stream video/audio over WebRTC while guests send controls. [WebRTC's canvas-stream sample](https://webrtc.github.io/samples/src/content/capture/canvas-pc/) demonstrates the picture transport; [Web Audio](https://www.w3.org/TR/webaudio-1.0/#MediaStreamAudioDestinationNode) supplies an audio-stream output. This would remove guest emulator work, but still involve network and video encoding delay plus host upload capacity. A single stream shares the host camera. Separate camera streams require more host rendering and encoding, or a different protocol that sends drawable world state. This mode is a proposed option and is not implemented in this version.

The current peer configuration has a STUN server and **no TURN relay**. Some restrictive networks will fail to connect. Live browser play, two real computers, latency, reconnects, mobile controls and long online sessions have not been tested in this environment. Headless and mocked-browser checks are described below.

## Save and continue

- **Save progress** writes a quick save to this browser's IndexedDB. **Export save** downloads a `.bmsave` backup. Export before clearing browser data.
- Offline campaign, DLC, AI/watch and Battle saves restore the emulator and extension state at the saved position, paused. Press Resume to continue.
- For an **online campaign** save, create or re-create a lobby, reconnect the original players, and select the save through LOAD SAVE/import or the host's lobby save picker. The lobby shows the saved level and roster. Start reloads that level from its beginning with the saved shared upgrades, fresh enemies and a fresh board. It does not resume a partially cleared online level.
- Returning players are matched by their random IDs kept in their original browser's local storage. Clearing that storage or switching browser profiles changes identity; the saved roster will no longer match. Keep the save backup and the same browser profiles for this version.
- Save files contain CPU/RAM/video/audio synthesis state, actor plans and powers, colors, stage progress, generated-map state and online roster metadata. They do not contain the ROM. Raw save files stay local or are sent directly between connected peers at launch; the lobby database stores only a bounded stage/roster header and signaling.

Save imports require the same ROM revision and compatible extension/core format, and validate bounded state before applying it. The live audio output buffer clears on restoration. Some older offline saves have defaults for newly added optional fields; incompatible or corrupt files are rejected.

## DLC maps and campaign objectives

The **DLC** entry is the former NEW campaign. Seeded maps grow from native bounds 27×21 to 31×29, with more breakable blocks and 14–28 native monsters according to round/team size. The starting area is protected, useful pickups are scattered and the blue exit is hidden. This currently uses the opening world's loaded tiles and Ballom model, with original music, bombs, explosions and pickups. Difficulty increases through map size and density; comparison with every original late stage and boss remains untested. Generated seed, round and transition state survive offline saves.

After killing every monster, bomb the glowing breakable wall, wait for the flames to clear and collect its required Bomb Up. Then uncover/reach the blue exit. This shared final-item objective also applies to the original campaign. If the required item burns, it reappears after the flames clear. Bots target the wall and pickup before the exit; living enemies prevent early exit. Explosion cleanup restores green floor, including previously collected item tiles and areas beyond the original map bounds.

Clears and defeats run native music, animation, black fades and stage cards before loading the next or retried stage. Human offline lives/game over follow original rules. AI-only teams retry through the native sequence when every actor is defeated, preserving watch count and, in DLC, the current seed and round. One defeated actor does not restart a surviving watched team.

## Colors and HUD

Choose white, black, blue, green, red, violet, orange or yellow. Nonwhite variants tint the helmet and original blue body, with face-colored arms/legs and shading. Gloves/boots stay pink except **red**, whose ends are green. Original white retains its native appearance. The lives head matches all selected helmet pixels, including the former white highlights, while face, outlines and HUD border keep their native colors.

Score digits align left, and time/lives also move left. Acquired power-up totals occupy the right in two rows of **8-pixel HUD icons**; world pickups and full-size icon lists retain their native 16-pixel artwork. Entries page only when large totals exceed the available space. Counts are cumulative pickups, rather than a promise that temporary effects remain active. Counters and page timing are saved; older offline saves begin new counters at zero.

## Local inventory and cooperating AI

In a local campaign stage, **F2/Admin** pauses play. Select a tool once, then click multiple empty tiles to place copies. Clicking the selected tool or Deselect stops placement. Closing clears the tool and restores the preceding pause/running state. Online gameplay disables this local inventory so clients cannot mutate their shared simulation independently.

The inventory has all 15 native item IDs and icons for all 45 living enemy actor models, including boss forms/parts. **All 23 regular enemy types can spawn in any active campaign stage, even after the last native enemy dies.** They use their native initialization, movement and bomb damage. Their runtime graphics remain private to their sprites so mixed species do not replace player or stage art. Boss entries remain previews: spawning a component alone would omit the coordinated actor groups and shared state of a complete boss encounter. Original slot limits still apply. A spawned item takes effect when collected; the fireproof vest protects against bomb blasts for about 60 seconds, while monsters still hurt its wearer.

Local AI uses separate targets for useful items, blocks and enemy bombing positions. Routes prefer free lanes, while teammates may pass through or temporarily overlap one another in narrow spaces. A pending bomber holds its firing position and asks teammates to reach shelter; placement still waits until their current and intended next cells clear its blast. Bots retain terrain collision, monster prediction, escape routes, visible-item protection and final-item-before-exit priorities. Safe next-round positions stay connected to the original entrance instead of falling back to isolated floor pockets. AI remains experimental and can still be defeated.

Beneficial **campaign team** pickups are shared across the native human and every AI/online teammate. Fire range and bomb allowance cap at five per actor in cooperative modes; each actor keeps its own active bomb slots. Shoes match the native increase from 0.75 to 1 pixel per frame and do not stack. Remote/pass powers, vest duration and extra-life rewards reach the team; lives are consumed individually. Skull curses are excluded from shared rewards. A new teammate inherits the team's current upgrades. Original one-player pickup behavior remains native until a cooperative team is added; Battle remains competitive.

Bots prioritize useful reachable pickups, avoid skulls, and reject bombs that would destroy visible items. They predict nearby monster movement and patrol corridors, approach useful bombing openings and seek the exit after enemies and the required item are handled. Death uses the native 104-frame sprite animation and sound; walking requests native step sounds only when feet move. Extra-life revival searches safe unoccupied floor and waits if none exists. Their state, goal claims, yielding, motion history, powers and bomb ranges replay through offline saves. Native enemy targeting of extension actors and full boss encounters still need further work.

Choose **AI only — watch 1, 2, 3 or 4 bots** through the count selector or native Left/Right count choices. Campaign/DLC support all four choices; Battle watching requires at least two actors. The hidden native human receives no controls or shared pickup rewards; the camera follows a living actor. Local admin AI can also be added to a solo campaign with random colors, including white.

## Hosting and verification

`server/lobby.js` is a Cloudflare Worker/D1 room API. Its schema and immutable migration journal are under `drizzle/`. `scripts/build-online-site.mjs` embeds the existing `dist/` assets into a single Worker, retains the Site identity, and writes Worker/migration deployment metadata without deleting source assets. Worker hosting requires `d1: "DB"` and no `static` declaration in `.openai/hosting.json`. Serve static `dist/` only for offline development. No separate Node game server is needed for this transport.

No paid hosting budget has been selected. Measure lobby queries, active room/player counts, signaling volume, peer frame traffic and any future TURN relay traffic before estimating costs. D1 handles lobby records/signaling, not 60 Hz gameplay. See the [co-op plan](docs/coop-plan.md) for acceptance checks and remaining release work.

Run dependency-free Node checks with an external ROM:

```sh
BOMBERMAN_TEST_ROM=/absolute/path/to/game.pce npm test
```

Tests cover native menu/world navigation, colors/intro/lives pixels, compact HUD scaling without world-art changes, unrestricted native enemy initialization and compositor replay, shared pickup effects and pending-handler saves, AI goal/reservation/yielding and bomb guards, native transitions, camera separation, independent remote actor movement/bombs/deaths and offline save replay. A 10,000-frame two-machine replay test compares CPU/RAM/actor state while local views differ and exercises team deaths/retries. SQLite-backed server tests execute the production migration and SQL for authorization, bounded bodies, concurrent seats/start races, signaling privacy/order/expiry, saved rosters and reproducible Worker builds. Mocked browser-app tests connect separate app contexts, synchronize human inputs and reconstruct an online saved roster. These checks do not replace real-browser, audible sound, fullscreen, physical gamepad, mobile or two-computer QA.

Research helpers take outputs outside this repository:

```sh
node scripts/investigate.mjs /absolute/path/to/game.pce /outside/repository/output
node scripts/headless.mjs /absolute/path/to/game.pce /outside/repository/output
```

Do not commit ROMs, decoded artwork/music, screenshots, RAM dumps, traces or save files. The game file is read in browser memory; no ROM upload endpoint exists. A ROM contains compiled code, so original source names/comments/build files cannot be recovered automatically. See [research findings](docs/research.md).

## Emulator provenance

[yhzmr442/jspce](https://github.com/yhzmr442/jspce), pinned to `d4339bae5fb2253b8b3d110e256405d928a3afc4`. `dist/vendor/pce.js` preserves upstream `PCE.js` with an ES-module export appended; its MIT license is included.

Native [Beetle PCE Fast](https://github.com/libretro/beetle-pce-fast-libretro) provided independent reference checks and is not bundled. Application code is MIT licensed. This independent project does not provide a license to the original game.
