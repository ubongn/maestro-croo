/**
 * Race-safe event bus layered on top of the CROO SDK `EventStream`.
 *
 * Why this exists: Maestro is simultaneously a *provider* (receives user orders)
 * and a *consumer* (hires sub-agents). A single WebSocket therefore delivers
 * events for BOTH roles — `OrderPaid` fires when a user pays Maestro AND when
 * Maestro pays a sub-agent. We must route each event to the right handler.
 *
 * Strategy: a short TTL buffer + a `waitFor(predicate)` that first scans the
 * buffer (consuming the match) and only then subscribes for future events. This
 * closes the race where an event (e.g. `OrderCreated`) arrives in the gap
 * between `negotiateOrder()` returning and the matching listener registering.
 */
import type { Event } from '@croo-network/sdk';

export type CrooEvent = Event;

interface Buffered {
  ev: CrooEvent;
  ts: number;
}

export class CrooBus {
  private buffer: Buffered[] = [];
  private listeners = new Set<(ev: CrooEvent) => void>();

  constructor(
    private readonly maxBuffer = 500,
    private readonly ttlMs = 120_000,
  ) {}

  /** Ingest an event from the SDK stream. */
  push(ev: CrooEvent): void {
    const now = Date.now();
    this.buffer.push({ ev, ts: now });
    // Prune by TTL and cap.
    this.buffer = this.buffer.filter((b) => now - b.ts <= this.ttlMs).slice(-this.maxBuffer);
    for (const fn of this.listeners) {
      try {
        fn(ev);
      } catch (err) {
        // A listener throwing must never break the bus.
        console.error('[maestro] event listener error:', err);
      }
    }
  }

  /** Subscribe to every event. Returns an unsubscribe function. */
  subscribe(fn: (ev: CrooEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * Resolve with the first event matching `predicate`. Checks the buffered
   * backlog first (consuming the match) so events that already arrived are not
   * lost. Rejects with a TimeoutError if no match within `timeoutMs`.
   */
  waitFor(predicate: (ev: CrooEvent) => boolean, timeoutMs: number): Promise<CrooEvent> {
    // 1. Check backlog.
    for (let i = 0; i < this.buffer.length; i++) {
      if (predicate(this.buffer[i].ev)) {
        const matched = this.buffer.splice(i, 1)[0].ev;
        return Promise.resolve(matched);
      }
    }
    // 2. Subscribe for future events.
    return new Promise<CrooEvent>((resolve, reject) => {
      const timer = setTimeout(() => {
        unsub();
        reject(new TimeoutError(`waitFor timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const unsub = this.subscribe((ev) => {
        if (predicate(ev)) {
          clearTimeout(timer);
          unsub();
          resolve(ev);
        }
      });
    });
  }

  /** Read-only snapshot of recent buffered events (for debugging / dashboard). */
  recent(limit = 50): CrooEvent[] {
    return this.buffer.slice(-limit).map((b) => b.ev);
  }
}

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}
