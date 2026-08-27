import { useSyncExternalStore } from "react";
import type { Playlist } from "@/types";

// ── State shape ──────────────────────────────────────────────────────────────

export type Screen =
  | { name: "library" }
  | { name: "player"; playlistId: string; channelId: string }
  | { name: "add" }
  | { name: "edit"; playlistId: string }
  | { name: "share"; playlistId: string }
  | { name: "epg"; playlistId: string; channelId: string };

export type AppState = {
  ready: boolean;
  inHost: boolean;
  userId: string | null;
  loading: boolean;
  playlists: Playlist[];
  screen: Screen;
  /** Channel currently playing (for the "Live" badge), null if none. */
  nowPlayingChannelId: string | null;
  /** Timestamp of the now-playing state we currently hold (for LWW handoff). */
  nowPlayingTs: number;
  error: string | null;
};

const initial: AppState = {
  ready: false,
  inHost: false,
  userId: null,
  loading: true,
  playlists: [],
  screen: { name: "library" },
  nowPlayingChannelId: null,
  nowPlayingTs: 0,
  error: null,
};

// ── Container ────────────────────────────────────────────────────────────────
// Single mutable snapshot + listener set, exposed to React through
// useSyncExternalStore. `setState` is the one write path — only the state/
// modules (actions) call it; components read via useApp.

let state: AppState = initial;
const listeners = new Set<() => void>();

export function setState(patch: Partial<AppState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export function getState(): AppState {
  return state;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useApp(): AppState {
  return useSyncExternalStore(subscribe, getState, getState);
}
