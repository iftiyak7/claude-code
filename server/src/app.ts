import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { config } from './config.js';
import { pool } from './db.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { bannerRoutes } from './routes/banners.js';
import { syncRoutes } from './routes/sync.js';

export async function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({
    logger:
      opts.logger === false
        ? false
        : {
            level: config.logLevel,
            // never log credentials or tokens
            redact: ['req.headers.authorization', 'req.body.password', 'req.body.refreshToken'],
          },
    // only Caddy (on the private Docker network) can reach us; trust its X-Forwarded-For
    trustProxy: ['127.0.0.1', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'],
    bodyLimit: 256 * 1024,
  });

  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } });
  await app.register(cors, { origin: config.corsOrigins, methods: ['GET', 'POST', 'PUT', 'DELETE'], maxAge: 86400 });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: 'validation_error' });
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 429) return reply.code(429).send({ error: 'rate_limited' });
    if (status && status < 500) return reply.code(status).send({ error: (err as { code?: string }).code?.toLowerCase() ?? 'bad_request' });
    req.log.error(err);
    return reply.code(500).send({ error: 'internal' });
  });

  app.get('/health', async () => {
    await pool.query('SELECT 1');
    return { ok: true };
  });

  await app.register(authRoutes);
  await app.register(syncRoutes);
  await app.register(adminRoutes);
  await app.register(bannerRoutes);
  return app;
}
