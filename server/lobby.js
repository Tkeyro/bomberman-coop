// Lobby records and WebRTC signaling only. ROM bytes and emulator saves stay local.
const COLORS = new Set(['original', 'black', 'blue', 'green', 'red', 'violet', 'orange', 'yellow']);
const TRANSPORTS = new Set(['sync', 'stream']);
const ID = /^[A-Za-z0-9_-]{16,64}$/;
const HASH = /^[a-f0-9]{64}$/i;
const CODE = /^[A-Z0-9]{3,12}$/;
const ROOM_LIFETIME = 30 * 60_000;
const CONNECTED_FOR = 45_000;
const MEMBER_LIFETIME = 120_000;
const SIGNAL_LIFETIME = 120_000;
const MAX_BODY = 16_384;

class LobbyError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new LobbyError(status, message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function keys(value, allowed) {
  if (!object(value)) fail(400, 'Expected a JSON object.');
  if (Object.keys(value).some(key => !allowed.includes(key))) fail(400, 'Unknown field.');
}
function textValue(value, label, min, max, pattern) {
  if (typeof value !== 'string' || value.length < min || value.length > max || (pattern && !pattern.test(value))) fail(400, `Invalid ${label}.`);
  return value;
}
function integer(value, label, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) fail(400, `Invalid ${label}.`);
  return value;
}
function color(value) { if (!COLORS.has(value)) fail(400, 'Unknown Bomberman color.'); return value; }
function name(value) {
  const result = textValue(value, 'player name', 1, 32).trim();
  if (!result || /[\u0000-\u001f\u007f]/.test(result)) fail(400, 'Invalid player name.');
  return result;
}
function identity(body) {
  return {
    id: textValue(body.playerId ?? body.savedPlayerId, 'player ID', 16, 64, ID),
    name: name(body.name), color: color(body.color),
    revision: textValue(body.revision, 'game revision', 1, 64, /^[A-Za-z0-9._-]+$/),
    romHash: textValue(body.romHash, 'ROM hash', 64, 64, HASH).toLowerCase(),
  };
}
function validateCheckpoint(value, room) {
  keys(value, ['world', 'area', 'players', 'savedAt', 'revision', 'mode']);
  const world = integer(value.world, 'saved world', 0, 7);
  const area = integer(value.area, 'saved stage', 0, 7);
  if (!Array.isArray(value.players) || value.players.length < 2 || value.players.length > room.slots) fail(400, 'Saved player roster must contain 2–5 players.');
  const seen = new Set();
  const players = value.players.map(player => {
    keys(player, ['id', 'name', 'color']);
    const id = textValue(player.id, 'saved player ID', 16, 64, ID);
    if (seen.has(id)) fail(400, 'Saved player IDs must be unique.');
    seen.add(id);
    return { id, name: name(player.name), color: color(player.color) };
  });
  if (value.revision !== undefined && value.revision !== room.patch_revision) fail(409, 'Save uses a different game revision.');
  if (value.mode !== undefined && value.mode !== room.mode) fail(409, 'Save uses a different game mode.');
  if (value.savedAt !== undefined && (!Number.isSafeInteger(value.savedAt) || value.savedAt < 0)) fail(400, 'Invalid save date.');
  return { world, area, players, ...(value.savedAt === undefined ? {} : { savedAt: value.savedAt }), revision: room.patch_revision, mode: room.mode };
}
async function bodyJSON(request) {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY) fail(413, 'Request is too large.');
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') fail(415, 'Use application/json.');
  if (!request.body) fail(400, 'A JSON body is required.');
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BODY) { await reader.cancel(); fail(413, 'Request is too large.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let parsed;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail(400, 'Invalid JSON.'); }
  if (!object(parsed)) fail(400, 'Expected a JSON object.');
  return parsed;
}
function response(value, status = 200) {
  return Response.json(value, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}
function randomHex(bytes) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}
function roomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(10)), byte => alphabet[byte & 31]).join('');
}
function requestedCode(value) {
  if (value === undefined) return null;
  if (typeof value !== 'string') fail(400, 'Use a room key with 3–12 letters or numbers.');
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^[A-Za-z0-9]{3,12}$/.test(trimmed)) fail(400, 'Use a room key with 3–12 letters or numbers.');
  return trimmed.toUpperCase();
}
async function tokenHash(token) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))), byte => byte.toString(16).padStart(2, '0')).join('');
}
function statement(db, sql, values = []) { return db.prepare(sql).bind(...values); }
async function first(db, sql, values) { return statement(db, sql, values).first(); }
async function all(db, sql, values) { return (await statement(db, sql, values).all()).results; }
async function run(db, sql, values) { return statement(db, sql, values).run(); }
function changes(result) { return result?.meta?.changes ?? 0; }
function publicPlayer(player, room, now) {
  return { id: player.player_id, name: player.name, color: player.color, ready: Boolean(player.ready), connected: now - player.last_seen <= CONNECTED_FOR, isHost: player.id === room.host_member_id };
}
async function roomResult(db, room, now) {
  // SQLite rowid preserves insertion order when several people join during the
  // same millisecond. The host is always the first player/controller port.
  const players = await all(db, 'SELECT * FROM bm_members WHERE room_code = ? AND EXISTS (SELECT 1 FROM bm_rooms WHERE code = ? AND host_member_id = ?) ORDER BY joined_at, rowid', [room.code, room.code, room.host_member_id]);
  if (!players.some(player => player.id === room.host_member_id)) fail(410, 'Lobby was closed. Join again.');
  return {
    code: room.code, hostId: players.find(player => player.id === room.host_member_id)?.player_id ?? null,
    mode: room.mode, transport: room.transport, world: room.world, slots: room.slots, revision: room.patch_revision,
    romHash: room.rom_hash, status: room.status, generation: room.generation,
    players: players.map(player => publicPlayer(player, room, now)),
    checkpoint: room.checkpoint_json ? JSON.parse(room.checkpoint_json) : null,
    startId: room.start_id, startedAt: room.started_at, expiresAt: room.expires_at,
  };
}
async function readRoom(db, code, now, expectedHost) {
  const room = await first(db, 'SELECT * FROM bm_rooms WHERE code = ?', [code]);
  if (!room || room.expires_at <= now) fail(404, 'Lobby was not found or has expired.');
  if (expectedHost !== undefined && room.host_member_id !== expectedHost) fail(410, 'Lobby was closed. Join again.');
  return room;
}
async function authenticate(request, db, room, now) {
  const token = request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/i)?.[1];
  if (!token) fail(401, 'A lobby membership token is required.');
  const member = await first(db, 'SELECT * FROM bm_members WHERE room_code = ? AND token_hash = ?', [room.code, await tokenHash(token)]);
  if (!member) fail(403, 'This token does not belong to the lobby.');
  if (member.id !== room.host_member_id && now - member.last_seen > MEMBER_LIFETIME) fail(410, 'Membership expired. Join the lobby again.');
  // Polling counts as a heartbeat, but writes are limited to once per 15 seconds.
  if (now - member.last_seen >= 15_000) {
    await run(db, 'UPDATE bm_members SET last_seen = ? WHERE id = ?', [now, member.id]);
    member.last_seen = now;
    if (member.id === room.host_member_id) {
      await run(db, 'UPDATE bm_rooms SET expires_at = ? WHERE code = ? AND host_member_id = ?', [now + ROOM_LIFETIME, room.code, room.host_member_id]);
      room.expires_at = now + ROOM_LIFETIME;
    }
  }
  return member;
}
function hostOnly(member, room) { if (member.id !== room.host_member_id) fail(403, 'Only the lobby host can do this.'); }
function pendingOnly(room) { if (room.status !== 'lobby') fail(409, 'This game has already started.'); }
function validateSignal(body) {
  keys(body, ['to', 'type', 'data']);
  textValue(body.to, 'signal recipient', 16, 64, ID);
  if (!['offer', 'answer', 'ice'].includes(body.type)) fail(400, 'Unknown signal type.');
  if (body.type === 'ice') {
    if (body.data !== null) {
      keys(body.data, ['candidate', 'sdpMid', 'sdpMLineIndex', 'usernameFragment']);
      textValue(body.data.candidate, 'ICE candidate', 0, 2048);
      for (const key of ['sdpMid', 'usernameFragment']) if (body.data[key] !== undefined && body.data[key] !== null) textValue(body.data[key], key, 0, 256);
      if (body.data.sdpMLineIndex !== undefined && body.data.sdpMLineIndex !== null) integer(body.data.sdpMLineIndex, 'ICE media index', 0, 255);
    }
  } else {
    // Accept the browser's RTCSessionDescriptionInit and a plain SDP string.
    if (typeof body.data === 'string') textValue(body.data, 'session description', 1, 12_000);
    else {
      keys(body.data, ['type', 'sdp']);
      if (body.data.type !== body.type) fail(400, 'Session description type does not match.');
      textValue(body.data.sdp, 'session description', 1, 12_000);
    }
  }
  return JSON.stringify({ type: body.type, data: body.data });
}

export function createLobbyHandler({ now = () => Date.now() } = {}) {
  return async function lobby(request, env) {
    try {
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/$/, '');
      const match = path.match(/^\/api\/rooms(?:\/([A-Za-z0-9]{3,12})(?:\/(join|member|heartbeat|leave|signals|start|checkpoint))?)?$/);
      if (!match) return response({ error: 'Endpoint not found.' }, 404);
      if (!env.DB) return response({ error: 'Online rooms are unavailable.' }, 503);
      if (!['GET', 'HEAD'].includes(request.method)) {
        const origin = request.headers.get('origin');
        if ((origin && origin !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site') fail(403, 'Use this lobby from the same website.');
      }
      const db = env.DB.withSession ? env.DB.withSession('first-primary') : env.DB;
      const timestamp = now();
      const code = match[1]?.toUpperCase();
      const action = match[2];
      if (!code) {
        if (request.method !== 'POST') fail(405, 'Use POST to create a lobby.');
        const body = await bodyJSON(request);
        keys(body, ['name', 'color', 'playerId', 'revision', 'romHash', 'mode', 'transport', 'world', 'slots', 'checkpoint', 'code']);
        const customCode = requestedCode(body.code);
        const player = identity(body);
        if (!['campaign', 'battle'].includes(body.mode)) fail(400, 'Unknown game mode.');
        const transport = body.transport === undefined ? 'sync' : body.transport;
        if (!TRANSPORTS.has(transport)) fail(400, 'Unknown online transport.');
        const world = integer(body.world ?? 0, 'world', 0, 7);
        const slots = integer(body.slots ?? 5, 'player limit', 2, 5);
        const room = { code: customCode, host_member_id: randomHex(16), mode: body.mode, transport, world, slots, patch_revision: player.revision, rom_hash: player.romHash, status: 'lobby', generation: 0, created_at: timestamp, expires_at: timestamp + ROOM_LIFETIME, checkpoint_json: null, start_id: null, started_at: null };
        if (body.checkpoint !== undefined && body.checkpoint !== null) {
          const saved = validateCheckpoint(body.checkpoint, room);
          if (!saved.players.some(savedPlayer => savedPlayer.id === player.id)) fail(409, 'The host must belong to the saved player roster.');
          room.world = saved.world;
          room.checkpoint_json = JSON.stringify(saved);
        }
        const token = randomHex(32);
        const hashedToken = await tokenHash(token);
        for (let attempt = 0; attempt < (customCode ? 1 : 5); attempt++) {
          room.code = customCode ?? roomCode();
          // Allocation and membership are one atomic batch. A racing creator
          // cannot overwrite a room or attach their member to its existing host.
          const results = await db.batch([
            statement(db, 'DELETE FROM bm_rooms WHERE code IN (SELECT code FROM bm_rooms WHERE expires_at <= ? ORDER BY expires_at LIMIT 100)', [timestamp]),
            statement(db, 'INSERT INTO bm_rooms (code,host_member_id,mode,transport,world,slots,patch_revision,rom_hash,status,generation,created_at,expires_at,checkpoint_json) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM bm_rooms WHERE code = ?)', [room.code, room.host_member_id, room.mode, room.transport, room.world, slots, player.revision, player.romHash, 'lobby', 0, timestamp, room.expires_at, room.checkpoint_json, room.code]),
            statement(db, 'INSERT INTO bm_members (id,room_code,player_id,name,color,ready,token_hash,joined_at,last_seen) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM bm_rooms WHERE code = ? AND host_member_id = ?)', [room.host_member_id, room.code, player.id, player.name, player.color, 1, hashedToken, timestamp, timestamp, room.code, room.host_member_id]),
          ]);
          if (changes(results[1])) return response({ room: await roomResult(db, room, timestamp), token, playerId: player.id }, 201);
          if (customCode) fail(409, 'That room key is already in use. Choose another key.');
        }
        fail(503, 'Could not assign a room key. Try again.');
      }
      if (!CODE.test(code)) fail(404, 'Lobby was not found.');
      let room = await readRoom(db, code, timestamp);
      if (action === 'join') {
        if (request.method !== 'POST') fail(405, 'Use POST to join a lobby.');
        pendingOnly(room);
        const body = await bodyJSON(request);
        keys(body, ['name', 'color', 'playerId', 'savedPlayerId', 'revision', 'romHash']);
        const player = identity(body);
        if (player.revision !== room.patch_revision || player.romHash !== room.rom_hash) fail(409, 'Use the same ROM and game revision as the host.');
        if (room.checkpoint_json && !JSON.parse(room.checkpoint_json).players.some(saved => saved.id === player.id)) fail(409, 'This save requires its original player roster.');
        const token = randomHex(32), memberId = randomHex(16);
        const result = await db.batch([
          statement(db, "DELETE FROM bm_members WHERE room_code = ? AND id != ? AND last_seen < ? AND EXISTS (SELECT 1 FROM bm_rooms WHERE code = ? AND host_member_id = ? AND status = 'lobby')", [code, room.host_member_id, timestamp - MEMBER_LIFETIME, code, room.host_member_id]),
          statement(db, "INSERT INTO bm_members (id,room_code,player_id,name,color,ready,token_hash,joined_at,last_seen) SELECT ?,?,?,?,?,0,?,?,? WHERE EXISTS (SELECT 1 FROM bm_rooms WHERE code = ? AND host_member_id = ? AND status = 'lobby' AND checkpoint_json IS ?) AND (SELECT COUNT(*) FROM bm_members WHERE room_code = ?) < ? AND NOT EXISTS (SELECT 1 FROM bm_members WHERE room_code = ? AND player_id = ?)", [memberId, code, player.id, player.name, player.color, await tokenHash(token), timestamp, timestamp, code, room.host_member_id, room.checkpoint_json, code, room.slots, code, player.id]),
          statement(db, 'UPDATE bm_rooms SET generation = generation + 1 WHERE code = ? AND host_member_id = ? AND EXISTS (SELECT 1 FROM bm_members WHERE id = ?)', [code, room.host_member_id, memberId]),
        ]);
        if (!changes(result[1])) fail(409, 'Lobby is full, already started, or this player has already joined.');
        room = await readRoom(db, code, timestamp, room.host_member_id);
        return response({ room: await roomResult(db, room, timestamp), token, playerId: player.id }, 201);
      }
      const member = await authenticate(request, db, room, timestamp);
      if (!action && request.method === 'GET') {
        const rawAfter = url.searchParams.get('after') ?? '0';
        if (!/^\d{1,16}$/.test(rawAfter) || !Number.isSafeInteger(Number(rawAfter))) fail(400, 'Invalid signal cursor.');
        const signals = await all(db, 'SELECT id,from_player_id,to_player_id,payload_json FROM bm_signals WHERE room_code = ? AND to_player_id = ? AND id > ? AND created_at > ? AND EXISTS (SELECT 1 FROM bm_rooms WHERE code = ? AND host_member_id = ?) ORDER BY id LIMIT 128', [code, member.player_id, Number(rawAfter), timestamp - SIGNAL_LIFETIME, code, room.host_member_id]);
        return response({ room: await roomResult(db, room, timestamp), signals: signals.map(signal => ({ id: signal.id, from: signal.from_player_id, to: signal.to_player_id, ...JSON.parse(signal.payload_json) })), lastId: signals.at(-1)?.id ?? Number(rawAfter) });
      }
      if (action === 'member' && request.method === 'PATCH') {
        pendingOnly(room);
        const body = await bodyJSON(request);
        keys(body, ['name', 'color', 'ready']);
        if (!Object.keys(body).length) fail(400, 'Choose a member field to update.');
        if (body.ready !== undefined && typeof body.ready !== 'boolean') fail(400, 'Ready must be true or false.');
        const results = await db.batch([
          statement(db, "UPDATE bm_members SET name = ?, color = ?, ready = ?, last_seen = ? WHERE id = ? AND EXISTS (SELECT 1 FROM bm_rooms WHERE code = ? AND host_member_id = ? AND status = 'lobby')", [body.name === undefined ? member.name : name(body.name), body.color === undefined ? member.color : color(body.color), body.ready === undefined ? member.ready : Number(body.ready), timestamp, member.id, code, room.host_member_id]),
          statement(db, "UPDATE bm_rooms SET generation = generation + 1 WHERE code = ? AND host_member_id = ? AND status = 'lobby'", [code, room.host_member_id]),
        ]);
        if (!changes(results[0])) fail(409, 'This game has already started.');
      } else if (action === 'heartbeat' && request.method === 'POST') {
        await run(db, 'UPDATE bm_members SET last_seen = ? WHERE id = ?', [timestamp, member.id]);
        if (member.id === room.host_member_id) await run(db, 'UPDATE bm_rooms SET expires_at = ? WHERE code = ? AND host_member_id = ?', [timestamp + ROOM_LIFETIME, code, room.host_member_id]);
      } else if (action === 'leave' && request.method === 'POST') {
        if (member.id === room.host_member_id) {
          await run(db, 'DELETE FROM bm_rooms WHERE code = ? AND host_member_id = ?', [code, room.host_member_id]);
          return response({ closed: true });
        }
        await db.batch([statement(db, 'DELETE FROM bm_signals WHERE room_code = ? AND (from_player_id = ? OR to_player_id = ?) AND EXISTS (SELECT 1 FROM bm_rooms WHERE code = ? AND host_member_id = ?)', [code, member.player_id, member.player_id, code, room.host_member_id]), statement(db, 'DELETE FROM bm_members WHERE id = ?', [member.id]), statement(db, 'UPDATE bm_rooms SET generation = generation + 1 WHERE code = ? AND host_member_id = ?', [code, room.host_member_id])]);
        return response({ left: true });
      } else if (action === 'checkpoint' && request.method === 'PUT') {
        hostOnly(member, room); pendingOnly(room);
        const body = await bodyJSON(request);
        keys(body, ['checkpoint']);
        const checkpoint = body.checkpoint === null ? null : validateCheckpoint(body.checkpoint, room);
        const members = await all(db, 'SELECT player_id FROM bm_members WHERE room_code = ?', [code]);
        if (checkpoint && members.some(player => !checkpoint.players.some(saved => saved.id === player.player_id))) fail(409, 'The connected lobby includes a player outside this saved roster.');
        const result = await run(db, "UPDATE bm_rooms SET checkpoint_json = ?, world = ?, generation = generation + 1 WHERE code = ? AND host_member_id = ? AND generation = ? AND status = 'lobby'", [checkpoint ? JSON.stringify(checkpoint) : null, checkpoint?.world ?? room.world, code, room.host_member_id, room.generation]);
        if (!changes(result)) fail(409, 'Lobby changed. Review its players and try again.');
      } else if (action === 'start' && request.method === 'POST') {
        hostOnly(member, room); pendingOnly(room);
        const players = await all(db, 'SELECT * FROM bm_members WHERE room_code = ?', [code]);
        if (players.length < 2 || players.some(player => !player.ready || timestamp - player.last_seen > CONNECTED_FOR)) fail(409, 'At least two players must be connected and ready.');
        if (room.checkpoint_json) {
          const saved = JSON.parse(room.checkpoint_json);
          if (saved.players.length !== players.length || saved.players.some(player => !players.some(current => current.player_id === player.id))) fail(409, 'Reconnect every player from the saved roster before resuming.');
        }
        // Every roster mutation advances generation. A racing join/update cannot
        // silently slip into a start whose ready roster was checked above.
        const result = await run(db, "UPDATE bm_rooms SET status = 'playing', start_id = ?, started_at = ?, generation = generation + 1 WHERE code = ? AND host_member_id = ? AND generation = ? AND status = 'lobby'", [randomHex(16), timestamp, code, room.host_member_id, room.generation]);
        if (!changes(result)) fail(409, 'Lobby changed. Review its players and try again.');
      } else if (action === 'signals' && request.method === 'POST') {
        const body = await bodyJSON(request);
        const payload = validateSignal(body);
        if (body.to === member.player_id) fail(400, 'Cannot signal yourself.');
        const recipient = await first(db, 'SELECT * FROM bm_members WHERE room_code = ? AND player_id = ? AND EXISTS (SELECT 1 FROM bm_rooms WHERE code = ? AND host_member_id = ?)', [code, body.to, code, room.host_member_id]);
        if (!recipient || timestamp - recipient.last_seen > MEMBER_LIFETIME) fail(404, 'Signal recipient is not in this lobby.');
        if (member.id !== room.host_member_id && recipient.id !== room.host_member_id) fail(403, 'Guests connect through the host.');
        const results = await db.batch([
          statement(db, 'DELETE FROM bm_signals WHERE room_code = ? AND created_at <= ? AND EXISTS (SELECT 1 FROM bm_rooms WHERE code = ? AND host_member_id = ?)', [code, timestamp - SIGNAL_LIFETIME, code, room.host_member_id]),
          statement(db, 'INSERT INTO bm_signals (room_code,from_player_id,to_player_id,payload_json,created_at) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM bm_rooms WHERE code = ? AND host_member_id = ?) AND (SELECT COUNT(*) FROM bm_signals WHERE room_code = ? AND from_player_id = ? AND created_at > ?) < 60 AND (SELECT COUNT(*) FROM bm_signals WHERE room_code = ?) < 512', [code, member.player_id, body.to, payload, timestamp, code, room.host_member_id, code, member.player_id, timestamp - 5_000, code]),
        ]);
        if (!changes(results[1])) {
          await readRoom(db, code, timestamp, room.host_member_id);
          fail(429, 'Too many signaling messages. Wait briefly and try again.');
        }
        return response({ sent: true });
      } else fail(405, 'Method is not available for this endpoint.');
      room = await readRoom(db, code, timestamp, room.host_member_id);
      return response({ room: await roomResult(db, room, timestamp) });
    } catch (error) {
      if (error instanceof LobbyError) return response({ error: error.message }, error.status);
      // Never expose database statements, tokens, SDP, or internal error text.
      return response({ error: 'Lobby service could not complete the request. Try again.' }, 500);
    }
  };
}

export const handleLobby = createLobbyHandler();
