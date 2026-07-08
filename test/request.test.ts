import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRequest, parseRiskAppetite } from '../src/request.js';

test('parseRequest parses structured JSON requirements', () => {
  const req = parseRequest(
    JSON.stringify({
      capitalUsdc: 5000,
      riskAppetite: 'high',
      chain: 'base',
      preferences: 'yield farming, avoid stablecoins',
      horizonDays: 30,
      tokens: ['ETH', 'AERO'],
    }),
  );
  assert.equal(req.capitalUsdc, 5000);
  assert.equal(req.riskAppetite, 'high');
  assert.equal(req.chain, 'base');
  assert.equal(req.horizonDays, 30);
  assert.deepEqual(req.tokens, ['ETH', 'AERO']);
});

test('parseRequest extracts capital from natural language', () => {
  const req = parseRequest('I have $10,000 USDC and want a low risk portfolio on Base');
  assert.equal(req.capitalUsdc, 10000);
  assert.equal(req.riskAppetite, 'low');
  assert.equal(req.chain, 'base');
});

test('parseRequest handles k/m suffixes', () => {
  const req = parseRequest('Deploy 5k USDC, aggressive, hyperliquid');
  assert.equal(req.capitalUsdc, 5000);
  assert.equal(req.riskAppetite, 'high');
  assert.equal(req.chain, 'hyperliquid');
});

test('parseRequest applies safe defaults on empty input', () => {
  const req = parseRequest('');
  assert.equal(req.capitalUsdc, 1000);
  assert.equal(req.riskAppetite, 'medium');
  assert.equal(req.chain, 'base');
});

test('parseRiskAppetite recognizes synonyms', () => {
  assert.equal(parseRiskAppetite('conservative'), 'low');
  assert.equal(parseRiskAppetite('degen'), 'high');
  assert.equal(parseRiskAppetite('risk-on'), 'high');
  assert.equal(parseRiskAppetite('balanced'), 'medium');
  assert.equal(parseRiskAppetite('garbage'), 'medium');
  assert.equal(parseRiskAppetite(undefined, 'low'), 'low');
});
