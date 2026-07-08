import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roleRelevance, selectAgents, TARGET_AGENTS } from '../src/agents-registry.js';
import type { ResolvedAgent, StrategyRequest } from '../src/types.js';

function mkReq(over: Partial<StrategyRequest> = {}): StrategyRequest {
  return {
    capitalUsdc: 5000,
    riskAppetite: 'medium',
    chain: 'base',
    preferences: '',
    raw: '',
    ...over,
  };
}

// A deterministic synthetic pool so tests don't depend on env vars.
const POOL: ResolvedAgent[] = TARGET_AGENTS.map((a) => ({ ...a, serviceId: 'svc_' + a.id }));

test('smart-money is always highly relevant', () => {
  assert.ok(roleRelevance('smart-money', mkReq()) >= 90);
});

test('execution scores higher on Base', () => {
  const onBase = roleRelevance('execution', mkReq({ chain: 'base' }));
  const offBase = roleRelevance('execution', mkReq({ chain: 'ethereum' }));
  assert.ok(onBase > offBase);
});

test('vault-performance scores higher when requested', () => {
  const withVault = roleRelevance('vault-performance', mkReq({ preferences: 'yield vault hyperliquid' }));
  const plain = roleRelevance('vault-performance', mkReq());
  assert.ok(withVault > plain);
});

test('selectAgents respects minSubAgents but caps at pool size', () => {
  const three = selectAgents(mkReq(), POOL.slice(0, 3));
  assert.equal(three.length, 3);
  const two = selectAgents(mkReq(), POOL.slice(0, 2));
  assert.equal(two.length, 2);
});

test('selectAgents orders by relevance (smart-money first)', () => {
  const sel = selectAgents(mkReq({ chain: 'base' }), POOL);
  assert.equal(sel[0].role, 'smart-money');
});

test('selectAgents filters to only provided pool (never returns unconfigured)', () => {
  const sel = selectAgents(mkReq(), []);
  assert.equal(sel.length, 0);
});
