import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hashPassword, issueRefresh, requireUser, revokeRefresh, rotateRefresh, signAccess, verifyPassword } from '../auth.js';
import { pool, tx } from '../db.js';

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(8).max(128);

const RegisterBody = z.object({ email, password, name: z.string().trim().max(80).default('') });
const LoginBody = z.object({ email, password: z.string().min(1).max(128) });
const RefreshBody = z.object({ refreshToken: z.string().min(20).max(200) });

type UserRow = { id: string; email: string; name: string };

async function session(user: UserRow) {
  return {
    accessToken: await signAccess(user.id),
    refreshToken: await issueRefresh(pool, user.id),
    user: { id: user.id, email: user.email, name: user.name },
  };
}

export async function authRoutes(app: FastifyInstance) {
  // brute-force protection on credential endpoints
  const strict = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  app.post('/v1/auth/register', strict, async (req, reply) => {
    const body = RegisterBody.parse(req.body);
    const hash = await hashPassword(body.password);
    const { rows } = await pool.query<UserRow>(
      `INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3)
       ON CONFLICT (lower(email)) DO NOTHING
       RETURNING id, email, name`,
      [body.email, hash, body.name],
    );
    if (!rows[0]) return reply.code(409).send({ error: 'email_taken' });
    return reply.code(201).send(await session(rows[0]));
  });

  app.post('/v1/auth/login', strict, async (req, reply) => {
    const body = LoginBody.parse(req.body);
    const { rows } = await pool.query<UserRow & { password_hash: string }>(
      'SELECT id, email, name, password_hash FROM users WHERE lower(email) = $1',
      [body.email],
    );
    const user = rows[0];
    if (!(await verifyPassword(user?.password_hash ?? null, body.password)) || !user) {
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
    return session(user);
  });

  app.post('/v1/auth/refresh', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { refreshToken } = RefreshBody.parse(req.body);
    const r = await tx((c) => rotateRefresh(c, refreshToken));
    if (!r) return reply.code(401).send({ error: 'invalid_refresh' });
    return { accessToken: await signAccess(r.userId), refreshToken: r.refreshToken };
  });

  app.post('/v1/auth/logout', async (req, reply) => {
    const parsed = RefreshBody.safeParse(req.body);
    if (parsed.success) await revokeRefresh(parsed.data.refreshToken);
    return reply.code(204).send();
  });

  app.get('/v1/me', { preHandler: requireUser }, async (req, reply) => {
    const { rows } = await pool.query<UserRow>('SELECT id, email, name FROM users WHERE id = $1', [req.userId]);
    if (!rows[0]) return reply.code(401).send({ error: 'unauthorized' });
    return rows[0];
  });

  /** Permanently delete the account and every record (GDPR-style erasure). */
  app.delete('/v1/me', { preHandler: requireUser }, async (req, reply) => {
    await pool.query('DELETE FROM users WHERE id = $1', [req.userId]);
    return reply.code(204).send();
  });
}
