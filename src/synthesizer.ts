/**
 * Strategy synthesis via an OpenAI-compatible chat-completions API.
 *
 * Takes the user's strategy request + every collected sub-agent delivery and
 * asks the LLM to produce a single, coherent, structured DeFi allocation
 * strategy. The JSON is parsed with strict validation + normalization so the
 * delivered schema is always well-formed, even when the model is imperfect.
 *
 * If the LLM call fails entirely, we degrade gracefully: we still deliver a
 * valid strategy assembled directly from the raw sub-agent intelligence (this
 * is *not* a mock — it uses the real collected data, just without prose polish).
 */
import { runtime } from './config.js';
import type { HireResult, RiskAppetite, StrategyAllocation, StrategyRequest, StrategyResult } from './types.js';

const SYSTEM_PROMPT = `You are Maestro, an elite on-chain asset allocator that composes complete DeFi strategies by synthesizing intelligence purchased from specialized AI agents on the CROO Network.

You are given (1) an investor's request and (2) structured intelligence delivered by several specialist sub-agents (smart-money tracking, prediction-market sentiment, vault performance, execution, risk). Your job is to fuse ALL of it into one coherent, actionable allocation plan.

Respond with a SINGLE JSON object and NOTHING else, matching exactly this schema:
{
  "summary": "string — 2-4 sentences synthesizing the market read and the recommended posture",
  "riskLevel": "low" | "medium" | "high",
  "riskScore": "integer 0-100 (higher = riskier recommended portfolio)",
  "allocations": [
    {
      "asset": "string token/asset symbol, e.g. ETH, USDC, BTC",
      "protocol": "string protocol/venue, e.g. Aave, Hyperliquid vault, Aerodrome",
      "percentage": "number 0-100, must sum to 100 across all allocations",
      "vehicle": "string how to deploy, e.g. lend, LP, vault deposit, hold",
      "rationale": "one sentence citing the sub-agent intelligence that justifies it"
    }
  ],
  "actionItems": ["ordered list of concrete steps to execute the strategy"],
  "warnings": ["material risks, caveats, and disclaimers"]
}

Rules:
- Allocation percentages MUST be non-negative numbers that sum to 100.
- Ground every allocation in the provided sub-agent intelligence; cite which agent's data drove it in the rationale.
- Respect the investor's risk appetite and capital. Do not invent price targets or guaranteed returns.
- Be specific and professional. No filler.`;

/** Build the user prompt from the request + collected intelligence. Pure. */
export function buildUserPrompt(req: StrategyRequest, hires: HireResult[]): string {
  const intel = hires
    .filter((h) => h.status === 'success' && h.payload)
    .map((h) => `### ${h.agent.name} (${h.agent.role})\n${h.payload}`)
    .join('\n\n');

  const failed = hires
    .filter((h) => h.status !== 'success')
    .map((h) => `- ${h.agent.name}: ${h.error ?? h.status}`)
    .join('\n');

  return [
    `INVESTOR REQUEST:`,
    `- Capital: $${req.capitalUsdc.toLocaleString('en-US')} USDC`,
    `- Risk appetite: ${req.riskAppetite}`,
    `- Chain focus: ${req.chain}`,
    `- Horizon: ${req.horizonDays ? req.horizonDays + ' days' : 'unspecified'}`,
    `- Preferences: ${req.preferences || 'none stated'}`,
    `- Tokens of interest: ${(req.tokens ?? []).join(', ') || 'none specified'}`,
    ``,
    `SUB-AGENT INTELLIGENCE:`,
    intel || '(no deliveries received)',
    failed ? `\nUNAVAILABLE AGENTS:\n${failed}\n` : '',
  ].join('\n');
}

interface LlmChoice {
  message?: { content?: string };
}

interface LlmResponse {
  choices?: LlmChoice[];
  error?: { message: string };
}

/** Call the OpenAI-compatible chat completions endpoint. */
export async function callLLM(messages: {
  role: 'system' | 'user';
  content: string;
}[]): Promise<string> {
  const url = `${runtime.llmBaseUrl.replace(/\/$/, '')}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), runtime.llmTimeoutMs);

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${runtime.llmApiKey}`,
      },
      body: JSON.stringify({
        model: runtime.llmModel,
        messages,
        temperature: 0.4,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });

    const data = (await resp.json()) as LlmResponse;
    if (!resp.ok) {
      throw new Error(`LLM HTTP ${resp.status}: ${data.error?.message ?? 'unknown error'}`);
    }
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('LLM returned no content');
    return content;
  } finally {
    clearTimeout(timer);
  }
}

/** Pull the first balanced JSON object out of a (possibly chatty) string. Pure. */
export function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  // Fast path: already valid JSON.
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through */
  }
  // Fallback: locate the outermost { ... }.
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('no JSON object found in LLM response');
  }
  return JSON.parse(trimmed.slice(start, end + 1));
}

function clampRiskLevel(level: unknown): RiskAppetite | null {
  const l = String(level ?? '').toLowerCase().trim();
  if (!l) return null;
  if (l.startsWith('low')) return 'low';
  if (l.startsWith('high')) return 'high';
  if (l.startsWith('medium')) return 'medium';
  return null;
}

function levelFromScore(score: number): RiskAppetite {
  if (score < 34) return 'low';
  if (score < 67) return 'medium';
  return 'high';
}

/** Parse + validate + normalize raw model output into a StrategyResult. Pure. */
export function parseStrategy(rawText: string, req: StrategyRequest, hires: HireResult[]): StrategyResult {
  const obj = extractJson(rawText) as Record<string, unknown>;

  const rawAllocations = Array.isArray(obj.allocations) ? (obj.allocations as Record<string, unknown>[]) : [];
  const allocations: StrategyAllocation[] = rawAllocations
    .map((a) => ({
      asset: String(a.asset ?? 'UNKNOWN').trim().toUpperCase(),
      protocol: String(a.protocol ?? 'Unknown').trim(),
      percentage: Math.max(0, Number(a.percentage) || 0),
      vehicle: String(a.vehicle ?? 'hold').trim(),
      rationale: String(a.rationale ?? '').trim(),
    }))
    .filter((a) => a.asset && a.asset !== 'UNKNOWN' ? true : true) // keep even unknowns for transparency
    .filter((a) => a.percentage >= 0 && (a.asset || a.protocol));

  // Normalize percentages to sum to exactly 100.
  const total = allocations.reduce((s, a) => s + a.percentage, 0);
  if (total > 0 && Math.abs(total - 100) > 0.5) {
    const scale = 100 / total;
    allocations.forEach((a) => (a.percentage = Math.round(a.percentage * scale * 10) / 10));
    // Fix rounding drift on the largest slice.
    const drift = 100 - allocations.reduce((s, a) => s + a.percentage, 0);
    if (allocations.length) allocations[0].percentage = Math.round((allocations[0].percentage + drift) * 10) / 10;
  } else if (total <= 0 && allocations.length) {
    // Equal weight if model gave no usable percentages.
    const each = Math.round((100 / allocations.length) * 10) / 10;
    allocations.forEach((a) => (a.percentage = each));
    const drift = 100 - allocations.reduce((s, a) => s + a.percentage, 0);
    allocations[0].percentage = Math.round((allocations[0].percentage + drift) * 10) / 10;
  }

  const riskScore = Math.max(0, Math.min(100, Math.round(Number(obj.riskScore) || 0)));
  const rawLevel = clampRiskLevel(obj.riskLevel);
  const riskLevel = rawLevel || levelFromScore(riskScore) || req.riskAppetite;

  const summary = String(obj.summary ?? '').trim() || 'Strategy synthesized from purchased agent intelligence.';

  const actionItems = Array.isArray(obj.actionItems)
    ? (obj.actionItems as unknown[]).map((x) => String(x)).filter(Boolean)
    : [];
  const warnings = Array.isArray(obj.warnings)
    ? (obj.warnings as unknown[]).map((x) => String(x)).filter(Boolean)
    : ['On-chain markets are volatile. Not financial advice.'];

  const sources = hires
    .filter((h) => h.status === 'success' && h.orderId)
    .map((h) => ({ agent: h.agent.name, role: h.agent.role, orderId: h.orderId! }));

  return {
    summary,
    riskLevel,
    riskScore,
    allocations,
    actionItems,
    warnings,
    sources,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Assemble a valid strategy directly from raw intelligence when the LLM is
 * unavailable. Uses real sub-agent payloads — only the prose synthesis is
 * skipped. Never invents fake market data.
 */
export function fallbackStrategy(req: StrategyRequest, hires: HireResult[]): StrategyResult {
  const successful = hires.filter((h) => h.status === 'success');
  // Derive allocation tokens from successful intelligence payloads where possible.
  const tokens = new Set<string>();
  for (const h of successful) {
    if (!h.payload) continue;
    const found = h.payload.match(/\b([A-Z]{2,6})\b/g);
    if (found) found.slice(0, 4).forEach((t) => tokens.add(t));
  }
  if (!tokens.size) tokens.add(req.chain ? req.chain.toUpperCase() : 'USDC');
  // Always hold some stablecoin reserve unless ultra-aggressive.
  if (req.riskAppetite !== 'high') tokens.add('USDC');

  const list = [...tokens].slice(0, 6);
  const each = Math.round((100 / list.length) * 10) / 10;
  const allocations: StrategyAllocation[] = list.map((asset) => ({
    asset,
    protocol: asset === 'USDC' ? 'Aave' : 'direct hold',
    percentage: each,
    vehicle: asset === 'USDC' ? 'lend (reserve)' : 'hold',
    rationale: 'Allocation derived from collected sub-agent intelligence (LLM synthesis unavailable).',
  }));
  // Fix drift.
  const drift = 100 - allocations.reduce((s, a) => s + a.percentage, 0);
  allocations[0].percentage = Math.round((allocations[0].percentage + drift) * 10) / 10;

  const riskScore = req.riskAppetite === 'low' ? 25 : req.riskAppetite === 'high' ? 75 : 50;

  return {
    summary:
      `LLM synthesis was unavailable, so this strategy was assembled directly ` +
      `from ${successful.length} sub-agent intelligence delivery/ies. ` +
      `Capital allocated across detected assets with a ${req.riskAppetite}-risk posture.`,
    riskLevel: req.riskAppetite,
    riskScore,
    allocations,
    actionItems: [
      'Review the raw sub-agent intelligence in the dashboard.',
      'Execute allocations via the SwapGod execution agent once available.',
      'Re-run Maestro once LLM synthesis is restored for a polished plan.',
    ],
    warnings: [
      'LLM synthesis was skipped — allocation is a best-effort assembly of raw agent data.',
      'On-chain markets are volatile. Not financial advice.',
    ],
    sources: hires
      .filter((h) => h.status === 'success' && h.orderId)
      .map((h) => ({ agent: h.agent.name, role: h.agent.role, orderId: h.orderId! })),
    generatedAt: new Date().toISOString(),
  };
}

/** Full synthesis: LLM call with parse + graceful fallback. */
export async function synthesize(req: StrategyRequest, hires: HireResult[]): Promise<StrategyResult> {
  try {
    const content = await callLLM([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(req, hires) },
    ]);
    return parseStrategy(content, req, hires);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[maestro] LLM synthesis failed (${msg}); using fallback strategy`);
    return fallbackStrategy(req, hires);
  }
}
