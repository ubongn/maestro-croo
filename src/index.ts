/**
 * Maestro — entry point.
 *
 * Boots the CROO provider+consumer runtime (if credentials are present) and the
 * dashboard HTTP server (always). In degraded mode (no SDK key yet) it still
 * serves the dashboard so you can verify the build end-to-end before wiring up
 * live credentials.
 */
import { AgentClient } from '@croo-network/sdk';
import { crooConfig, hasCrooCredentials, hasSubAgentsConfigured, hasLlmCredentials, runtime } from './config.js';
import { CrooBus } from './event-bus.js';
import { Provider } from './provider.js';
import { Consumer } from './consumer.js';
import { Orchestrator } from './orchestrator.js';
import { state } from './state.js';
import { startServer } from './server.js';
import { refreshWallet } from './wallet.js';

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║   Maestro — CROO DeFi Strategy Orchestrator              ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  // Config diagnostics.
  console.log(`[maestro] croo api   : ${runtime.crooApiUrl}`);
  console.log(`[maestro] sdk key   : ${hasCrooCredentials() ? 'present ✓' : 'MISSING (degraded mode)'}`);
  console.log(`[maestro] sub-agents: ${hasSubAgentsConfigured() ? 'configured ✓' : 'none yet (set *_SERVICE_ID)'}`);
  console.log(`[maestro] llm       : ${hasLlmCredentials() ? 'configured ✓' : 'MISSING (fallback synthesis)'}`);
  console.log(`[maestro] service   : ${runtime.maestroServiceId ? runtime.maestroServiceId.slice(0, 8) + '…' : 'unregistered'}`);

  // Always start the dashboard + API.
  await startServer();

  if (!hasCrooCredentials()) {
    state.pushFeed('warn', 'system', 'Running in degraded mode', 'Add CROO_SDK_KEY (and *_SERVICE_ID / LLM_API_KEY) to go live.', { type: 'config' });
    console.warn('\n[maestro] No CROO_SDK_KEY — dashboard only. Set credentials in .env to enable live order flow.\n');
    return;
  }

  // --- Live CROO runtime ---
  const client = new AgentClient(crooConfig, runtime.crooSdkKey);
  const bus = new CrooBus();
  const outboundNegotiations = new Set<string>();

  const provider = new Provider(client, bus, outboundNegotiations);
  const consumer = new Consumer(client, bus, outboundNegotiations);
  const orchestrator = new Orchestrator(client, consumer, provider);

  provider.attach();
  orchestrator.attach();

  // Connect WebSocket and pipe every event into the bus.
  const stream = await client.connectWebSocket();
  stream.onAny((e) => bus.push(e));

  const streamErr = stream.err();
  if (streamErr) {
    state.pushFeed('error', 'system', 'WebSocket error', streamErr.message, { type: 'error' });
  } else {
    state.pushFeed('success', 'system', 'Connected to CROO', 'Listening for orders as provider + consumer', { type: 'connect' });
    console.log('[maestro] connected to CROO — live order flow active.');
  }

  // Best-effort: discover wallet address from a recent provider order.
  void (async () => {
    try {
      const orders = await client.listOrders({ role: 'provider', pageSize: 1 });
      const addr = orders[0]?.providerWalletAddress;
      if (addr) {
        state.setWallet({ address: addr });
        void refreshWallet();
      }
    } catch {
      /* none yet */
    }
  })();

  // Graceful shutdown.
  const shutdown = () => {
    console.log('\n[maestro] shutting down…');
    stream.close();
    setTimeout(() => process.exit(0), 500);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[maestro] fatal:', err);
  process.exit(1);
});
