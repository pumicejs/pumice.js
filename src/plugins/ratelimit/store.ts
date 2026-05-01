import type {
  RatelimitStateRecord,
  RatelimitStore,
} from "./types.js";

/**
 * In-process ratelimit store backed by a `Map`.
 *
 * Suitable for single-instance deployments. Records are pruned lazily
 * on access, with a periodic sweep to reclaim memory from idle keys.
 *
 * For distributed deployments (multiple Node processes) provide a
 * custom {@link RatelimitStore} backed by Redis or similar.
 */
export class InMemoryRatelimitStore implements RatelimitStore {
  private readonly buckets = new Map<string, RatelimitStateRecord>();
  private lastSweepAt = Date.now();
  private readonly sweepIntervalMs: number;

  /**
   * @param options.sweepIntervalMs How often (in ms) the store opportunistically
   * scans for and removes expired records. Defaults to `60_000`. Sweeps run
   * on the next call after the interval elapses; no timers are scheduled.
   */
  public constructor(options: { sweepIntervalMs?: number } = {}) {
    this.sweepIntervalMs = options.sweepIntervalMs ?? 60_000;
  }

  public async get(key: string): Promise<RatelimitStateRecord | undefined> {
    this.maybeSweep();
    const record = this.buckets.get(key);
    if (!record) {
      return undefined;
    }
    if (this.isFullyExpired(record)) {
      this.buckets.delete(key);
      return undefined;
    }
    return record;
  }

  public async set(key: string, record: RatelimitStateRecord): Promise<void> {
    this.maybeSweep();
    this.buckets.set(key, record);
  }

  public async delete(key: string): Promise<void> {
    this.buckets.delete(key);
  }

  /**
   * `true` when both the algorithm window AND any active block have passed.
   * Records lingering from a recent block are kept so `block()` is honored
   * even after the algorithm window would otherwise expire.
   */
  private isFullyExpired(record: RatelimitStateRecord): boolean {
    const now = Date.now();
    const blockEnd = record.blockedUntil ?? 0;
    return record.expiresAt <= now && blockEnd <= now;
  }

  private maybeSweep(): void {
    const now = Date.now();
    if (now - this.lastSweepAt < this.sweepIntervalMs) {
      return;
    }
    this.lastSweepAt = now;
    for (const [key, record] of this.buckets) {
      if (this.isFullyExpired(record)) {
        this.buckets.delete(key);
      }
    }
  }
}
