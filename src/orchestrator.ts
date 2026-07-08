/**
 * The orchestration engine — Maestro's brain.
 *
 * Triggered when a user pays Maestro (provider side). It then:
 *   1. Reconstructs the user's {@link StrategyRequest} from the order.
 *   2. Selects which sub-agents to hire (consumer mode).
 *   3. Hires them in parallel, each bounded by the SLA deadline.
 *   4. Synthesizes all deliveries into one strategy via the LLM.
 *   5. Delivers the structured strategy back to the user on-chain.
 *
 * It is deliberately fault-tolerant: a subset of agents failing still yields a
 * complete (if partial) strategy, and the SLA deadline is always respected.
 */
import { AgentClient, DeliverableType, isInvalidStatus } from '@croo-network/sdk';
import { runtime } from './config.js';
import { configuredAgents, selectAgents } from './agents-registry.js';
import { Consumer, buildRequirements } from './consumer.js';
import { Provider } from './provider.js';
import { parseRequest } from './request.js';
import { synthesize } from './synthesizer.js';
import { state } from './state.js';
import type { HireResult, StrategyRequest, StrategyResult } from './types.js';

export class Orchestrator {
  constructor(
    private readonly client: AgentClient,
    private readonly consumer: Consumer,
    private readonly provider: Provider,
  ) {}

  /** Wire the provider's "paid" signal to orchestration. */
  attach(): void {
    this.provider.onPaid((orderId) => {
      // Fire-and-forget; errors are captured inside.
      this.orchestrate(orderId).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        state.pushFeed('error', 'system', 'Orchestration crashed', msg, {
          type: 'error',
          orderId,
        });
      });
    });
  }

  /** Reconstruct the request from the paid order + its negotiation. */
  private async fetchRequest(orderId: string): Promise<StrategyRequest> {
    try {
      const order = await this.client.getOrder(orderId);
      if (order.providerWalletAddress) state.setWallet({ address: order.providerWalletAddress });
      try {
        const neg = await this.client.getNegotiation(order.negotiationId);
        return parseRequest(neg.requirements);
      } catch {
        return parseRequest(undefined);
      }
    } catch {
      return parseRequest(undefined);
    }
  }

  /** Hire all selected agents in parallel, each bounded by `budgetMs`. */
  private async hireAll(
    agents: ReturnType<typeof selectAgents>,
    req: StrategyRequest,
    budgetMs: number,
  ): Promise<HireResult[]> {
    state.pushFeed('info', 'system', `Hiring ${agents.length} sub-agent(s)`, agents.map((a) => a.name).join(', '), {
      type: 'hire',
    });
    const results = await Promise.all(
      agents.map((agent) => this.consumer.hireAgent(agent, buildRequirements(agent, req), budgetMs)),
    );
    const ok = results.filter((r) => r.status === 'success').length;
    state.pushFeed(
      ok === agents.length ? 'success' : 'warn',
      'system',
      `Sub-agents done: ${ok}/${agents.length} succeeded`,
      results.map((r) => `${r.agent.name}:${r.status}`).join('  '),
      { type: 'hired' },
    );
    return results;
  }

  /** Deliver the synthesized strategy on-chain back to the requester. */
  private async deliver(orderId: string, strategy: StrategyResult): Promise<void> {
    const payload = JSON.stringify(strategy);
    try {
      const result = await this.client.deliverOrder(orderId, {
        deliverableType: DeliverableType.Schema,
        deliverableSchema: payload,
      });
      state.updateIncomingPhase(orderId, 'delivered', result.order.status);
      state.pushFeed('success', 'provider', 'Strategy delivered', `tx ${result.txHash?.slice(0, 10) ?? 'n/a'}…`, {
        type: 'deliver',
        orderId,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // If the order is already in a terminal state, don't loop forever.
      if (isInvalidStatus(err)) {
        state.updateIncomingPhase(orderId, 'delivery skipped', 'completed');
        state.pushFeed('warn', 'provider', 'Delivery skipped (terminal order)', msg, {
          type: 'skip',
          orderId,
        });
        return;
      }
      state.updateIncomingPhase(orderId, 'delivery failed');
      state.pushFeed('error', 'provider', 'Delivery failed', msg, {
        type: 'error',
        orderId,
      });
      throw err;
    }
  }

  /** Full orchestration for a single paid provider order. */
  async orchestrate(orderId: string): Promise<void> {
    const start = Date.now();
    state.updateIncomingPhase(orderId, 'parsing request');

    const req = await this.fetchRequest(orderId);
    state.updateIncomingPhase(orderId, 'selecting agents');

    // Determine the SLA budget: the order's delivery window, capped by config.
    let budgetMs = runtime.orchestrationTimeoutMs;
    try {
      const order = await this.client.getOrder(orderId);
      const sla = order.slaDeadline ? Date.parse(order.slaDeadline) - Date.now() : Infinity;
      if (Number.isFinite(sla) && sla > 0) budgetMs = Math.min(budgetMs, sla - 5_000);
    } catch {
      /* keep config default */
    }
    budgetMs = Math.max(20_000, Math.min(budgetMs, runtime.orchestrationTimeoutMs));

    if (configuredAgents().length === 0) {
      state.pushFeed(
        'warn',
        'system',
        'No sub-agents configured',
        'Set *_SERVICE_ID env vars; delivering a generic strategy.',
        { type: 'config' },
      );
    }

    const agents = selectAgents(req);

    // Hire in parallel.
    state.updateIncomingPhase(orderId, `hiring ${agents.length} agents`);
    const hires = await this.hireAll(agents, req, budgetMs);

    // Synthesize.
    state.updateIncomingPhase(orderId, 'synthesizing strategy');
    const synthStart = Date.now();
    const strategy = await synthesize(req, hires);
    state.addStrategy(orderId, strategy, Date.now() - synthStart);
    state.pushFeed('success', 'system', 'Strategy synthesized', `${strategy.allocations.length} allocations • risk ${strategy.riskLevel}`, {
      type: 'synthesize',
      orderId,
    });

    // Deliver.
    state.updateIncomingPhase(orderId, 'delivering');
    await this.deliver(orderId, strategy);

    state.pushFeed('success', 'system', 'Orchestration complete', `${((Date.now() - start) / 1000).toFixed(1)}s total`, {
      type: 'done',
      orderId,
    });
  }
}
