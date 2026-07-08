import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CrooBus, TimeoutError } from '../src/event-bus.js';

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

test('waitFor resolves an event that arrives later', async () => {
  const bus = new CrooBus();
  const p = bus.waitFor((e) => e.order_id === 'o1', 500);
  await delay(10);
  bus.push({ type: 'order_paid', raw: {}, order_id: 'o1' });
  const ev = await p;
  assert.equal(ev.order_id, 'o1');
});

test('waitFor recovers a buffered event that already arrived (no race loss)', async () => {
  const bus = new CrooBus();
  // Event lands BEFORE the waiter registers — classic race.
  bus.push({ type: 'order_created', raw: {}, negotiation_id: 'n1', order_id: 'o1' });
  await delay(5);
  const ev = await bus.waitFor((e) => e.negotiation_id === 'n1', 500);
  assert.equal(ev.order_id, 'o1');
});

test('waitFor rejects with TimeoutError when nothing matches', async () => {
  const bus = new CrooBus();
  await assert.rejects(() => bus.waitFor((e) => e.order_id === 'nope', 50), TimeoutError);
});

test('subscribe receives every pushed event', async () => {
  const bus = new CrooBus();
  const seen: string[] = [];
  bus.subscribe((e) => seen.push(e.type));
  bus.push({ type: 'order_paid', raw: {} });
  bus.push({ type: 'order_completed', raw: {} });
  await delay(5);
  assert.deepEqual(seen, ['order_paid', 'order_completed']);
});

test('a throwing subscriber does not break the bus', () => {
  const bus = new CrooBus();
  bus.subscribe(() => {
    throw new Error('boom');
  });
  let got = false;
  bus.subscribe(() => (got = true));
  bus.push({ type: 'order_paid', raw: {} });
  assert.equal(got, true);
});
