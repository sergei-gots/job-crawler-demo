import type { CurrentUser } from "./get-current-user";

/**
 * Sidebar and ProfilePage each mount independently per route (no shared root layout), so a plain
 * per-component fetch can't tell the other about a profile update without a full page reload.
 * This module-level store lets ProfilePage push a fresh user and have Sidebar (subscribed via
 * useSyncExternalStore) re-render immediately.
 */

type Listener = () => void;

let currentUser: CurrentUser | null = null;
const listeners = new Set<Listener>();

export function getCachedUser(): CurrentUser | null {
  return currentUser;
}

export function setCachedUser(user: CurrentUser | null): void {
  currentUser = user;
  listeners.forEach((listener) => listener());
}

export function subscribeUser(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
