/**
 * Web Storage that never throws (CRT-0043). A sandboxed iframe, blocked site data or a full quota
 * makes `localStorage` / `sessionStorage` throw on access, and everything the overlay keeps there is
 * a convenience (F-12 Should, F-56, F-66, F-81, F-82): without storage a value lives for this page
 * load only. `loader.ts` keeps its own (N-20: its bundle stays tiny).
 */

export type StorageArea = "local" | "session";

function area(which: StorageArea): Storage {
  return which === "local" ? localStorage : sessionStorage;
}

/** The stored string, null when there is none; `unavailable` when storage cannot be read at all. */
export function safeGet(which: StorageArea, key: string, unavailable: string | null = null): string | null {
  try {
    return area(which).getItem(key);
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

/** Store `value`; null removes the key. */
export function safeSet(which: StorageArea, key: string, value: string | null): void {
  try {
    if (value === null) area(which).removeItem(key);
    else area(which).setItem(key, value);
  } catch {
    // storage unavailable or full: the value lives for this page load only
  }
}

export function safeRemove(which: StorageArea, key: string): void {
  safeSet(which, key, null);
}
