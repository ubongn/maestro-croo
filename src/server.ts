/**
 * HTTP server: serves the dashboard (light theme) and a small JSON API the
 * dashboard polls for live state. Also periodically refreshes the wallet
 * balance so the header always reflects on-chain reality.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { runtime } from './config.js';
import { state } from './state.js';
import { refreshWallet } from './wallet.js';
import { TARGET_AGENTS, configuredAgents } from './agents-registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');

export async function startServer(): Promise<void> {
  const app = fastify({ logger: false });

  await app.register(fastifyStatic, {
    root: PUBLIC_DIR,
    prefix: '/',
    decorateReply: true,
  });

  // --- JSON API ---

  app.get('/api/health', async () => ({ status: 'ok', ts: Date.now() }));

  app.get('/api/state', async () => state.snapshot());

  app.get('/api/target-agents', async () => ({
    configured: configuredAgents().map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role,
      agentId: a.agentId,
      configured: true,
      glyph: a.glyph,
      description: a.description,
    })),
    unconfigured: TARGET_AGENTS.filter((a) => !configuredAgents().some((c) => c.id === a.id)).map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role,
      agentId: a.agentId,
      configured: false,
      glyph: a.glyph,
      description: a.description,
      envVar: a.serviceIdEnvVar,
    })),
  }));

  app.get<{ Params: { orderId: string } }>('/api/strategy/:orderId', async (req, reply) => {
    const result = state.strategyFor(req.params.orderId);
    if (!result) {
      reply.code(404);
      return { error: 'strategy not found' };
    }
    return { orderId: req.params.orderId, result };
  });

  // Periodic wallet refresh (every 30s) once we know the address.
  const walletTimer = setInterval(() => {
    void refreshWallet();
  }, 30_000);
  // Kick one immediately.
  void refreshWallet();

  const port = runtime.port;
  app
    .listen({ port, host: '0.0.0.0' })
    .then(() => {
      console.log(`[maestro] dashboard → http://localhost:${port}`);
    })
    .catch((err) => {
      console.error('[maestro] failed to start server:', err);
      process.exit(1);
    });

  // Cleanup on shutdown.
  const close = () => {
    clearInterval(walletTimer);
    void app.close();
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}
