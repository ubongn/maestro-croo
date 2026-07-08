/**
 * Provider mode — Maestro receives user orders, auto-accepts negotiations, and
 * fires orchestration once the user pays.
 *
 * Event routing: the {@link CrooBus} delivers every event for Maestro's
 * connection. To avoid acting on orders Maestro *placed itself* as a consumer,
 * we skip any negotiation whose id is in the shared `outboundNegotiations` set
 * (populated by the {@link Consumer}). Everything else is an incoming user
 * order that we, as provider, must accept and later deliver.
 */
import { AgentClient, EventType } from '@croo-network/sdk';
import { CrooBus } from './event-bus.js';
import { USDC_DECIMALS } from './config.js';
import { parseRequest } from './request.js';
import { state } from './state.js';

function toUsdc(priceBaseUnits: string | undefined): number | null {
  if (!priceBaseUnits) return null;
  const n = Number(priceBaseUnits);
  if (!Number.isFinite(n)) return null;
  return Math.round((n / 10 ** USDC_DECIMALS) * 1_000_000) / 1_000_000;
}

export class Provider {
  /** Order ids where Maestro is the provider (must deliver results). */
  readonly providingOrders = new Set<string>();
  /** Maestro's own agent id, discovered from the first accepted order. */
  selfAgentId: string | null = null;

  private onOrderPaid?: (orderId: string) => void | Promise<void>;

  constructor(
    private readonly client: AgentClient,
    private readonly bus: CrooBus,
    private readonly outboundNegotiations: Set<string>,
  ) {}

  /** Register the callback invoked when a user pays Maestro for an order. */
  onPaid(fn: (orderId: string) => void | Promise<void>): void {
    this.onOrderPaid = fn;
  }

  /** Wire provider handlers into the event bus. */
  attach(): void {
    this.bus.subscribe((e) => {
      if (e.type === EventType.NegotiationCreated && e.negotiation_id) {
        this.handleNegotiationCreated(e.negotiation_id).catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          state.pushFeed('error', 'provider', 'Negotiation handling failed', msg, {
            type: 'error',
          });
        });
      } else if (e.type === EventType.OrderPaid && e.order_id) {
        this.handleOrderPaid(e.order_id);
      }
    });
  }

  private async handleNegotiationCreated(negotiationId: string): Promise<void> {
    // Skip negotiations Maestro originated as a consumer.
    if (this.outboundNegotiations.has(negotiationId)) {
      this.outboundNegotiations.delete(negotiationId);
      return;
    }

    state.pushFeed('info', 'provider', 'Incoming strategy request', `negotiation ${negotiationId.slice(0, 8)}…`, {
      type: 'negotiate',
    });

    let orderId: string;
    try {
      const result = await this.client.acceptNegotiation(negotiationId);
      orderId = result.order.orderId;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      state.pushFeed('error', 'provider', 'Failed to accept negotiation', msg, {
        type: 'error',
      });
      return;
    }

    this.providingOrders.add(orderId);

    // Pull the negotiation requirements (for labeling) + order price/identity.
    let priceUsdc: number | null = null;
    let req = parseRequest(undefined);
    try {
      const full = await this.client.getOrder(orderId);
      priceUsdc = toUsdc(full.price);
      if (!this.selfAgentId && full.providerAgentId) this.selfAgentId = full.providerAgentId;
      if (full.providerWalletAddress) state.setWallet({ address: full.providerWalletAddress });
      try {
        const neg = await this.client.getNegotiation(negotiationId);
        req = parseRequest(neg.requirements);
      } catch {
        /* requirements optional */
      }
    } catch {
      // getOrder failed — still track the order for when payment lands.
    }

    state.recordIncoming({
      orderId,
      status: 'accepted',
      priceUsdc,
      requestLabel: `${req.riskAppetite} • ${req.chain} • $${req.capitalUsdc.toLocaleString('en-US')}`,
      riskAppetite: req.riskAppetite,
      capitalUsdc: req.capitalUsdc,
      phase: 'awaiting payment',
      startedAt: Date.now(),
    });
    state.pushFeed('success', 'provider', 'Negotiation accepted', `order ${orderId.slice(0, 8)}… created`, {
      type: 'accept',
      orderId,
    });
  }

  private handleOrderPaid(orderId: string): void {
    if (!this.providingOrders.has(orderId)) return; // not a provider order → ignore
    state.pushFeed('success', 'provider', 'Payment received', `order ${orderId.slice(0, 8)}… paid — orchestrating`, {
      type: 'paid',
      orderId,
    });
    state.updateIncomingPhase(orderId, 'orchestrating', 'paid');
    void this.onOrderPaid?.(orderId);
  }
}
