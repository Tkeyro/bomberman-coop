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

The emulator and controls were exercised headlessly in Node and through mocked DOM events. No real browser, audio output, fullscreen, gamepad or remote multiplayer QA was performed in this environment. The site currently has no online transport and no second campaign character.
