import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { jwtVerify, SignJWT } from 'jose';
import type pg from 'pg';
import { config } from './config.js';
import { pool } from './db.js';

// OWASP-recommended argon2id parameters (19 MiB, t=2, p=1)
const ARGON = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (pw: string) => hash(pw, ARGON);

// Verifying against a real hash when the user doesn't exist keeps login
// timing identical for known and unknown emails (no account enumeration).
let dummyHash: Promise<string> | null = null;
export async function verifyPassword(stored: string | null, pw: string): Promise<boolean> {
  if (!stored) {
    dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
    await verify(await dummyHash, pw).catch(() => false);
    return false;
  }
  return verify(stored, pw).catch(() => false);
}

export async function signAccess(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setIssuer('tadbeer')
    .setAudience('tadbeer-app')
    .setIssuedAt()
    .setExpirationTime(`${config.accessTtlSec}s`)
    .sign(config.jwtSecret);
}

const sha256 = (s: string) => createHash('sha256').update(s).digest();

export async function issueRefresh(db: pg.Pool | pg.PoolClient, userId: string, family: string = randomUUID()): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.query(
    `INSERT INTO refresh_tokens (user_id, family, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(days => $4))`,
    [userId, family, sha256(token), config.refreshTtlDays],
  );
  return token;
}

export type RotateResult = { userId: string; refreshToken: string } | null;

/** Single-use rotation with reuse detection. */
export async function rotateRefresh(c: pg.PoolClient, token: string): Promise<RotateResult> {
  const { rows } = await c.query<{ id: string; user_id: string; family: string; revoked: boolean; expired: boolean }>(
    `SELECT t.id, t.user_id, t.family, t.revoked_at IS NOT NULL AS revoked,
            t.expires_at < now() OR u.disabled_at IS NOT NULL AS expired
       FROM refresh_tokens t JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = $1 FOR UPDATE OF t`,
    [sha256(token)],
  );
  const row = rows[0];
  if (!row) return null;
  if (row.revoked) {
    // A rotated token was replayed → assume theft, kill the whole session family.
    await c.query('UPDATE refresh_tokens SET revoked_at = now() WHERE family = $1 AND revoked_at IS NULL', [row.family]);
    return null;
  }
  if (row.expired) return null;
  await c.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [row.id]);
  return { userId: row.user_id, refreshToken: await issueRefresh(c, row.user_id, row.family) };
}

export async function revokeRefresh(token: string) {
  await pool.query(
    `UPDATE refresh_tokens SET revoked_at = now()
      WHERE family = (SELECT family FROM refresh_tokens WHERE token_hash = $1) AND revoked_at IS NULL`,
    [sha256(token)],
  );
}

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
  }
}

/** preHandler: require a valid Bearer access token. */
export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return reply.code(401).send({ error: 'unauthorized' });
  try {
    const { payload } = await jwtVerify(h.slice(7), config.jwtSecret, {
      issuer: 'tadbeer',
      audience: 'tadbeer-app',
      algorithms: ['HS256'],
    });
    if (typeof payload.sub !== 'string') throw new Error('no sub');
    req.userId = payload.sub;
  } catch {
    return reply.code(401).send({ error: 'unauthorized' });
  }
}
