// The phone's outbox: every send goes through it, so a failed or offline item
// is never lost and never duplicated (same clientRef on every retry). Items
// that still wait are saved (AsyncStorage entry + a copy of the file in the
// app's documents folder) and retried on app start, when the app comes back to
// the front, every 15 s with backoff, and on «Reintentar».

import { useSyncExternalStore } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Directory, File, Paths } from "expo-file-system";
import type { ApiClient } from "../api/client";
import {
  afterFailure,
  isDue,
  newItem,
  sendItem,
  type OutboxItem,
  type OutboxKind,
} from "./outbox-core";
import { uploadToSignedUrl } from "./uploader";

const KEY = "milton.outbox.v1";
const TICK_MS = 15_000;

interface Snapshot {
  items: OutboxItem[];
  /** The phone could not reach Milton on the last try. */
  offline: boolean;
}

let snap: Snapshot = { items: [], offline: false };
let api: ApiClient | null = null;
let running = false;
let started = false;
const listeners = new Set<() => void>();

function set(next: Partial<Snapshot>) {
  snap = { ...snap, ...next };
  listeners.forEach((l) => l());
}

function outboxDir(): Directory {
  const dir = new Directory(Paths.document, "outbox");
  dir.create({ intermediates: true, idempotent: true });
  return dir;
}

async function persist() {
  // Sent items are not saved: they only stay on screen for this session.
  const waiting = snap.items.filter((i) => i.state !== "sent");
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(waiting));
  } catch {
    // A full disk must not break sending.
  }
}

function replace(id: string, patch: (i: OutboxItem) => OutboxItem) {
  set({ items: snap.items.map((i) => (i.id === id ? patch(i) : i)) });
}

function removeFile(uri: string | null) {
  if (!uri) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // Already gone.
  }
}

async function processDue(force?: string) {
  if (running || !api) return;
  running = true;
  try {
    for (const due of snap.items.filter(
      (i) => i.id === force || isDue(i, Date.now())
    )) {
      const current = snap.items.find((i) => i.id === due.id);
      if (!current || current.state === "sending" || current.state === "sent")
        continue;
      replace(current.id, (i) => ({ ...i, state: "sending" }));
      const outcome = await sendItem(current, {
        api,
        upload: uploadToSignedUrl,
      });
      if (outcome.ok) {
        replace(current.id, (i) => ({ ...i, state: "sent", offline: false }));
        set({ offline: false });
        removeFile(current.fileUri);
      } else {
        replace(current.id, (i) => afterFailure(i, outcome, Date.now()));
        if (outcome.offline) set({ offline: true });
      }
      await persist();
    }
  } finally {
    running = false;
  }
}

/** Call once after sign-in. Loads what was waiting and starts retrying. */
export async function startOutbox(client: ApiClient) {
  api = client;
  if (!started) {
    started = true;
    try {
      const raw = await AsyncStorage.getItem(KEY);
      const saved = raw ? (JSON.parse(raw) as OutboxItem[]) : [];
      set({
        items: saved.map((i) => ({
          ...i,
          state: "pending" as const,
          nextAttemptAt: 0,
        })),
      });
    } catch {
      set({ items: [] });
    }
    setInterval(() => void processDue(), TICK_MS);
    AppState.addEventListener("change", (s) => {
      if (s === "active") void processDue();
    });
  }
  void processDue();
}

/** Forget everything (sign-out): the next cook must not inherit these. */
export async function clearOutbox() {
  snap.items.forEach((i) => removeFile(i.fileUri));
  set({ items: [], offline: false });
  api = null;
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}

export async function enqueue(input: {
  id: string;
  kind: OutboxKind;
  text?: string | null;
  /** A local file to send (copied into the app's folder first). */
  fileUri?: string;
  ext?: string;
  mime?: string;
  durationS?: number | null;
}) {
  let fileUri: string | null = null;
  let sizeBytes: number | null = null;
  if (input.fileUri) {
    const dest = new File(outboxDir(), `${input.id}.${input.ext ?? "bin"}`);
    await new File(input.fileUri).copy(dest);
    fileUri = dest.uri;
    sizeBytes = dest.size;
  }
  const item = newItem({
    id: input.id,
    kind: input.kind,
    text: input.text ?? null,
    fileUri,
    mime: input.mime ?? null,
    sizeBytes,
    durationS: input.durationS ?? null,
  });
  set({ items: [item, ...snap.items] });
  await persist();
  void processDue(item.id);
}

export function retryNow(id: string) {
  replace(id, (i) => ({
    ...i,
    state: "pending",
    permanent: false,
    nextAttemptAt: 0,
  }));
  void processDue(id);
}

export function dismiss(id: string) {
  const item = snap.items.find((i) => i.id === id);
  removeFile(item?.fileUri ?? null);
  set({ items: snap.items.filter((i) => i.id !== id) });
  void persist();
}

/** Screens that load data report whether Milton could be reached. */
export function reportOffline(offline: boolean) {
  if (snap.offline !== offline) set({ offline });
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useOutbox(): Snapshot {
  return useSyncExternalStore(
    subscribe,
    () => snap,
    () => snap
  );
}
