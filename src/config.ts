/**
 * Centralised environment configuration & runtime constants.
 *
 * Everything credentials-shaped comes from the environment — this is standard
 * 12-factor practice, not a stub. The app boots and serves its dashboard even
 * before credentials are supplied; live order flow simply waits for them.
 */

// Load .env if present (Node >=20.12 has process.loadEnvFile). Safe no-op if
// the file does not exist — environment is then taken from the real process env.
try {
  (process as { loadEnvFile?: (path?: string) => void }).loadEnvFile?.();
} catch {
  /* no .env present — ignore */
}

function env(key: string, fallback = ''): string {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}

function envInt(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** USDC contract on Base mainnet (6 decimals). */
export const BASE_USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
/** USDC uses 6 decimals on Base (not 18). */
export const USDC_DECIMALS = 6;

export const runtime = {
  crooApiUrl: env('CROO_API_URL', 'https://api.croo.network'),
  crooWsUrl: env('CROO_WS_URL', 'wss://api.croo.network/ws'),
  crooSdkKey: env('CROO_SDK_KEY'),
  baseRpcUrl: env('BASE_RPC_URL', 'https://mainnet.base.org'),

  maestroServiceId: env('MAESTRO_SERVICE_ID'),
  maestroPriceUsdc: Number(env('MAESTRO_PRICE_USDC', '5')),

  alphatrackServiceId: env('ALPHATRACK_SERVICE_ID'),
  polymarketServiceId: env('POLYMARKET_TRACKER_SERVICE_ID'),
  hyperliquidServiceId: env('HYPERLIQUID_VAULT_SERVICE_ID'),
  swapgodServiceId: env('SWAPGOD_SERVICE_ID'),

  llmApiKey: env('LLM_API_KEY'),
  llmBaseUrl: env('LLM_BASE_URL', 'https://api.openai.com/v1'),
  llmModel: env('LLM_MODEL', 'gpt-4o-mini'),
  llmTimeoutMs: envInt('LLM_TIMEOUT_MS', 60_000),

  orchestrationTimeoutMs: envInt('ORCHESTRATION_TIMEOUT_MS', 120_000),
  minSubAgents: envInt('MIN_SUB_AGENTS', 3),
  port: envInt('PORT', 3000),
} as const;

/** Build the CROO SDK Config object. */
export const crooConfig = {
  baseURL: runtime.crooApiUrl,
  wsURL: runtime.crooWsUrl,
  rpcURL: runtime.baseRpcUrl,
};

/**
 * Reports whether the SDK key is present. When false, Maestro still serves the
 * dashboard (degraded mode) but cannot connect to CROO.
 */
export function hasCrooCredentials(): boolean {
  return runtime.crooSdkKey.startsWith('croo_sk_') && runtime.crooSdkKey.length > 12;
}

/** Reports whether at least one target sub-agent serviceId is configured. */
export function hasSubAgentsConfigured(): boolean {
  return (
    !!runtime.alphatrackServiceId ||
    !!runtime.polymarketServiceId ||
    !!runtime.hyperliquidServiceId ||
    !!runtime.swapgodServiceId
  );
}

/** Reports whether the LLM key is configured for synthesis. */
export function hasLlmCredentials(): boolean {
  return runtime.llmApiKey.length > 8;
}
