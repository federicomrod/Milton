// The signed-out entry flow (pure rules, tested).
//
//   Welcome → Gestión (email + password, the same account as the web)
//           → Cocina:  a cook this phone remembers unlocks with their PIN
//                      (Face ID / fingerprint fills it); a first-time cook uses
//                      the invitation the manager issued, then sets a PIN.
// A valid saved session never reaches the welcome screen (the router guards
// open the app instead). The original invitation is only ever asked for once.

export type CocinaRoute = "/pin" | "/join";

/** A remembered cook (this phone knew them before) goes to the PIN; anyone else to the invitation. */
export function cocinaEntryRoute(
  last: { staffId?: string | null; name?: string | null } | null | undefined
): CocinaRoute {
  return last && (last.staffId || last.name) ? "/pin" : "/join";
}

/**
 * Password recovery is the web's own flow (Supabase sends a one-time link, and
 * the answer is always the same so it cannot be used to find out which emails
 * exist). The phone just opens that page on the same server it talks to.
 */
export function forgotPasswordUrl(apiBaseUrl: string): string {
  return `${apiBaseUrl.replace(/\/+$/, "")}/auth/forgot-password`;
}

/** Which modes this phone may offer: server permissions decided at sign-in. */
export function switchTargets(args: {
  managerIn: boolean;
  kitchenIn: boolean;
  /** The manager may open Cocina on this phone without a link (server: kitchen.team). */
  canSelfKitchen: boolean;
}): { gestion: boolean; cocina: boolean } {
  return {
    gestion: args.managerIn,
    cocina: args.kitchenIn || (args.managerIn && args.canSelfKitchen),
  };
}

/**
 * Signing a manager out also ends THEIR OWN kitchen session on this phone (the
 * one made by «Usar Cocina en este teléfono», marked selfDevice): it was opened
 * with their account, so it must not outlive it. A cook who joined with an
 * invitation (or PIN) is a different person and is never signed out by this.
 */
export function endsKitchenWithManager(
  profile: { selfDevice?: boolean } | null | undefined
): boolean {
  return profile?.selfDevice === true;
}
