# Bomberman Co-op Lab

Browser research project for **Bomberman (1990), TurboGrafx-16, USA**. The main goal is two people on separate computers cooperating in the original campaign, with a color chooser before play.

**v0.1 is a solo testing checkpoint. Campaign co-op and online rooms are not implemented.** The emulator's extra controller ports do not create extra campaign characters.

## Try it

1. Serve `dist/` with any static HTTP server, for example `python3 -m http.server 8080 --directory dist`.
2. Open `http://localhost:8080` and choose your local `Bomberman (USA).pce` file.
3. Choose a color, click **Start game**, focus the screen and press Enter at the original title/menu.
4. Select NORMAL for the campaign. The original introduction takes about 40 seconds.

Your ROM is read in browser memory. There is no upload endpoint, bundled ROM, extracted game artwork, music, or saved game state in this repository. Reloading the page requires selecting the ROM again. This build checks the exact USA revision; other releases are rejected to prevent applying research assumptions to incompatible bytes.

| Action | Player 1 | Player 2, original Battle mode only |
| --- | --- | --- |
| Movement | Arrows / WASD | IJKL |
| Button I / bomb | Space | O |
| Button II | X | P |
| Run / start | Enter | 2 |
| Select | Shift | 1 |

The core also polls gamepads for five native controller ports. Select Battle mode in the original game for local multiplayer; this is distinct from the planned cooperative campaign. Multi-gamepad browser testing remains outstanding.

## Color selection

Original white, blue, green, red and violet are selectable in the browser session menu. This changes grayscale suit colors in the emulator's rendering cache, preserving the original ROM and numeric game palette. The first campaign stage is verified; later stages and Battle mode recoloring are not yet supported or verified.

## Research and verification

`npm test` runs dependency-free Node tests. For the ROM-backed integration checks:

```sh
BOMBERMAN_TEST_ROM=/absolute/path/to/game.pce npm test
```

The game file must remain outside the repository. Tests verify revision rejection, palette restoration, bounded RAM tracing, original campaign boot, movement, and controller 2's lack of a campaign character. A small mocked-DOM test checks loader and control wiring; it is **not real browser QA**. Audio, fullscreen, actual gamepads and mobile usability still need browser tests.

Local investigation helpers:

```sh
node scripts/investigate.mjs /absolute/path/to/game.pce /outside/repository/output
node scripts/headless.mjs /absolute/path/to/game.pce /outside/repository/output
```

Outputs contain game RAM and video. Keep them outside the public repository. Browser research tools download an 8 KiB RAM dump or a bounded 120-frame trace of writes to candidate player state.

See [research findings](docs/research.md) and the [co-op implementation plan](docs/coop-plan.md). A ROM contains compiled machine code, not the original source files. Reverse engineering can recover routines and behavior; original names, comments and build source are not recovered automatically.

## Emulator provenance

The browser uses [yhzmr442/jspce](https://github.com/yhzmr442/jspce), pinned to `d4339bae5fb2253b8b3d110e256405d928a3afc4`. `dist/vendor/pce.js` preserves upstream `PCE.js` with an ES-module export appended. Its MIT license is included in `dist/vendor/JSPCE-LICENSE.txt`.

A separate, native [Beetle PCE Fast](https://github.com/libretro/beetle-pce-fast-libretro) build was used for reference checks and is not bundled here. These checks confirmed the stage layout and player-coordinate behavior independently.

Application code is MIT licensed. This is an independent experimental project and does not provide a license to the original game.
