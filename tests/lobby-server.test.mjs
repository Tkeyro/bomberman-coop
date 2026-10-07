import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createLobbyHandler } from '../server/lobby.js';

const schema = await readFile(new URL('../drizzle/0000_lobbies.sql', import.meta.url), 'utf8');
const revision = '0.3.8-test', romHash = 'a'.repeat(64);
const identity = (id, extras = {}) => ({ playerId: `player_${String(id).padStart(12, '0')}`, name: `Player ${id}`, color: 'original', revision, romHash, ...extras });

// Real SQLite executes production migration and query text; this adapter only
// supplies D1's Promise/result envelope and atomic batch contract.
class D1SQLite {
  constructor() { this.sqlite = new DatabaseSync(':memory:'); this.sqlite.exec('PRAGMA foreign_keys = ON'); this.sqlite.exec(schema); }
  withSession(constraint) { assert.equal(constraint, 'first-primary'); return this; }
  prepare(sql) {
    const db = this;
    return { bind(...values) {
      return {
        sql, values,
        async first() { return db.sqlite.prepare(sql).get(...values) ?? null; },
        async all() { return { results: db.sqlite.prepare(sql).all(...values) }; },
        async run() { const result = db.sqlite.prepare(sql).run(...values); return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }; },
      };
    } };
  }
  async batch(statements) {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      const result = statements.map(statement => {
        const value = this.sqlite.prepare(statement.sql).run(...statement.values);
        return { meta: { changes: Number(value.changes), last_row_id: Number(value.lastInsertRowid) } };
      });
      this.sqlite.exec('COMMIT');
      return result;
    } catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
  }
}
function fixture(t) {
  const db = new D1SQLite();
  let timestamp = 1_791_350_000_000;
  t.after(() => db.sqlite.close());
  const handler = createLobbyHandler({ now: () => timestamp });
  const api = async (path, method = 'GET', body, token, extraHeaders = {}) => {
    const headers = { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}), ...extraHeaders };
    const result = await handler(new Request(`https://game.test/api/rooms${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), { DB: db });
    return { status: result.status, body: await result.json(), headers: result.headers };
  };
  const create = async (extras = {}) => {
    const result = await api('', 'POST', { ...identity(0), mode: 'campaign', world: 0, slots: 5, ...extras });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return result.body;
  };
  const joinRoom = async (host, id, extras = {}) => {
    const result = await api(`/${host.room.code}/join`, 'POST', identity(id, extras));
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return result.body;
  };
  return { db, api, create, joinRoom, advance: ms => { timestamp += ms; } };
}

test('lobby membership uses unguessable tokens; roster exposes no secrets', async t => {
  const f = fixture(t), host = await f.create(), guest = await f.joinRoom(host, 1, { color: 'black' });
  assert.match(host.token, /^[a-f0-9]{64}$/);
  assert.notEqual(host.token, guest.token);
  assert.match(host.room.code, /^[A-Z2-9]{10}$/);
  const read = await f.api(`/${host.room.code}`, 'GET', undefined, guest.token);
  assert.equal(read.status, 200);
  assert.equal(read.body.room.hostId, identity(0).playerId);
  assert.deepEqual(read.body.room.players.map(p => p.color), ['original', 'black']);
  assert.equal(read.body.room.players[0].isHost, true);
  assert.equal(read.headers.get('cache-control'), 'no-store');
  const publicJSON = JSON.stringify(read.body);
  assert.ok(!publicJSON.includes(host.token));
  assert.ok(!publicJSON.includes('token_hash'));
  const stored = f.db.sqlite.prepare('SELECT token_hash FROM bm_members ORDER BY joined_at,id').all();
  assert.ok(stored.every(row => row.token_hash !== host.token && row.token_hash !== guest.token));
  assert.equal((await f.api(`/${host.room.code}`)).status, 401);
  assert.equal((await f.api(`/${host.room.code}`, 'GET', undefined, 'f'.repeat(64))).status, 403);
  assert.equal((await f.api(`/${host.room.code}/start`, 'POST', undefined, guest.token)).status, 403);
  const other = await f.create({ playerId: identity(9).playerId });
  assert.equal((await f.api(`/${other.room.code}`, 'GET', undefined, host.token)).status, 403);
});

test('ROM/revision matching, names, colors, methods, origins and bounded JSON are enforced', async t => {
  const f = fixture(t), host = await f.create();
  for (const override of [{ romHash: 'b'.repeat(64) }, { revision: 'other' }]) assert.equal((await f.api(`/${host.room.code}/join`, 'POST', identity(1, override))).status, 409);
  for (const override of [{ color: 'pink' }, { name: '' }, { playerId: 'short' }, { romHash: 'not-a-hash' }]) assert.equal((await f.api(`/${host.room.code}/join`, 'POST', identity(1, override))).status, 400);
  assert.equal((await f.api('', 'GET')).status, 405);
  assert.equal((await f.api('', 'POST', { ...identity(1), mode: 'campaign' }, undefined, { origin: 'https://evil.test' })).status, 403);
  assert.equal((await f.api('', 'POST', { ...identity(1), mode: 'campaign' }, undefined, { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await f.api('', 'POST', { name: 'x'.repeat(20_000) })).status, 413);
  assert.equal((await f.api(`/${host.room.code}/member`, 'PATCH', { ready: 'yes' }, host.token)).status, 400);
  assert.equal((await f.api(`/${host.room.code}/member`, 'PATCH', { state: 'injected' }, host.token)).status, 400);
});

test('simultaneous joins respect the configured seat limit without duplicate players', async t => {
  const f = fixture(t), host = await f.create({ slots: 3 });
  const joined = await Promise.all(Array.from({ length: 8 }, (_, index) => f.api(`/${host.room.code}/join`, 'POST', identity(index + 1))));
  assert.equal(joined.filter(result => result.status === 201).length, 2);
  assert.ok(joined.filter(result => result.status !== 201).every(result => result.status === 409));
  const room = (await f.api(`/${host.room.code}`, 'GET', undefined, host.token)).body.room;
  assert.equal(room.players.length, 3);
  assert.equal(new Set(room.players.map(p => p.id)).size, 3);
  assert.equal((await f.api(`/${host.room.code}/join`, 'POST', identity(0))).status, 409);
});

test('only the host starts an entirely ready connected roster; later joins and changes fail', async t => {
  const f = fixture(t), host = await f.create();
  assert.equal((await f.api(`/${host.room.code}/start`, 'POST', undefined, host.token)).status, 409);
  const guest = await f.joinRoom(host, 1);
  assert.equal((await f.api(`/${host.room.code}/start`, 'POST', undefined, host.token)).status, 409);
  await f.api(`/${host.room.code}/member`, 'PATCH', { ready: true, color: 'orange' }, guest.token);
  const result = await f.api(`/${host.room.code}/start`, 'POST', undefined, host.token);
  assert.equal(result.status, 200);
  assert.equal(result.body.room.status, 'playing');
  assert.match(result.body.room.startId, /^[a-f0-9]{32}$/);
  assert.equal(result.body.room.players[1].color, 'orange');
  assert.equal((await f.api(`/${host.room.code}/join`, 'POST', identity(2))).status, 409);
  assert.equal((await f.api(`/${host.room.code}/member`, 'PATCH', { color: 'yellow' }, guest.token)).status, 409);
  assert.equal((await f.api(`/${host.room.code}/start`, 'POST', undefined, host.token)).status, 409);
});

test('a racing ready mutation cannot enter an unchecked started roster', async t => {
  const f = fixture(t), host = await f.create(), guest = await f.joinRoom(host, 1);
  await f.api(`/${host.room.code}/member`, 'PATCH', { ready: true }, guest.token);
  const [start, unready] = await Promise.all([
    f.api(`/${host.room.code}/start`, 'POST', undefined, host.token),
    f.api(`/${host.room.code}/member`, 'PATCH', { ready: false }, guest.token),
  ]);
  const final = (await f.api(`/${host.room.code}`, 'GET', undefined, host.token)).body.room;
  if (start.status === 200) { assert.equal(unready.status, 409); assert.equal(final.players[1].ready, true); }
  else { assert.equal(start.status, 409); assert.equal(unready.status, 200); assert.equal(final.status, 'lobby'); assert.equal(final.players[1].ready, false); }
});

test('signaling is private, ordered, cursor replayable and safe under concurrent writes', async t => {
  const f = fixture(t), host = await f.create(), guest = await f.joinRoom(host, 1), other = await f.joinRoom(host, 2);
  const sent = await Promise.all(Array.from({ length: 20 }, (_, index) => f.api(`/${host.room.code}/signals`, 'POST', { to: guest.playerId, type: 'offer', data: { type: 'offer', sdp: `v=0\na=test-${index}` } }, host.token)));
  assert.ok(sent.every(result => result.status === 200), JSON.stringify(sent));
  const firstRead = await f.api(`/${host.room.code}?after=0`, 'GET', undefined, guest.token);
  assert.equal(firstRead.body.signals.length, 20);
  assert.equal(new Set(firstRead.body.signals.map(signal => signal.id)).size, 20);
  assert.equal(new Set(firstRead.body.signals.map(signal => signal.data.sdp)).size, 20);
  assert.ok(firstRead.body.signals.every(signal => signal.from === host.playerId && signal.to === guest.playerId));
  assert.deepEqual((await f.api(`/${host.room.code}?after=0`, 'GET', undefined, guest.token)).body.signals, firstRead.body.signals);
  assert.equal((await f.api(`/${host.room.code}?after=${firstRead.body.lastId}`, 'GET', undefined, guest.token)).body.signals.length, 0);
  assert.equal((await f.api(`/${host.room.code}`, 'GET', undefined, other.token)).body.signals.length, 0);
  assert.equal((await f.api(`/${host.room.code}/signals`, 'POST', { to: other.playerId, type: 'ice', data: null }, guest.token)).status, 403);
  assert.equal((await f.api(`/${host.room.code}/signals`, 'POST', { to: guest.playerId, type: 'frame', data: {} }, host.token)).status, 400);
  assert.equal((await f.api(`/${host.room.code}/signals`, 'POST', { to: guest.playerId, type: 'ice', data: { candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 } }, host.token)).status, 200);
  assert.equal((await f.api(`/${host.room.code}?after=-1`, 'GET', undefined, guest.token)).status, 400);
  await f.api(`/${host.room.code}/leave`, 'POST', undefined, guest.token);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS count FROM bm_signals').get().count, 0);
});

test('signals are bounded per sender and expire; stale members cannot start a round', async t => {
  const f = fixture(t), host = await f.create(), guest = await f.joinRoom(host, 1);
  await f.api(`/${host.room.code}/member`, 'PATCH', { ready: true }, guest.token);
  for (let index = 0; index < 60; index++) assert.equal((await f.api(`/${host.room.code}/signals`, 'POST', { to: guest.playerId, type: 'ice', data: null }, host.token)).status, 200);
  assert.equal((await f.api(`/${host.room.code}/signals`, 'POST', { to: guest.playerId, type: 'ice', data: null }, host.token)).status, 429);
  f.advance(46_000);
  const stale = (await f.api(`/${host.room.code}`, 'GET', undefined, host.token)).body.room;
  assert.equal(stale.players.find(p => p.id === guest.playerId).connected, false);
  assert.equal((await f.api(`/${host.room.code}/start`, 'POST', undefined, host.token)).status, 409);
  await f.api(`/${host.room.code}/heartbeat`, 'POST', undefined, guest.token);
  f.advance(75_000);
  const expiredSignals = await f.api(`/${host.room.code}`, 'GET', undefined, guest.token);
  assert.equal(expiredSignals.status, 200);
  assert.equal(expiredSignals.body.signals.length, 0);
  f.advance(121_000);
  assert.equal((await f.api(`/${host.room.code}`, 'GET', undefined, guest.token)).status, 410);
  const rejoined = await f.joinRoom(host, 1);
  assert.notEqual(rejoined.token, guest.token);
  assert.equal((await f.api(`/${host.room.code}`, 'GET', undefined, guest.token)).status, 403);
  f.advance(30 * 60_000 + 1);
  assert.equal((await f.api(`/${host.room.code}`, 'GET', undefined, host.token)).status, 404);
});

test('resume metadata rejects raw save fields and requires the complete original roster', async t => {
  const f = fixture(t);
  const checkpoint = { world: 4, area: 3, players: [identity(0), identity(1)].map(p => ({ id: p.playerId, name: p.name, color: p.color })), revision };
  const host = await f.create({ checkpoint });
  assert.equal(host.room.world, 4);
  assert.equal(host.room.checkpoint.area, 3);
  assert.equal((await f.api(`/${host.room.code}/join`, 'POST', identity(2))).status, 409);
  assert.equal((await f.api(`/${host.room.code}/start`, 'POST', undefined, host.token)).status, 409);
  const guest = await f.joinRoom(host, 1);
  assert.equal((await f.api(`/${host.room.code}/checkpoint`, 'PUT', { checkpoint }, guest.token)).status, 403);
  assert.equal((await f.api(`/${host.room.code}/checkpoint`, 'PUT', { checkpoint: { ...checkpoint, ram: [1, 2] } }, host.token)).status, 400);
  assert.equal((await f.api(`/${host.room.code}/checkpoint`, 'PUT', { checkpoint: { ...checkpoint, revision: 'wrong' } }, host.token)).status, 409);
  await f.api(`/${host.room.code}/member`, 'PATCH', { ready: true }, guest.token);
  const resumed = await f.api(`/${host.room.code}/start`, 'POST', undefined, host.token);
  assert.equal(resumed.status, 200);
  assert.deepEqual(resumed.body.room.checkpoint.players.map(p => p.id), checkpoint.players.map(p => p.id));
  const payloads = f.db.sqlite.prepare('SELECT checkpoint_json FROM bm_rooms').all();
  assert.ok(payloads.every(row => !row.checkpoint_json.includes('ram')));
});

test('host departure closes the room and deletes members and signals', async t => {
  const f = fixture(t), host = await f.create(), guest = await f.joinRoom(host, 1);
  await f.api(`/${host.room.code}/signals`, 'POST', { to: guest.playerId, type: 'ice', data: null }, host.token);
  assert.deepEqual((await f.api(`/${host.room.code}/leave`, 'POST', undefined, host.token)).body, { closed: true });
  for (const table of ['bm_rooms', 'bm_members', 'bm_signals']) assert.equal(f.db.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0);
  assert.equal((await f.api(`/${host.room.code}`, 'GET', undefined, guest.token)).status, 404);
});

test('build preserves source assets and emits a standalone Worker with migration metadata', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'bomberman-online-build-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const path of ['scripts', 'server', 'dist/vendor', '.openai']) await mkdir(join(directory, path), { recursive: true });
  await cp(new URL('../scripts/build-online-site.mjs', import.meta.url), join(directory, 'scripts/build-online-site.mjs'));
  await cp(new URL('../server/lobby.js', import.meta.url), join(directory, 'server/lobby.js'));
  await cp(new URL('../drizzle/', import.meta.url), join(directory, 'drizzle'), { recursive: true });
  await writeFile(join(directory, 'package.json'), '{"type":"module"}');
  await writeFile(join(directory, '.openai/hosting.json'), JSON.stringify({ project_id: 'same-existing-site', d1: 'DB', r2: null }));
  const html = '<!doctype html><html><script type="module" src="app.js"></script></html>';
  await writeFile(join(directory, 'dist/index.html'), html);
  await writeFile(join(directory, 'dist/app.js'), 'export const value = "source stays here";');
  await writeFile(join(directory, 'dist/vendor/LICENSE.txt'), 'Licensed emulator code.');
  const result = spawnSync(process.execPath, [join(directory, 'scripts/build-online-site.mjs')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(await readFile(join(directory, 'dist/index.html'), 'utf8'), html);
  assert.equal(JSON.parse(await readFile(join(directory, 'dist/.openai/hosting.json'), 'utf8')).project_id, 'same-existing-site');
  assert.equal(JSON.parse(await readFile(join(directory, 'dist/.openai/drizzle/meta/_journal.json'), 'utf8')).entries[0].tag, '0000_lobbies');
  const worker = (await import(pathToFileURL(join(directory, 'dist/server/index.js')))).default;
  assert.equal(await (await worker.fetch(new Request('https://test/'), {}, {})).text(), html);
  assert.equal((await worker.fetch(new Request('https://test/vendor/LICENSE.txt'), {}, {})).headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal((await worker.fetch(new Request('https://test/app.js', { method: 'HEAD' }), {}, {})).status, 200);
  assert.equal((await worker.fetch(new Request('https://test/private.pce'), {}, {})).status, 404);
  assert.equal((await worker.fetch(new Request('https://test/api/rooms'), {}, {})).status, 503);
  // A rebuild must not embed its previous worker or metadata recursively.
  const before = await readFile(join(directory, 'dist/server/index.js'), 'utf8');
  const second = spawnSync(process.execPath, [join(directory, 'scripts/build-online-site.mjs')], { encoding: 'utf8' });
  assert.equal(second.status, 0, second.stderr);
  assert.equal(await readFile(join(directory, 'dist/server/index.js'), 'utf8'), before);
});
