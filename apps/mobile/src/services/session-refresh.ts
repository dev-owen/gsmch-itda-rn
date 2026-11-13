type RefreshCallbacks<T> = {
  success(value: T): void;
  failure(reason: unknown): void;
  settled(): void;
};

/** Only the newest lookup in the current authentication state may update the UI. */
export function createSessionRefreshGate() {
  let epoch = 0;
  let sequence = 0;
  let changingAuth = false;
  return {
    async run<T>(load: () => Promise<T>, callbacks: RefreshCallbacks<T>): Promise<void> {
      if (changingAuth) return;
      const startedEpoch = epoch;
      const startedSequence = ++sequence;
      const current = () => !changingAuth && epoch === startedEpoch && sequence === startedSequence;
      try {
        const result = await load();
        if (current()) callbacks.success(result);
      } catch (reason) {
        if (current()) callbacks.failure(reason);
      } finally {
        if (current()) callbacks.settled();
      }
    },
    beginAuthChange() {
      changingAuth = true;
      sequence++;
      return ++epoch;
    },
    finishAuthChange(startedEpoch: number) {
      if (epoch !== startedEpoch) return false;
      changingAuth = false;
      epoch++;
      sequence++;
      return true;
    },
    invalidate() { epoch++; sequence++; },
  };
}
