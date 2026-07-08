import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJson, parseStrategy, fallbackStrategy } from '../src/synthesizer.js';
import type { HireResult, StrategyRequest } from '../src/types.js';

const REQ: StrategyRequest = {
  capitalUsdc: 5000,
  riskAppetite: 'medium',
  chain: 'base',
  preferences: '',
  raw: '',
};

function mkHire(name: string, ok: boolean, orderId = 'order-1'): HireResult {
  return {
    agent: {
      id: name.toLowerCase(),
      name,
      role: 'smart-money',
      agentId: 'agent-x',
      serviceIdEnvVar: 'X_SERVICE_ID',
      description: 'desc',
      glyph: '🤖',
      serviceId: 'svc-x',
    },
    orderId: ok ? orderId : null,
    negotiationId: ok ? 'neg-1' : null,
    status: ok ? 'success' : 'failed',
    payload: ok ? 'ETH and AERO inflows rising' : null,
    payloadKind: ok ? 'text' : null,
    priceUsdc: ok ? 1 : null,
    durationMs: 1000,
    error: ok ? null : 'boom',
  };
}

test('extractJson parses clean JSON', () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
});

test('extractJson extracts JSON embedded in prose', () => {
  assert.deepEqual(extractJson('Here is the plan:\n{"a":2}\nDone'), { a: 2 });
});

test('extractJson throws when no JSON object present', () => {
  assert.throws(() => extractJson('no json here'));
});

test('parseStrategy normalizes percentages to sum to 100', () => {
  const raw = JSON.stringify({
    summary: 's',
    riskLevel: 'medium',
    riskScore: 50,
    allocations: [
      { asset: 'ETH', protocol: 'p', percentage: 30, vehicle: 'v', rationale: 'r' },
      { asset: 'BTC', protocol: 'p', percentage: 30, vehicle: 'v', rationale: 'r' },
      { asset: 'USDC', protocol: 'p', percentage: 10, vehicle: 'v', rationale: 'r' },
    ],
    actionItems: ['a'],
    warnings: ['w'],
  });
  const res = parseStrategy(raw, REQ, [mkHire('AlphaTrack', true)]);
  const total = res.allocations.reduce((s, a) => s + a.percentage, 0);
  assert.ok(Math.abs(total - 100) < 0.5, `expected ~100 got ${total}`);
});

test('parseStrategy clamps risk score to 0-100', () => {
  const res = parseStrategy(JSON.stringify({ riskScore: 250, allocations: [] }), REQ, []);
  assert.equal(res.riskScore, 100);
});

test('parseStrategy derives riskLevel from score when missing', () => {
  const res = parseStrategy(JSON.stringify({ riskScore: 80, allocations: [] }), REQ, []);
  assert.equal(res.riskLevel, 'high');
});

test('parseStrategy equal-weights when model omits percentages', () => {
  const raw = JSON.stringify({
    allocations: [
      { asset: 'ETH', protocol: 'p', vehicle: 'v' },
      { asset: 'BTC', protocol: 'p', vehicle: 'v' },
    ],
  });
  const res = parseStrategy(raw, REQ, []);
  const total = res.allocations.reduce((s, a) => s + a.percentage, 0);
  assert.ok(Math.abs(total - 100) < 0.5);
});

test('parseStrategy includes sources from successful hires', () => {
  const res = parseStrategy(JSON.stringify({ allocations: [] }), REQ, [
    mkHire('AlphaTrack', true, 'o1'),
    mkHire('Polymarket', false),
  ]);
  assert.equal(res.sources.length, 1);
  assert.equal(res.sources[0].orderId, 'o1');
});

test('fallbackStrategy produces valid equal-weight allocations from real payloads', () => {
  const res = fallbackStrategy(REQ, [mkHire('AlphaTrack', true)]);
  assert.ok(res.allocations.length > 0);
  const total = res.allocations.reduce((s, a) => s + a.percentage, 0);
  assert.ok(Math.abs(total - 100) < 0.5);
  assert.ok(res.warnings.length > 0, 'fallback should warn that LLM was skipped');
  // Must surface the real source, not invent fake data.
  assert.equal(res.sources.length, 1);
});
