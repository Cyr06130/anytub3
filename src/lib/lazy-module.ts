/**
 * Memoized, retrying dynamic-import loader.
 *
 * Hosts serve a product's chunks from their own layer (Polkadot Web: a service
 * worker fed the Bulletin archive in memory; Mobile: files unpacked from the
 * CAR), and a lazy `import()` fired minutes after boot can hit that layer cold
 * or mid-restart — the request falls through to a 404 and the module load
 * fails. `React.lazy` would then stay rejected for the page lifetime. This
 * loader retries with a short backoff, forgets a failure so the next call
 * starts over, and exposes `prefetch()` so the chunk is fetched while the
 * serving layer is warm, right after boot.
 */
export type ModuleLoader<T> = {
  /** Resolve the module, retrying transient failures; rejects after the last attempt. */
  load(): Promise<T>;
  /** The module if a load already succeeded, for a flash-free first render. */
  peek(): T | null;
  /** Start loading in the background; failures are swallowed (a later load retries). */
  prefetch(): void;
};

export type ModuleLoaderOptions = {
  /** Total attempts per load() call, including the first. */
  attempts?: number;
  /** Delay before the second attempt; doubles on each further attempt. */
  delayMs?: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createModuleLoader<T>(load: () => Promise<T>, opts: ModuleLoaderOptions = {}): ModuleLoader<T> {
  const { attempts = 3, delayMs = 400, sleep = defaultSleep } = opts;
  let loaded: T | null = null;
  let inFlight: Promise<T> | null = null;

  async function loadWithRetry(): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await load();
      } catch (error) {
        lastError = error;
        if (attempt < attempts) await sleep(delayMs * 2 ** (attempt - 1));
      }
    }
    throw lastError;
  }

  return {
    load() {
      if (loaded) return Promise.resolve(loaded);
      if (!inFlight) {
        inFlight = loadWithRetry().then(
          (mod) => {
            loaded = mod;
            return mod;
          },
          (error: unknown) => {
            inFlight = null; // forget the failure: the next load() starts a fresh cycle
            throw error;
          },
        );
      }
      return inFlight;
    },
    peek() {
      return loaded;
    },
    prefetch() {
      void this.load().catch(() => undefined);
    },
  };
}
