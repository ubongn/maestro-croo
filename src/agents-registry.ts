/**
 * Registry of candidate sub-agents Maestro can hire on the CROO store, plus
 * request-aware selection logic.
 *
 * The agent IDs below are published on the CROO store. Each agent exposes one
 * or more *services*; CROO orders are placed against a **serviceId**, not an
 * agent id. Because the store has no public discovery API, serviceIds are read
 * from the environment (see `.env.example`). An agent is only hireable once its
 * serviceId is configured.
 */
import { runtime } from './config.js';
import type { ResolvedAgent, StrategyRequest, SubAgentRole, TargetAgent } from './types.js';

/** The canonical candidate pool. Agent ids are the known CROO store ids. */
export const TARGET_AGENTS: readonly TargetAgent[] = [
  {
    id: 'alphatrack',
    name: 'AlphaTrack',
    role: 'smart-money',
    agentId: 'e05abaea-a586-4954-bbcf-d5c93127a214',
    serviceIdEnvVar: 'ALPHATRACK_SERVICE_ID',
    description: 'Smart-money flow tracking across DEXes — surfaces where informed capital is rotating.',
    glyph: '🐋',
  },
  {
    id: 'polymarket',
    name: 'Polymarket Smart Wallet Tracker',
    role: 'prediction-markets',
    agentId: 'b6c8cc34-0d3e-46dc-9b9d-816a3659dcad',
    serviceIdEnvVar: 'POLYMARKET_TRACKER_SERVICE_ID',
    description: 'Tracks profitable prediction-market wallets to gauge directional sentiment & conviction.',
    glyph: '🔮',
  },
  {
    id: 'hyperliquid',
    name: 'Hyperliquid Vault Strategy Intelligence',
    role: 'vault-performance',
    agentId: '25fa5511-272a-47b5-94cc-738da6752557',
    serviceIdEnvVar: 'HYPERLIQUID_VAULT_SERVICE_ID',
    description: 'Risk-adjusted performance analytics on Hyperliquid vaults for capital deployment.',
    glyph: '🏦',
  },
  {
    id: 'swapgod',
    name: 'SwapGod',
    role: 'execution',
    agentId: '70b70042-7cdd-4e6b-bebf-7abd25a22d83',
    serviceIdEnvVar: 'SWAPGOD_SERVICE_ID',
    description: 'Optimal ERC-20 swap execution on Base — best routing & MEV protection for entries.',
    glyph: '⚡',
  },
] as const;

/** All agents whose serviceId has been configured in the environment. */
export function configuredAgents(): ResolvedAgent[] {
  return TARGET_AGENTS.map((a) => ({ ...a, serviceId: serviceIdFor(a) })).filter(
    (a): a is ResolvedAgent => !!a.serviceId,
  );
}

function serviceIdFor(a: TargetAgent): string {
  switch (a.id) {
    case 'alphatrack':
      return runtime.alphatrackServiceId;
    case 'polymarket':
      return runtime.polymarketServiceId;
    case 'hyperliquid':
      return runtime.hyperliquidServiceId;
    case 'swapgod':
      return runtime.swapgodServiceId;
    default:
      return '';
  }
}

/** Map a role to a relevance score (0-100) for a given request. Pure & testable. */
export function roleRelevance(role: SubAgentRole, req: StrategyRequest): number {
  const text = `${req.chain} ${req.preferences} ${(req.tokens ?? []).join(' ')} ${req.raw}`.toLowerCase();
  switch (role) {
    case 'smart-money':
      return 95; // always useful
    case 'risk':
      return 90;
    case 'vault-performance':
      if (text.includes('hyperliquid') || text.includes('vault') || text.includes('yield')) return 96;
      return req.riskAppetite === 'low' ? 88 : 70;
    case 'prediction-markets':
      if (text.includes('polymarket') || text.includes('prediction') || text.includes('sentiment')) return 92;
      return req.riskAppetite === 'high' ? 74 : 55;
    case 'execution':
      if (req.chain.toLowerCase().includes('base')) return 90;
      if (text.includes('swap') || text.includes('execute') || text.includes('entry')) return 88;
      return 60;
  }
}

/**
 * Selects which configured agents to hire for a request, ordered by relevance.
 * Guarantees at least `minSubAgents` when enough agents are configured; returns
 * every configured agent otherwise.
 */
export function selectAgents(req: StrategyRequest, pool: ResolvedAgent[] = configuredAgents()): ResolvedAgent[] {
  const scored = pool
    .map((a) => ({ a, score: roleRelevance(a.role, req) }))
    .sort((x, y) => y.score - x.score);

  const target = Math.max(runtime.minSubAgents, 1);
  return scored.slice(0, Math.max(target, Math.min(pool.length, scored.length))).map((s) => s.a);
}
