// Who is signed in on the manager side. Separate from the cook's device session
// (session/SessionProvider): a phone can hold both, and the profile sheet
// switches between Gestión and Cocina. Tokens live in secure-store only.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { apiBaseUrl } from "../config";
import { currentLanguage, setCurrentLanguage } from "../i18n/language-store";
import { createManagerApi, type ManagerApi } from "./api";
import { accessOf, needsRefresh, pickCompany } from "./session-core";
import {
  clearTokens,
  loadMeta,
  loadTokens,
  saveMeta,
  saveTokens,
  type Mode,
} from "./storage";
import type {
  LocationRef,
  ManagerCompany,
  ManagerTokens,
  ManagerUser,
} from "./types";

type Status = "loading" | "signedOut" | "signedIn" | "noAccess" | "error";

interface Manager {
  status: Status;
  user: ManagerUser | null;
  company: ManagerCompany | null;
  /** Restaurants of the company (filled by the first screen that reads them). */
  locations: LocationRef[];
  setLocations: (l: LocationRef[]) => void;
  /** The restaurant in view; null = all. */
  locationId: string | null;
  setLocationId: (id: string | null) => void;
  mode: Mode;
  setMode: (m: Mode) => void;
  api: ManagerApi;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  retry: () => void;
}

const Ctx = createContext<Manager | null>(null);

// One provider exists; its tokens and the renewal in flight live here (not in
// React refs) so the API client's callbacks can read them at request time.
const session: {
  tokens: ManagerTokens | null;
  refreshing: Promise<boolean> | null;
} = { tokens: null, refreshing: null };

export function useManager(): Manager {
  const value = useContext(Ctx);
  if (!value) throw new Error("useManager outside ManagerProvider");
  return value;
}

export function ManagerProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<ManagerUser | null>(null);
  const [company, setCompany] = useState<ManagerCompany | null>(null);
  const [locations, setLocations] = useState<LocationRef[]>([]);
  const [locationId, setLocationIdState] = useState<string | null>(null);
  const [mode, setModeState] = useState<Mode>("manager");
  const [attempt, setAttempt] = useState(0);

  const clearSession = useCallback(async () => {
    session.tokens = null;
    await clearTokens();
    setUser(null);
    setCompany(null);
    setLocations([]);
    setLocationIdState(null);
    setModeState("manager");
    setStatus("signedOut");
  }, []);

  const bare = useMemo(
    () =>
      createManagerApi({
        baseUrl: apiBaseUrl(),
        getToken: async () => session.tokens?.accessToken ?? null,
        refreshSession: async () => false,
        onSignedOut: () => undefined,
        language: currentLanguage,
      }),
    []
  );

  const refreshSession = useCallback((): Promise<boolean> => {
    // One renewal at a time, however many requests found the token expired.
    session.refreshing ??= (async () => {
      const current = session.tokens;
      if (!current) return false;
      try {
        const next = await bare.refresh(current.refreshToken);
        session.tokens = next;
        await saveTokens(next);
        setUser(next.user);
        return true;
      } catch {
        return false;
      } finally {
        session.refreshing = null;
      }
    })();
    return session.refreshing;
  }, [bare]);

  const api = useMemo(
    () =>
      createManagerApi({
        baseUrl: apiBaseUrl(),
        getToken: async () => {
          const t = session.tokens;
          if (!t) return null;
          if (needsRefresh(t.expiresAt)) await refreshSession();
          return session.tokens?.accessToken ?? null;
        },
        refreshSession,
        onSignedOut: () => void clearSession(),
        language: currentLanguage,
      }),
    [refreshSession, clearSession]
  );

  const open = useCallback(
    async (rememberedCompany: string | null) => {
      const me = await api.me();
      const picked = pickCompany(me.companies, rememberedCompany);
      if (accessOf(me.companies) === "none" || !picked) {
        setStatus("noAccess");
        return;
      }
      setCompany(picked);
      setCurrentLanguage(picked.language);
      // The restaurant picker needs the list on every screen; a failed read
      // just leaves it empty (the screens still work for «Todos»).
      api
        .locations()
        .then((r) => setLocations(r.locations))
        .catch(() => undefined);
      const meta = await loadMeta();
      setLocationIdState(
        meta?.companyId === picked.id ? (meta?.locationId ?? null) : null
      );
      setModeState(meta?.mode ?? "manager");
      if (meta && meta.companyId !== picked.id) {
        await saveMeta({ ...meta, companyId: picked.id, locationId: null });
      }
      setStatus("signedIn");
    },
    [api]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await loadTokens();
      if (cancelled) return;
      if (!saved) {
        setStatus("signedOut");
        return;
      }
      session.tokens = saved;
      setUser(saved.user);
      setStatus("loading");
      try {
        const meta = await loadMeta();
        await open(meta?.companyId ?? null);
      } catch {
        if (!cancelled && session.tokens) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, attempt]);

  const persist = useCallback(
    async (patch: { locationId?: string | null; mode?: Mode }) => {
      const meta = await loadMeta();
      if (!meta || !session.tokens) return;
      await saveMeta({
        ...meta,
        companyId: company?.id ?? meta.companyId,
        ...(patch.locationId !== undefined
          ? { locationId: patch.locationId }
          : {}),
        ...(patch.mode ? { mode: patch.mode } : {}),
      });
    },
    [company?.id]
  );

  const value = useMemo<Manager>(
    () => ({
      status,
      user,
      company,
      locations,
      setLocations,
      locationId,
      setLocationId: (id) => {
        setLocationIdState(id);
        void persist({ locationId: id });
      },
      mode,
      setMode: (m) => {
        setModeState(m);
        void persist({ mode: m });
      },
      api,
      signIn: async (email, password) => {
        const next = await bare.login(email, password);
        session.tokens = next;
        await saveTokens(next);
        setUser(next.user);
        setStatus("loading");
        try {
          await open(null);
        } catch (err) {
          await clearSession();
          throw err;
        }
      },
      signOut: clearSession,
      retry: () => setAttempt((n) => n + 1),
    }),
    [
      status,
      user,
      company,
      locations,
      locationId,
      mode,
      api,
      bare,
      open,
      persist,
      clearSession,
    ]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
