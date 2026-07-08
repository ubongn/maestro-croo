/**
 * Consumer mode — Maestro hires other CROO agents as a requester.
 *
 * `hireAgent()` turns the full sub-order lifecycle (negotiate → wait for the
 * provider to create the order → pay → wait for delivery → fetch delivery)
 * into a single async call with a hard timeout and fast-fail on rejection.
 *
 * All event correlation is done via the {@link CrooBus} so events are never lost
 * to registration races.
 */
import {
  AgentClient,
  DeliverableType,
  EventType,
  isInsufficientBalance,
  isNotFound,
} from '@croo-network/sdk';
import { CrooBus, TimeoutError } from './event-bus.js';
import { state } from './state.js';
import { USDC_DECIMALS } from './config.js';
import type { HireResult, ResolvedAgent, StrategyRequest } from './types.js';

/** Build the requirements string a target agent receives. Pure. */
export function buildRequirements(agent: ResolvedAgent, req: StrategyRequest): string {
  switch (agent.id) {
    case 'alphatrack':
      // text-type service — ignores input, returns top traders leaderboard
      return JSON.stringify({ task: 'top_traders' });

    case 'polymarket': {
      // schema-type: requires wallet_address
      // Use wallet from env, request, or a known profitable default
      const envWallet = process.env.POLYMARKET_TRACK_WALLET?.trim();
      const reqWallet = (req.tokens ?? []).find((t) => /^0x[a-fA-F0-9]{40}$/.test(t));
      const wallet = envWallet || reqWallet || '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
      return JSON.stringify({ wallet_address: wallet });
    }

    case 'hyperliquid':
      // schema-type: all params optional — list top vaults by TVL
      return JSON.stringify({ limit: 10, sort_by: 'tvl' });

    case 'swapgod':
      // fund-transfer service — only used for execution, not intel gathering
      return JSON.stringify({
        principal_amount: req.capitalUsdc,
        token_out: (req.tokens ?? ['ETH'])[0],
        recipient: '',
      });

    default:
      return JSON.stringify({
        task: agent.description,
        chain: req.chain,
        riskAppetite: req.riskAppetite,
        capitalUsdc: req.capitalUsdc,
        preferences: req.preferences,
      });
  }
}

function toUsdc(priceBaseUnits: string | undefined): number | null {
  if (!priceBaseUnits) return null;
  const n = Number(priceBaseUnits);
  if (!Number.isFinite(n)) return null;
  return Math.round((n / 10 ** USDC_DECIMALS) * 1_000_000) / 1_000_000;
}

export class Consumer {
  constructor(
    private readonly client: AgentClient,
    private readonly bus: CrooBus,
    private readonly outboundNegotiations: Set<string>,
  ) {}

  /**
   * Hire a single target agent end-to-end. Resolves with a {@link HireResult};
   * never throws — failures are captured as `status: 'failed' | 'timeout'`.
   */
  async hireAgent(agent: ResolvedAgent, requirements: string, timeoutMs: number): Promise<HireResult> {
    const started = Date.now();
    const result: HireResult = {
      agent,
      orderId: null,
      negotiationId: null,
      status: 'pending',
      payload: null,
      payloadKind: null,
      priceUsdc: null,
      durationMs: 0,
      error: null,
    };

    // Record an in-flight sub-order for the dashboard.
    const sub = state.addSubOrder({
      orderId: null,
      agentName: agent.name,
      role: agent.role,
      glyph: agent.glyph,
      status: 'pending',
      priceUsdc: null,
      paid: false,
      delivered: false,
      error: null,
      durationMs: 0,
    });

    try {
      // 1. Negotiate.
      const neg = await this.client.negotiateOrder({ serviceId: agent.serviceId, requirements });
      result.negotiationId = neg.negotiationId;
      this.outboundNegotiations.add(neg.negotiationId);
      state.pushFeed('info', 'consumer', `Negotiating with ${agent.name}`, `service ${agent.serviceId.slice(0, 8)}…`, { type: 'negotiate' });

      // 2. Wait for the provider to accept → order created (or negotiation dies).
      const perStep = Math.max(15_000, Math.floor(timeoutMs / 3));
      const created = await this.bus.waitFor(
        (e) =>
          e.negotiation_id === neg.negotiationId &&
          (e.type === EventType.OrderCreated ||
            e.type === EventType.NegotiationRejected ||
            e.type === EventType.NegotiationExpired),
        perStep,
      );
      if (created.type !== EventType.OrderCreated) {
        throw new Error(`negotiation ${created.type.replace('order_negotiation_', '')}: ${created.reason ?? 'no reason'}`);
      }
      const orderId = created.order_id!;
      result.orderId = orderId;

      // Fetch order to surface price.
      const order = await this.client.getOrder(orderId);
      result.priceUsdc = toUsdc(order.price);
      state.updateSubOrder(sub, { orderId, priceUsdc: result.priceUsdc });

      // 3. Pay.
      try {
        await this.client.payOrder(orderId);
      } catch (payErr) {
        if (isInsufficientBalance(payErr)) {
          throw new Error(`insufficient USDC balance to pay ${agent.name}`);
        }
        throw payErr;
      }
      result.status = 'pending';
      state.updateSubOrder(sub, { paid: true });
      state.pushFeed('success', 'consumer', `Paid ${agent.name}`, `$${result.priceUsdc ?? '?'} USDC escrowed`, {
        type: 'pay',
        orderId,
      });

      // 4. Wait for completion (or rejection/expiration).
      const done = await this.bus.waitFor(
        (e) =>
          e.order_id === orderId &&
          (e.type === EventType.OrderCompleted || e.type === EventType.OrderRejected || e.type === EventType.OrderExpired),
        Math.max(perStep, timeoutMs - (Date.now() - started)),
      );
      if (done.type !== EventType.OrderCompleted) {
        throw new Error(`order ${done.type.replace('order_', '')}: ${done.reason ?? 'no reason'}`);
      }

      // 5. Collect delivery.
      const delivery = await this.client.getDelivery(orderId);
      const isSchema = delivery.deliverableType === DeliverableType.Schema;
      result.payload = isSchema ? delivery.deliverableSchema : delivery.deliverableText;
      result.payloadKind = isSchema ? 'schema' : 'text';
      result.status = 'success';
      state.updateSubOrder(sub, { status: 'success', delivered: true, durationMs: Date.now() - started });
      state.pushFeed('success', 'consumer', `${agent.name} delivered`, result.payloadKind ?? 'delivery', {
        type: 'deliver',
        orderId,
      });
    } catch (err) {
      const isTimeout = err instanceof TimeoutError;
      result.status = isTimeout ? 'timeout' : 'failed';
      result.error = err instanceof Error ? err.message : String(err);
      if (result.orderId) {
        state.updateSubOrder(sub, { orderId: result.orderId, status: result.status, error: result.error, durationMs: Date.now() - started });
      } else {
        state.updateSubOrder(sub, { status: result.status, error: result.error, durationMs: Date.now() - started });
      }
      // Suppress noisy "not found" spam when a delivery is genuinely absent.
      if (!(err instanceof Error && isNotFound(err))) {
        state.pushFeed('warn', 'consumer', `${agent.name} ${result.status}`, result.error, {
          type: result.status,
          orderId: result.orderId ?? undefined,
        });
      }
    } finally {
      result.durationMs = Date.now() - started;
    }
    return result;
  }
}
