/**
 * Maestro — shared types & interfaces.
 *
 * These types describe the domain of orchestrating other CROO agents to build
 * a complete DeFi allocation strategy. They are intentionally framework-free so
 * the core logic stays unit-testable without any network access.
 */

/** User-facing risk appetite, parsed from the incoming order requirements. */
export type RiskAppetite = 'low' | 'medium' | 'high';

/** The functional role a sub-agent plays in the orchestration. */
export type SubAgentRole =
  | 'smart-money'
  | 'prediction-markets'
  | 'vault-performance'
  | 'execution'
  | 'risk';

/** Which side of an order Maestro is on for a given event. */
export type OrderRole = 'provider' | 'consumer';

/** Outcome status for a single sub-agent hire. */
export type HireStatus = 'pending' | 'success' | 'failed' | 'timeout';

/**
 * The structured request Maestro parses out of a user's order requirements.
 * This is what drives agent selection and LLM synthesis.
 */
export interface StrategyRequest {
  /** Capital to deploy, in USDC (human units, e.g. 5000 = $5,000). */
  capitalUsdc: number;
  /** Risk tolerance. Defaults to 'medium'. */
  riskAppetite: RiskAppetite;
  /** Target chain label, e.g. "base", "ethereum", "hyperliquid". */
  chain: string;
  /** Free-form preferences from the user (sectors, tokens, avoid-list). */
  preferences: string;
  /** Investment horizon in days, if specified. */
  horizonDays?: number;
  /** Specific tokens the user is interested in, if any. */
  tokens?: string[];
  /** The raw requirements string submitted in the order (for traceability). */
  raw: string;
}

/** A candidate target agent on the CROO store that Maestro may hire. */
export interface TargetAgent {
  /** Stable internal id. */
  id: string;
  /** Human-friendly display name. */
  name: string;
  /** Functional role in the orchestration. */
  role: SubAgentRole;
  /** The CROO agent id (known from the store). */
  agentId: string;
  /** Name of the env var that holds this agent's serviceId. */
  serviceIdEnvVar: string;
  /** Short description shown in the dashboard / sent to the agent. */
  description: string;
  /** Emoji glyph for the dashboard. */
  glyph: string;
}

/** A resolved target agent with a concrete serviceId ready to be hired. */
export interface ResolvedAgent extends TargetAgent {
  serviceId: string;
}

/** The result of hiring a single sub-agent. */
export interface HireResult {
  agent: ResolvedAgent;
  orderId: string | null;
  negotiationId: string | null;
  status: HireStatus;
  /** Parsed delivery payload (schema JSON or text), when available. */
  payload: string | null;
  /** A short human label for the payload type. */
  payloadKind: 'schema' | 'text' | null;
  /** Price paid in USDC (human units), when known. */
  priceUsdc: number | null;
  /** Elapsed milliseconds for this hire. */
  durationMs: number;
  /** Error message when status !== 'success'. */
  error: string | null;
}

/** A single allocation line in the synthesized strategy. */
export interface StrategyAllocation {
  asset: string;
  protocol: string;
  percentage: number;
  vehicle: string;
  rationale: string;
}

/** The final synthesized DeFi strategy, delivered back to the requester. */
export interface StrategyResult {
  summary: string;
  riskLevel: RiskAppetite;
  /** 0-100, higher = riskier portfolio. */
  riskScore: number;
  allocations: StrategyAllocation[];
  actionItems: string[];
  warnings: string[];
  sources: { agent: string; role: SubAgentRole; orderId: string }[];
  generatedAt: string;
}

/** A dashboard feed entry (live event ticker). */
export interface FeedEvent {
  id: string;
  ts: number;
  type: string;
  role: OrderRole | 'system';
  label: string;
  detail: string;
  orderId?: string;
  kind: 'info' | 'success' | 'warn' | 'error';
}

/** A sub-order as rendered in the dashboard "agents hired" panel. */
export interface SubOrderView {
  orderId: string | null;
  agentName: string;
  role: SubAgentRole;
  glyph: string;
  status: HireStatus;
  priceUsdc: number | null;
  paid: boolean;
  delivered: boolean;
  error: string | null;
  durationMs: number;
}

/** An incoming user order as rendered in the dashboard "incoming" panel. */
export interface IncomingOrderView {
  orderId: string;
  status: string;
  priceUsdc: number | null;
  requestLabel: string;
  riskAppetite: RiskAppetite;
  capitalUsdc: number;
  phase: string;
  startedAt: number;
}

/** Wallet snapshot for the dashboard header. */
export interface WalletSnapshot {
  /** Maestro's AA wallet address, once discovered. */
  address: string | null;
  /** Native ETH balance (wei as decimal string). */
  ethWei: string | null;
  /** USDC balance (human units). */
  usdc: number | null;
  fetchedAt: number | null;
}

/** Aggregate stats for the dashboard. */
export interface DashboardStats {
  totalOrders: number;
  completedOrders: number;
  agentsHired: number;
  successRate: number;
  avgSynthesisMs: number;
}

/** The complete dashboard state, served at GET /api/state. */
export interface DashboardState {
  agent: { name: string; tagline: string; configured: boolean; serviceId: string | null };
  wallet: WalletSnapshot;
  incoming: IncomingOrderView[];
  subOrders: SubOrderView[];
  strategies: { orderId: string; summary: string; riskLevel: RiskAppetite; createdAt: number }[];
  feed: FeedEvent[];
  stats: DashboardStats;
  uptime: number;
  startedAt: number;
}
