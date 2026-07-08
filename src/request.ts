/**
 * Parse a user's order `requirements` string into a typed {@link StrategyRequest}.
 *
 * CROO orders carry a free-form `requirements` field. We accept either a JSON
 * object or a best-effort natural-language parse, and always coerce to a valid,
 * safe request with sensible defaults. Pure & unit-tested.
 */
import type { RiskAppetite, StrategyRequest } from './types.js';

export function parseRiskAppetite(value: unknown, fallback: RiskAppetite = 'medium'): RiskAppetite {
  const s = String(value ?? '').toLowerCase().trim();
  if (!s) return fallback;
  if (/(^|\b)(low|conservative|safe|capital.?preserv)/.test(s)) return 'low';
  if (/(^|\b)(high|aggressive|degen|yolo|max(imum)?|risk.?on)/.test(s)) return 'high';
  if (/(^|\b)(medium|moderate|balanced)/.test(s)) return 'medium';
  return fallback;
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const n = Number(String(value ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

export function parseRequest(requirements: string | undefined | null): StrategyRequest {
  const raw = String(requirements ?? '').trim();
  let capital: number | undefined;
  let risk: RiskAppetite | undefined;
  let chain = 'base';
  let preferences = '';
  let horizonDays: number | undefined;
  let tokens: string[] | undefined;

  // 1. Structured JSON path.
  if (raw.startsWith('{') || raw.startsWith('[')) {
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      capital = parseNumber(obj.capitalUsdc ?? obj.capital ?? obj.amount ?? obj.usdc);
      risk = parseRiskAppetite(obj.riskAppetite ?? obj.risk ?? obj.riskTolerance);
      if (typeof obj.chain === 'string') chain = obj.chain;
      if (typeof obj.preferences === 'string') preferences = obj.preferences;
      horizonDays = parseNumber(obj.horizonDays ?? obj.horizon);
      if (Array.isArray(obj.tokens)) tokens = (obj.tokens as unknown[]).map((t) => String(t)).filter(Boolean);
    } catch {
      /* fall through to heuristic parse */
    }
  }

  // 2. Heuristic natural-language path (also fills gaps from JSON).
  const lower = raw.toLowerCase();
  if (capital === undefined) {
    const m = raw.match(/(?:us)?\$?\s?([0-9][0-9,]*(?:\.[0-9]+)?)\s?(?:k|m)?\s*(?:usdc|usd|\$|dollar)/i);
    if (m) {
      const num = Number(m[1].replace(/,/g, ''));
      const suffix = (raw.match(/([0-9][0-9,]*(?:\.[0-9]+)?)\s*([km])\b/i)?.[2] ?? '').toLowerCase();
      capital = suffix === 'k' ? num * 1_000 : suffix === 'm' ? num * 1_000_000 : num;
    } else {
      const m2 = raw.match(/([0-9][0-9,]{2,}(?:\.[0-9]+)?)/);
      if (m2) capital = Number(m2[1].replace(/,/g, ''));
    }
  }
  if (risk === undefined) risk = parseRiskAppetite(lower);
  if (lower.includes('ethereum') || lower.includes('mainnet')) chain = 'ethereum';
  else if (lower.includes('hyperliquid')) chain = 'hyperliquid';
  else if (lower.includes('base')) chain = 'base';

  // Tokens: short uppercase symbols.
  const tokenMatches = raw.match(/\b([A-Z]{2,6})\b/g);
  if (tokenMatches && !tokens?.length) {
    tokens = [...new Set(tokenMatches)].slice(0, 8);
  }

  if (!preferences) preferences = raw.slice(0, 500);

  const req: StrategyRequest = {
    capitalUsdc: capital && capital > 0 ? Math.round(capital * 100) / 100 : 1_000,
    riskAppetite: risk ?? 'medium',
    chain,
    preferences,
    raw,
  };
  if (horizonDays && horizonDays > 0) req.horizonDays = horizonDays;
  if (tokens && tokens.length) req.tokens = tokens;
  return req;
}
