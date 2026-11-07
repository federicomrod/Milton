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

/**
 * Has the signed-out landing done its one job? It has once the phone is on the
 * screen it was sent to (or never needed to be sent). From then on it must never
 * redirect again: the router's <Redirect> re-fires on EVERY render of the
 * component that holds it, and that component re-renders on each path change, so
 * a redirect left mounted would send «Iniciar sesión» (/login) straight back to
 * /entrada.
 */
export function nextLanded(
  landed: boolean,
  target: string | null,
  pathname: string
): boolean {
  return landed || target === null || pathname === target;
}
