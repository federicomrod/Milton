// lib/restaurant/actionable-error.ts
//
// What went wrong on the server, in words the owner can act on (R1-09b).
// The full error is always logged with the same reference, so support can
// find it; the person sees the cause and what to do, never a stack trace.

export interface ActionableError {
  /** Message for the screen. */
  message: string;
  /** Short reference also written to the server log. */
  ref: string;
  status: number;
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err ?? "");
}

const RULES: Array<{ test: RegExp; hint: string; status?: number }> = [
  {
    test: /statement timeout|canceling statement|timed? ?out|ETIMEDOUT|504/i,
    hint: "El servidor tardó demasiado. Vuelve a intentarlo en un minuto; si el archivo es muy grande, súbelo por partes.",
    status: 504,
  },
  {
    test: /corrupt|zip|end of data|unsupported file|not a valid|xlsx|cfb/i,
    hint: "No pudimos abrir el archivo. Guárdalo de nuevo como .xlsx desde Excel y vuelve a subirlo.",
    status: 400,
  },
  {
    test: /payload too large|body exceeded|413|too large/i,
    hint: "El archivo es demasiado grande. Quita las hojas que no son de costos y vuelve a subirlo.",
    status: 413,
  },
  {
    test: /permission denied|row-level security|rls|42501|jwt|not authorized/i,
    hint: "Tu usuario no tiene permiso para guardar esto. Pide a quien administra la cuenta que te dé acceso.",
    status: 403,
  },
  {
    test: /does not exist|schema cache|column .* of relation|42P01|42703/i,
    hint: "Falta una actualización de la base de datos en este ambiente. Avísale al equipo de Milton con la referencia.",
    status: 500,
  },
  {
    test: /duplicate key|unique constraint|23505/i,
    hint: "Ya existe un registro igual. Recarga la página: es posible que la carga anterior sí se haya guardado.",
    status: 409,
  },
  {
    test: /fetch failed|ECONNRESET|network|socket hang up/i,
    hint: "Se cortó la conexión con la base de datos. Vuelve a intentarlo.",
    status: 503,
  },
];

/** Log the real error with a reference and return what the screen shows. */
export function actionableError(
  err: unknown,
  what: string,
  logTag: string
): ActionableError {
  const ref = Math.random().toString(36).slice(2, 8).toUpperCase();
  const raw = messageOf(err);
  console.error(`[${logTag}] ref=${ref}`, err);
  const rule = RULES.find((r) => r.test.test(raw));
  const hint =
    rule?.hint ??
    "Vuelve a intentarlo. Si sigue pasando, avísale al equipo de Milton con la referencia.";
  return {
    message: `${what} ${hint} (ref. ${ref})`,
    ref,
    status: rule?.status ?? 500,
  };
}
