/**
 * Integration tests against a real PostgreSQL.
 *   DATABASE_URL=postgres://... JWT_SECRET=... npm test
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { FastifyInstance } from 'fastify';

process.env.JWT_SECRET ??= 'test-secret-test-secret-test-secret-123';
process.env.ADMIN_EMAILS ??= 'boss@example.com';
process.env.DATABASE_URL ??= 'postgres://tadbeer:devpass@localhost:5432/tadbeer_test';

const { buildApp } = await import('../src/app.js');
const { migrate, pool } = await import('../src/db.js');

let app: FastifyInstance;
before(async () => {
  await migrate(() => undefined);
  await pool.query('TRUNCATE users CASCADE');
  app = await buildApp({ logger: false });
});
after(async () => {
  await app.close();
  await pool.end();
});

const post = (url: string, payload: unknown, token?: string) =>
  app.inject({ method: 'POST', url, payload: payload as object, headers: token ? { authorization: `Bearer ${token}` } : {} });

async function register(email: string) {
  const r = await post('/v1/auth/register', { email, password: 'correct horse battery', name: 'Test' });
  assert.equal(r.statusCode, 201, r.body);
  return r.json() as { accessToken: string; refreshToken: string; user: { id: string } };
}

test('health', async () => {
  const r = await app.inject('/health');
  assert.equal(r.statusCode, 200);
  assert.ok(r.headers['x-content-type-options']);
});

test('register / login / duplicate / wrong password', async () => {
  await register('A@Example.com');
  const dup = await post('/v1/auth/register', { email: 'a@example.com', password: 'another password', name: '' });
  assert.equal(dup.statusCode, 409);
  assert.equal(dup.json().error, 'email_taken');
  const bad = await post('/v1/auth/login', { email: 'a@example.com', password: 'nope-nope' });
  assert.equal(bad.statusCode, 401);
  const unknown = await post('/v1/auth/login', { email: 'zz@example.com', password: 'nope-nope' });
  assert.equal(unknown.statusCode, 401);
  assert.equal(unknown.json().error, bad.json().error, 'no account enumeration');
  const ok = await post('/v1/auth/login', { email: 'A@example.COM', password: 'correct horse battery' });
  assert.equal(ok.statusCode, 200);
  const weak = await post('/v1/auth/register', { email: 'w@example.com', password: 'short', name: '' });
  assert.equal(weak.statusCode, 400);
});

test('protected routes reject missing / forged tokens', async () => {
  assert.equal((await app.inject('/v1/me')).statusCode, 401);
  const forged = await app.inject({ url: '/v1/me', headers: { authorization: 'Bearer eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.' } });
  assert.equal(forged.statusCode, 401);
});

test('refresh rotation and reuse detection', async () => {
  const s = await register('rot@example.com');
  const r1 = await post('/v1/auth/refresh', { refreshToken: s.refreshToken });
  assert.equal(r1.statusCode, 200);
  const next = r1.json().refreshToken as string;
  assert.notEqual(next, s.refreshToken);
  // replay the old token → family revoked, including the newest token
  assert.equal((await post('/v1/auth/refresh', { refreshToken: s.refreshToken })).statusCode, 401);
  assert.equal((await post('/v1/auth/refresh', { refreshToken: next })).statusCode, 401);
});

test('sync: push, pull, last-write-wins, per-user isolation', async () => {
  const a = await register('sync-a@example.com');
  const b = await register('sync-b@example.com');
  const rec = (id: string, updatedAt: number, title: string) => ({
    collection: 'tasks', id, updatedAt, deleted: false, data: { id, updatedAt, title },
  });

  const p1 = await post('/v1/sync', { cursor: '0', changes: [rec('t1', 100, 'first'), rec('t2', 100, 'two')] }, a.accessToken);
  assert.equal(p1.statusCode, 200, p1.body);
  const c1 = p1.json().cursor as string;
  assert.equal(p1.json().changes.length, 2);

  // older write must not overwrite newer
  await post('/v1/sync', { cursor: c1, changes: [rec('t1', 50, 'stale')] }, a.accessToken);
  // newer write wins
  const p3 = await post('/v1/sync', { cursor: c1, changes: [rec('t1', 200, 'second')] }, a.accessToken);
  const changes = p3.json().changes as { id: string; data: { title: string } }[];
  assert.deepEqual(changes.map((c) => c.data.title), ['second']);

  // a second device pulling from scratch sees the final state
  const fresh = await post('/v1/sync', { cursor: '0', changes: [] }, a.accessToken);
  const titles = (fresh.json().changes as { data: { title: string } }[]).map((c) => c.data.title).sort();
  assert.deepEqual(titles, ['second', 'two']);

  // user B can't see A's data
  const other = await post('/v1/sync', { cursor: '0', changes: [] }, b.accessToken);
  assert.equal(other.json().changes.length, 0);

  // unknown collections are rejected
  const badCol = await post('/v1/sync', { cursor: '0', changes: [{ ...rec('x', 1, 'x'), collection: 'users' }] }, a.accessToken);
  assert.equal(badCol.statusCode, 400);
});

test('account deletion erases data', async () => {
  const s = await register('bye@example.com');
  await post('/v1/sync', { cursor: '0', changes: [{ collection: 'logs', id: 'l', updatedAt: 1, deleted: false, data: { id: 'l' } }] }, s.accessToken);
  const del = await app.inject({ method: 'DELETE', url: '/v1/me', headers: { authorization: `Bearer ${s.accessToken}` } });
  assert.equal(del.statusCode, 204);
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM records WHERE user_id = $1', [s.user.id]);
  assert.equal(rows[0].n, 0);
});

test('admin: only listed emails, no record contents, suspension works', async () => {
  const boss = await register('boss@example.com');
  const user = await register('member@example.com');
  const auth = (t: string) => ({ authorization: `Bearer ${t}` });

  assert.equal((await app.inject({ url: '/v1/admin/stats', headers: auth(user.accessToken) })).statusCode, 403);
  const stats = await app.inject({ url: '/v1/admin/stats', headers: auth(boss.accessToken) });
  assert.equal(stats.statusCode, 200, stats.body);
  assert.ok(stats.json().users.total >= 2);
  assert.equal(stats.json().signups.length, 30);

  await post('/v1/sync', { cursor: '0', changes: [{ collection: 'amals', id: 'secret', updatedAt: 1, deleted: false, data: { id: 'secret', title: 'PRIVATE-AMAL' } }] }, user.accessToken);
  const list = await app.inject({ url: '/v1/admin/users?q=member', headers: auth(boss.accessToken) });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().users.length, 1);
  assert.equal(list.json().users[0].records, 1);
  assert.ok(!list.body.includes('PRIVATE-AMAL'), 'admin never sees record contents');

  const dis = await app.inject({ method: 'POST', url: `/v1/admin/users/${user.user.id}/disable`, headers: auth(boss.accessToken) });
  assert.equal(dis.statusCode, 204);
  assert.equal((await post('/v1/auth/login', { email: 'member@example.com', password: 'correct horse battery' })).statusCode, 403);
  assert.equal((await post('/v1/auth/refresh', { refreshToken: user.refreshToken })).statusCode, 401);
  assert.equal((await post('/v1/sync', { cursor: '0', changes: [] }, user.accessToken)).statusCode, 403);

  await app.inject({ method: 'POST', url: `/v1/admin/users/${user.user.id}/enable`, headers: auth(boss.accessToken) });
  assert.equal((await post('/v1/auth/login', { email: 'member@example.com', password: 'correct horse battery' })).statusCode, 200);

  const self = await app.inject({ method: 'DELETE', url: `/v1/admin/users/${boss.user.id}`, headers: auth(boss.accessToken) });
  assert.equal(self.statusCode, 400, 'admin cannot delete themselves');

  const page = await app.inject({ url: '/admin' });
  assert.equal(page.statusCode, 200);
  assert.match(String(page.headers['content-security-policy']), /frame-ancestors 'none'/);
});
