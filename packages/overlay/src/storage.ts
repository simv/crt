/**
 * Web Storage that never throws (CRT-0043). A sandboxed iframe, blocked site data or a full quota
 * makes `localStorage` / `sessionStorage` throw on access, and everything the overlay keeps there is
 * a convenience (F-12 Should, F-56, F-66, F-81, F-82): without storage a value lives for this page
 * load only. `loader.ts` keeps its own (N-20: its bundle stays tiny). Every read and write goes
 * through one backing (PRD-extension F-153): Web Storage by default, every key as it always was.
 */

export type StorageArea = "local" | "session";

/**
 * Where the values live (PRD-extension F-153). A backing may throw: the three `safe*` readers
 * below catch it, as they catch Web Storage's own refusals.
 */
export interface StorageBacking {
  get(which: StorageArea, key: string): string | null;
  set(which: StorageArea, key: string, value: string): void;
  remove(which: StorageArea, key: string): void;
}

function area(which: StorageArea): Storage {
  return which === "local" ? localStorage : sessionStorage;
}

/** F-153: today's behaviour, the page's own Web Storage. */
export const webStorage: StorageBacking = {
  get: (which, key) => area(which).getItem(key),
  set: (which, key, value) => area(which).setItem(key, value),
  remove: (which, key) => area(which).removeItem(key),
};

/**
 * A backing that lives in memory (F-153): what the extension uses, filled from `chrome.storage`
 * before the overlay mounts and written through by `onWrite`, so nothing of CRT's is kept in the
 * site's own storage (PRD-extension N-44). `value` is null for a removal.
 */
export function memoryStorage(
  initial: Partial<Record<StorageArea, Record<string, string>>> = {},
  onWrite?: (which: StorageArea, key: string, value: string | null) => void,
): StorageBacking {
  const areas: Record<StorageArea, Map<string, string>> = {
    local: new Map(Object.entries(initial.local ?? {})),
    session: new Map(Object.entries(initial.session ?? {})),
  };
  return {
    get: (which, key) => areas[which].get(key) ?? null,
    set: (which, key, value) => {
      areas[which].set(key, value);
      onWrite?.(which, key, value);
    },
    remove: (which, key) => {
      if (areas[which].delete(key)) onWrite?.(which, key, null);
    },
  };
}

let backing: StorageBacking = webStorage;

/** F-153: replace the backing (the extension's content script, before the overlay mounts; tests). */
export function setStorageBacking(next: StorageBacking): void {
  backing = next;
}

/** The stored string, null when there is none; `unavailable` when storage cannot be read at all. */
export function safeGet(which: StorageArea, key: string, unavailable: string | null = null): string | null {
  try {
    return backing.get(which, key);
  } catch {
    return unavailable;
  }
}

/** The stored value parsed as JSON; null when there is none, it does not parse, or storage is unavailable. */
export function safeGetJson(which: StorageArea, key: string): unknown {
  const raw = safeGet(which, key);
  try {
    return raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function safeSet(which: StorageArea, key: string, value: string): void {
  try {
    backing.set(which, key, value);
  } catch {
    // storage unavailable or full: the value lives for this page load only
  }
}

export function safeRemove(which: StorageArea, key: string): void {
  try {
    backing.remove(which, key);
  } catch {
    // storage unavailable: nothing was stored
  }
}
