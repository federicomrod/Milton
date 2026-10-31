// Where a signed-out phone opens. With nobody signed in the guarded routes
// («/» belongs to Cocina or Gestión) are gone, so the router used to fall back
// to whichever open screen it met first (the invite screen). We name the
// landing explicitly instead: the entry screen, except for the screens a
// signed-out person is meant to be on and the invite deep link (/k/<code>).

export const SIGNED_OUT_HOME = "/entrada";

export function signedOutLanding(
  pathname: string,
  hasSecret: boolean
): typeof SIGNED_OUT_HOME | null {
  if (pathname === SIGNED_OUT_HOME || pathname === "/login") return null;
  if (pathname.startsWith("/k/")) return null;
  if (pathname === "/join" && hasSecret) return null;
  return SIGNED_OUT_HOME;
}
