# Cooperative campaign plan

## Product target and current checkpoint

**v0.4.0 implements 2–5 human campaign actors on separate computers through invitation lobbies, plus local cooperative AI and original Battle with AI or online controller ports.** All players supply the same verified USA ROM, choose colors and share campaign stage objectives and beneficial upgrades. Each actor owns its active bomb inventory. Explosions can hurt teammates. A defeated player waits while another survives; a full team defeat enters native death music, fades and a same-stage retry.

The native title menu is now 1P - CAMPAIGN, 1P - DLC, 2-5P - CAMPAIGN, 2-5P - BATTLE and LOAD SAVE. One-player campaign opens a world picker labeled 1-0 through 8-0; multiplayer campaign/Battle offer AI and ONLINE submenus. DLC preserves generated larger maps and optional AI/watch counts. Watching one through four campaign bots remains supported.

The current implementation is a prototype validated headlessly and through mocked app contexts. Real-browser audio/layout/gamepads, two physical computers, network latency, restrictive NAT, reconnects, bosses, mobile use and long gameplay sessions remain release checks. Native monsters still use original targeting routines rather than explicitly choosing among extension actors.

## Shared gameplay

Campaign humans, AI and remote actors share useful pickup rewards: fire range, bomb allowance, shoes, remote control, pass abilities, vest and extra-life grants. Cooperative fire/bomb limits cap at five per actor, and slots remain separate. Extra lives are spent individually. Skull curses are not shared. Original solo pickup behavior remains native until a cooperative crew is added; original Battle stays competitive.

AI teammates claim separate useful objectives, reserve current/next movement cells, yield around conflicting routes and avoid placing bombs across a teammate's current or intended next cell. Monster/blast retreat and protecting visible pickups take precedence. Killing all monsters reveals a required-item wall; the team collects its item before reaching the exit. Saved goal/yield state keeps offline replay deterministic. These precautions reduce collisions and friendly fire rather than guaranteeing victory.

## Independent online cameras

Each online browser follows its assigned living Bomberman, with survivor fallback after defeat. Players can move apart and see different portions of one map. Bombs, monsters, pickups and stage progress belong to the shared simulation; transitions happen together.

| Shared simulation | Local presentation |
| --- | --- |
| Actor IDs, positions, damage and input edges | Browser's selected follow actor |
| Bomb ownership, timers and placement-time range | Camera offset used while composing pixels |
| Monsters, terrain, powers and objectives | Screen size, themed render caches and audio settings |
| Canonical camera, stage loads, death/clear sequence | Rendered player view |

`online-campaign.js` computes native collision/overflow flags at the canonical camera, then renders local sprite/background views with temporary offsets. RAM camera bytes, SATB coordinates and hardware flags are restored before native CPU execution resumes. Local camera selection is not saved simulation state or part of the gameplay checksum. A 10,000-frame replay fixture runs identical inputs in two machines with different local actors, compares shared CPU/RAM/actor state and checks that views differ.

## Lobby, transport and saves

Worker/D1 endpoints create/join/update/read/start/leave rooms and carry WebRTC signaling over same-origin HTTP. Lobby polling is about once per second. Member tokens are random 256-bit secrets stored only as hashes in D1; player IDs are separate random stable browser identifiers. Rooms enforce 2–5 seats, matching ROM hash and patch revision, ready/connected participants and host-only start/checkpoint selection. Conditional generation checks protect starts from concurrent roster changes.

The host establishes an ordered WebRTC data channel to each guest. It sends a validated ROM-free launch snapshot directly to peers, waits for load acknowledgements, then broadcasts one ordered input frame per emulated frame. Guest input changes update the host's current input set. Clients run the same emulator and campaign extension; no rollback/prediction is implemented. CPU/RAM/extension checksums every 120 frames and strict frame numbering detect divergence. Disconnects, order errors and mismatches pause gameplay; recreate the room and load a campaign checkpoint to recover.

Online save files keep the complete local state, but reopening one prepares a **fresh-level** campaign checkpoint: saved world/area, original roster and current shared upgrades. The lobby shows that stage and player list, requires the original IDs to rejoin, then rebuilds the level from scratch when the host starts. Partly destroyed terrain, positioned bombs and defeated monsters are not resumed online. Offline saves continue at their exact saved position. Returning online players must retain the same browser profiles/local storage in this version; identity replacement/migration is not implemented.

D1 stores bounded room/roster records, signaling and checkpoint headers. It never receives the ROM, raw emulator save, game pixels or extracted music/art. Initial emulator snapshots travel only between connected peers. The current WebRTC configuration uses STUN without TURN, so some networks cannot connect. A TURN relay and measured traffic remain necessary decisions for reliable broad access.

## Acceptance checks

| Area | Implemented checks | Remaining checks |
| --- | --- | --- |
| Original gameplay and menus | Native boot, world load, color/intro/HUD pixels and menu routing | Real browser controls/audio and later-world/boss visuals |
| Independent actors | Separate human movement, wall collision, bomb banks, input edges, remote detonation and death animations | Full campaigns, monster targeting and boss encounters |
| Cooperation | Shared/native pending pickups, useful-item targets, reservations, yielding, friendly bomb guards and final-item ordering | Long crowded maps and human/AI mixed play |
| Determinism and cameras | 10,000 ordered frames in two machines, differing views, shared state and saved input edges | Sustained remote latency, deliberate runtime desync and recovery UX |
| Rooms and saves | Real SQLite migration/API tests, concurrent seats/start races, separate mocked app contexts and saved-roster reconstruction | Two computers, real WebRTC, restrictive NAT, disconnect/rejoin and profile migration |
| Release | Public ROM-free source and buildable Worker/D1 transport | Broad access and hosting/TURN budget based on measured usage |

## Hosting estimate plan

The Site moves from static-only hosting to a Worker with a provisioned D1 binding. Offline static development remains available. Game simulation, music and pixels run locally. D1 handles roster/signaling polls, never 60 Hz gameplay frames; gameplay uses peer-to-host channels.

An illustrative 64-byte input/frame packet at 60 frames per second is about 3.75 KiB/s per recipient, excluding JSON/protocol overhead, guest input changes, initial snapshots and any TURN relay overhead. This is an assumption, not a measured packet size or hosting quote. The implementation sends one host frame to every guest, so host egress grows with room size.

Measure active rooms, polling queries, signal size/count, host/guest frame traffic, snapshot transfers, client frame time and future relay egress before selecting a paid budget. No paid plan or external TURN service has been chosen.

## Source and research

Public repository: [Tkeyro/bomberman-coop](https://github.com/Tkeyro/bomberman-coop). Source is published independently of the original game file. Keep patches/hooks in source, applied in memory to the verified user-provided revision. Never commit ROMs, decoded graphics/music, screenshots, RAM, traces or saves.

The identified original movement dispatcher hardcodes one campaign player. v0.4.0 uses independent extension actors for all online humans and retains native sprite/bomb/enemy routines; native competitive Battle still uses its real controller ports. Original source code cannot be recovered verbatim, so maintain the annotated routine map and behavioral tests in [research findings](research.md).
