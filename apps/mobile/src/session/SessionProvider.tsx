// Who is signed in. The device token never expires by itself: only a CONFIRMED
// revoke (a 401 whose reason is «revoked» / «unknown_device», after one retry;
// see api/client.ts), «Cerrar sesión» or a reinstall ends it. A revoke keeps the
// outbox and remembers the cook so the same person signing back in resumes it.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createApiClient, type ApiClient } from "../api/client";
import type { PinState } from "../api/types";
import { apiBaseUrl } from "../config";
import { currentLanguage, setCurrentLanguage } from "../i18n/language-store";
import { wipeBiometric } from "../lib/biometric-device";
import { clearOutbox, pauseOutbox, startOutbox } from "../send/outbox";
import {
  forgetStaffId,
  getLastStaff,
  setLastStaff,
} from "../storage/last-staff";
import {
  clearToken,
  getProfile,
  getToken,
  readToken,
  setProfile,
  setToken,
  type Profile,
} from "../storage/token";
import {
  outboxOnSignIn,
  pinGate,
  readTokenPatiently,
  startupStatus,
  type PinGate,
} from "./stay-signed-in";

// One provider exists, so one flag stops a 401 burst from signing out twice.
let signingOut = false;

type Status = "loading" | "signedOut" | "signedIn";

export interface SignInInfo {
  staffId: string;
  pin?: PinState;
  kitchenCode?: string | null;
  /** Show «Tu código de cocina» (and the Face ID offer) once, in memory only. */
  welcome?: { pin: string } | null;
}

interface Session {
  status: Status;
  profile: Profile | null;
  api: ApiClient;
  /** Stores the token, loads the profile, starts (or resumes) the outbox. */
  signIn: (token: string, fallback: Profile, info: SignInInfo) => Promise<void>;
  /** Explicit «Cerrar sesión»: clears everything on this phone. */
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  pin: PinState | null;
  setPin: (pin: PinState) => void;
  /** Must the cook set / change the PIN before continuing? */
  gate: PinGate;
  kitchenCode: string | null;
  /** Set once after joining; the welcome screen shows it and clears it. */
  welcome: { pin: string } | null;
  setWelcome: (w: { pin: string } | null) => void;
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
  const [pin, setPin] = useState<PinState | null>(null);
  const [kitchenCode, setKitchenCode] = useState<string | null>(null);
  const [welcome, setWelcome] = useState<{ pin: string } | null>(null);

  const endSession = useCallback(async (kind: "explicit" | "revoked") => {
    if (signingOut) return;
    signingOut = true;
    try {
      await clearToken();
      await setProfile(null);
      if (kind === "explicit") {
        await clearOutbox();
        await forgetStaffId();
        await wipeBiometric();
      } else {
        // Revoked: unsent items wait for the same cook (PIN or a new link).
        pauseOutbox();
      }
      setProfileState(null);
      setPin(null);
      setKitchenCode(null);
      setWelcome(null);
      setCurrentLanguage(null);
      setStatus("signedOut");
    } finally {
      signingOut = false;
    }
  }, []);

  const signOut = useCallback(() => endSession("explicit"), [endSession]);

  const api = useMemo(
    () =>
      createApiClient({
        baseUrl: apiBaseUrl(),
        getToken,
        language: currentLanguage,
        unauthorizedPolicy: "device",
        onUnauthorized: () => void endSession("revoked"),
      }),
    [endSession]
  );

  const refreshProfile = useCallback(async () => {
    try {
      const me = await api.me();
      const cached = await getProfile();
      const next: Profile = {
        name: me.staff.name,
        location: me.locations[0]?.name ?? "",
        company: me.company.name || null,
        language: setCurrentLanguage(me.company.language),
        selfDevice: cached?.selfDevice,
      };
      setProfileState(next);
      if (me.pin) setPin(me.pin);
      if (me.kitchenCode !== undefined) setKitchenCode(me.kitchenCode);
      await setProfile(next);
      await setLastStaff({
        staffId: me.staff.id,
        name: me.staff.name,
        kitchenCode:
          me.kitchenCode ?? (await getLastStaff())?.kitchenCode ?? null,
      });
    } catch {
      // Offline or a 401 (handled by the client): keep the cached greeting.
    }
  }, [api]);

  const signIn = useCallback(
    async (token: string, fallback: Profile, info: SignInInfo) => {
      const last = await getLastStaff();
      if (outboxOnSignIn(last?.staffId ?? null, info.staffId) === "clear") {
        await clearOutbox();
      }
      await setLastStaff({
        staffId: info.staffId,
        name: fallback.name,
        kitchenCode: info.kitchenCode ?? last?.kitchenCode ?? null,
      });
      await setToken(token);
      setPin(info.pin ?? null);
      setKitchenCode(info.kitchenCode ?? null);
      setWelcome(info.welcome ?? null);
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
      const read = await readTokenPatiently(
        readToken,
        (ms) => new Promise((r) => setTimeout(r, ms))
      );
      const cached = await getProfile();
      if (startupStatus(read, cached !== null) === "signedOut") {
        setStatus("signedOut");
        return;
      }
      // Existing installs saved the token as «when unlocked»: save it again once.
      if (read.kind === "found") void setToken(read.token).catch(() => {});
      setCurrentLanguage(cached?.language);
      setProfileState(cached);
      setStatus("signedIn");
      await startOutbox(api);
      void refreshProfile();
    })();
  }, [api, refreshProfile]);

  const gate: PinGate = profile?.selfDevice ? "none" : pinGate(pin);
  const value = useMemo<Session>(
    () => ({
      status,
      profile,
      api,
      signIn,
      signOut,
      refreshProfile,
      pin,
      setPin,
      gate,
      kitchenCode,
      welcome,
      setWelcome,
    }),
    [
      status,
      profile,
      api,
      signIn,
      signOut,
      refreshProfile,
      pin,
      gate,
      kitchenCode,
      welcome,
    ]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
