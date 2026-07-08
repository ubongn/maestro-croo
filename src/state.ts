/**
 * In-memory dashboard state.
 *
 * Maestro is a long-running process; this store is the single source of truth
 * that every subsystem (provider, consumer, orchestrator, wallet) mutates and
 * that the HTTP server reads at GET /api/state. It is intentionally simple
 * (single-threaded Node) and bounded so memory stays flat over time.
 */
import { runtime } from './config.js';
import type {
  DashboardState,
  FeedEvent,
  IncomingOrderView,
  StrategyResult,
  SubOrderView,
  WalletSnapshot,
} from './types.js';

const FEED_CAP = 300;
const LIST_CAP = 60;

let feedSeq = 0;

class StateStore {
  startedAt = Date.now();

  wallet: WalletSnapshot = { address: null, ethWei: null, usdc: null, fetchedAt: null };

  incoming: IncomingOrderView[] = [];
  subOrders: SubOrderView[] = [];
  strategies: { orderId: string; summary: string; riskLevel: StrategyResult['riskLevel']; createdAt: number; result: StrategyResult }[] = [];
  feed: FeedEvent[] = [];

  private synthesisDurations: number[] = [];

  pushFeed(kind: FeedEvent['kind'], role: FeedEvent['role'], label: string, detail: string, extra?: { type?: string; orderId?: string }): void {
    this.feed.push({
      id: `f${++feedSeq}`,
      ts: Date.now(),
      type: extra?.type ?? 'system',
      role,
      label,
      detail,
      kind,
      orderId: extra?.orderId,
    });
    if (this.feed.length > FEED_CAP) this.feed = this.feed.slice(-FEED_CAP);
  }

  recordIncoming(view: IncomingOrderView): void {
    this.incoming.unshift(view);
    if (this.incoming.length > LIST_CAP) this.incoming = this.incoming.slice(0, LIST_CAP);
  }

  updateIncomingPhase(orderId: string, phase: string, status?: string): void {
    const o = this.incoming.find((x) => x.orderId === orderId);
    if (o) {
      o.phase = phase;
      if (status) o.status = status;
    }
  }

  addSubOrder(view: SubOrderView): SubOrderView {
    const stored = { ...view };
    this.subOrders.unshift(stored);
    if (this.subOrders.length > LIST_CAP) this.subOrders = this.subOrders.slice(0, LIST_CAP);
    return stored;
  }

  updateSubOrder(view: SubOrderView, patch: Partial<SubOrderView>): void {
    Object.assign(view, patch);
  }

  addStrategy(orderId: string, result: StrategyResult, durationMs: number): void {
    this.strategies.unshift({
      orderId,
      summary: result.summary,
      riskLevel: result.riskLevel,
      createdAt: Date.now(),
      result,
    });
    if (this.strategies.length > LIST_CAP) this.strategies = this.strategies.slice(0, LIST_CAP);
    this.synthesisDurations.push(durationMs);
    if (this.synthesisDurations.length > 50) this.synthesisDurations.shift();
  }

  setWallet(patch: Partial<WalletSnapshot>): void {
    this.wallet = { ...this.wallet, ...patch };
  }

  private get stats() {
    const completed = this.strategies.length;
    const agentsHired = this.subOrders.length;
    const success = this.subOrders.filter((s) => s.status === 'success').length;
    const total = this.incoming.length;
    const durs = this.synthesisDurations;
    const avgSynthesisMs = durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : 0;
    return {
      totalOrders: total,
      completedOrders: completed,
      agentsHired,
      successRate: agentsHired ? Math.round((success / agentsHired) * 100) : 0,
      avgSynthesisMs,
    };
  }

  snapshot(): DashboardState {
    return {
      agent: {
        name: 'Maestro',
        tagline: 'DeFi Strategy Orchestrator — hires other CROO agents to build your allocation',
        configured: !!runtime.crooSdkKey && !!runtime.maestroServiceId,
        serviceId: runtime.maestroServiceId || null,
      },
      wallet: this.wallet,
      incoming: this.incoming,
      subOrders: this.subOrders,
      strategies: this.strategies.map((s) => ({
        orderId: s.orderId,
        summary: s.summary,
        riskLevel: s.riskLevel,
        createdAt: s.createdAt,
      })),
      feed: this.feed,
      stats: this.stats,
      uptime: Date.now() - this.startedAt,
      startedAt: this.startedAt,
    };
  }

  strategyFor(orderId: string): StrategyResult | undefined {
    return this.strategies.find((s) => s.orderId === orderId)?.result;
  }
}

export const state = new StateStore();
