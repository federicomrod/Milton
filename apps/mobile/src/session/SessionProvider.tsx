// Who is signed in. «signedOut» sends the app to the join screen; a 401 from
// any authenticated request signs the cook out (their device was revoked or
// they were removed).

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createApiClient, type ApiClient } from "../api/client";
import { apiBaseUrl } from "../config";
import { currentLanguage, setCurrentLanguage } from "../i18n/language-store";
import { clearOutbox, startOutbox } from "../send/outbox";
import {
  clearToken,
  getProfile,
  getToken,
  setProfile,
  setToken,
  type Profile,
} from "../storage/token";

// One provider exists, so one flag stops a 401 burst from signing out twice.
let signingOut = false;

type Status = "loading" | "signedOut" | "signedIn";

interface Session {
  status: Status;
  profile: Profile | null;
  api: ApiClient;
  /** Stores the token, loads the profile, starts the outbox. */
  signIn: (token: string, fallback: Profile) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const Ctx = createContext<Session | null>(null);

export function useSession(): Session {
  const value = useContext(Ctx);
  if (!value) throw new Error("useSession outside SessionProvider");
  return value;
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [profile, setProfileState] = useState<Profile | null>(null);

  const signOut = useCallback(async () => {
    if (signingOut) return;
    signingOut = true;
    try {
      await clearToken();
      await setProfile(null);
      await clearOutbox();
      setProfileState(null);
      setCurrentLanguage(null);
      setStatus("signedOut");
    } finally {
      signingOut = false;
    }
  }, []);

  const api = useMemo(
    () =>
      createApiClient({
        baseUrl: apiBaseUrl(),
        getToken,
        language: currentLanguage,
        onUnauthorized: () => void signOut(),
      }),
    [signOut]
  );

  const refreshProfile = useCallback(async () => {
    try {
      const me = await api.me();
      const next: Profile = {
        name: me.staff.name,
        location: me.locations[0]?.name ?? "",
        company: me.company.name || null,
        language: setCurrentLanguage(me.company.language),
      };
      setProfileState(next);
      await setProfile(next);
    } catch {
      // Offline or a 401 (handled by the client): keep the cached greeting.
    }
  }, [api]);

  const signIn = useCallback(
    async (token: string, fallback: Profile) => {
      await setToken(token);
      setCurrentLanguage(fallback.language);
      setProfileState(fallback);
      await setProfile(fallback);
      setStatus("signedIn");
      await startOutbox(api);
      void refreshProfile();
    },
    [api, refreshProfile]
  );

  useEffect(() => {
    (async () => {
      const token = await getToken();
      if (!token) {
        setStatus("signedOut");
        return;
      }
      const cached = await getProfile();
      setCurrentLanguage(cached?.language);
      setProfileState(cached);
      setStatus("signedIn");
      await startOutbox(api);
      void refreshProfile();
    })();
  }, [api, refreshProfile]);

  const value = useMemo<Session>(
    () => ({ status, profile, api, signIn, signOut, refreshProfile }),
    [status, profile, api, signIn, signOut, refreshProfile]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
