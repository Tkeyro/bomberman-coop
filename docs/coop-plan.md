# Cooperative campaign plan

## Product target

Two people on separate computers play the original 1990 TurboGrafx-16 campaign together. The first release targets two independent Bombermen, each with a chosen color. Solo remains available for testing. Original local Battle mode remains a separate option.

Proposed starting rules: shared stage objectives; each player owns their bomb limit and power-ups; both players can be harmed by explosions. Death, revival and shared-life rules need a playtest once the second player is working. These are proposed defaults, not features in v0.1.

## Milestones and acceptance checks

1. **Original browser baseline — implemented for solo testing.** Exact local ROM check, original emulation, menu color selection, controller inputs and research traces. Browser audio/gamepad QA remains outstanding.
2. **Second local campaign actor.** Trace the complete player-update and rendering paths; reserve independent state; execute the original movement/collision rules for both actors. Pass a test where player 2 moves while player 1 stays still, and both collide correctly with pillars and breakable blocks. No decorative overlay or duplicated controller input counts as success.
3. **Shared campaign simulation.** Add bomb ownership, bomb capacity, explosion damage, enemies targeting both players, power-up collection, death/revival and stage-exit rules. Pass tests for simultaneous bombs, player death, pickup contention, stage clear and boss transitions before adding network play.
4. **Deterministic replay.** Record frame-numbered inputs, compare simulation checksums, and implement complete emulator-state snapshots. Test at least 10,000-frame replays, patch-version mismatch rejection and recovery from intentional desync. The current browser core has no implemented save-state API.
5. **Invitation rooms.** Host creates a two-player room; guest opens the link, selects the same local ROM revision, chooses a color and joins the next safe stage boundary. Initial transport proposal is a WebSocket room service carrying frame-numbered inputs. Each browser runs the same emulator and co-op extension. Network delay, reconnection and host ownership require implementation and testing.
6. **Public release.** Verify real browser/audio/gamepads, two remote computers, latency and disconnections; publish public source and choose hosting using measured room traffic.

## Engineering approach

Prioritize a small, inspectable extension around the original game routines. The identified movement dispatcher hardcodes one player block. Investigate context switching that block around player updates, or replacing the dispatcher with two indexed actor states. Choose the approach only after mapping side effects in bombs, rendering, damage and stage transitions.

Keep changes in source-controlled scripts/patch descriptions, applied in memory to the verified user-supplied revision. Never commit the ROM, game graphics, music, extracted RAM, screenshots or save states. Every player supplies the game file locally. A public repository does not make the original game downloadable from the site.

Original source code cannot be recovered verbatim from the ROM; build an annotated map of compiled routines and test each change against the original engine.

## Hosting estimate plan

The solo player is static hosting and uses no multiplayer server. Its emulator JavaScript is about 85 KB before compression; the game ROM is loaded locally.

For an input-only online prototype, an illustrative packet budget of 64 bytes × 60 packets/second × 2 players gives about 7.5 KiB/second of input payload arriving at the room server, plus outgoing traffic and protocol overhead. This is an engineering assumption, not a measured requirement. Coalescing inputs should lower packet overhead. Audio/video are generated locally rather than streamed.

Measure active rooms, packet size, relay egress, reconnect snapshots, runtime CPU and client frame time before selecting a provider or pricing a plan. Delay paid hosting decisions until local co-op and deterministic replay pass their tests.

## Repository target

Public repository: `Tkeyro/bomberman-coop`. Source is published independently of the original game file.
