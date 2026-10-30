// lib/restaurant/kitchen/app-invite-copy.ts
//
// Copy for the «App Milton Cocina» card and the public /k/<code> page, in
// Spanish, English and German. Own table until the shared lib/i18n
// dictionaries land (claude/i18n-german); then these move there unchanged.

export type InviteLang = "es" | "en" | "de";

export function inviteLang(value: unknown): InviteLang {
  return value === "en" || value === "de" ? value : "es";
}

export type InviteStatus = "pending" | "used" | "revoked" | "expired";

export interface AppInviteCopy {
  title: string;
  intro: string;
  invite: string;
  namePlaceholder: string;
  noLocations: string;
  validity: string;
  codeLabel: string;
  linkLabel: string;
  copyCode: string;
  copyLink: string;
  copied: string;
  once: string;
  pendingTitle: string;
  none: string;
  revoke: string;
  revokeConfirm: string;
  revokeYes: string;
  revokeNo: string;
  expires: string;
  status: Record<InviteStatus, string>;
  anyCook: string;
  errors: Record<"forbidden" | "location" | "auth" | "error", string>;
  page: { heading: string; instruction: string; note: string };
}

const es: AppInviteCopy = {
  title: "App Milton Cocina",
  intro: "Invita a un cocinero a la app con un código personal.",
  invite: "Invitar a la app",
  namePlaceholder: "Nombre del cocinero (opcional)",
  noLocations: "Aún no hay ubicaciones.",
  validity: "Válido 7 días · un solo uso",
  codeLabel: "Código",
  linkLabel: "Enlace",
  copyCode: "Copiar código",
  copyLink: "Copiar enlace",
  copied: "Copiado",
  once: "Cópialo ahora: no se vuelve a mostrar.",
  pendingTitle: "Invitaciones",
  none: "Sin invitaciones.",
  revoke: "Revocar",
  revokeConfirm: "¿Revocar esta invitación?",
  revokeYes: "Sí, revocar",
  revokeNo: "Cancelar",
  expires: "Vence",
  status: {
    pending: "Pendiente",
    used: "Usada",
    revoked: "Revocada",
    expired: "Vencida",
  },
  anyCook: "Sin nombre",
  errors: {
    forbidden: "Solo los dueños pueden invitar a la app.",
    location: "No encontré esa ubicación.",
    auth: "Inicia sesión de nuevo.",
    error: "No se pudo completar. Inténtalo de nuevo.",
  },
  page: {
    heading: "Milton Cocina",
    instruction: "Abre la app Milton Cocina e ingresa este código",
    note: "Válido 7 días · un solo uso",
  },
};

const en: AppInviteCopy = {
  title: "Milton Kitchen app",
  intro: "Invite a cook to the app with a personal code.",
  invite: "Invite to the app",
  namePlaceholder: "Cook name (optional)",
  noLocations: "No locations yet.",
  validity: "Valid 7 days · single use",
  codeLabel: "Code",
  linkLabel: "Link",
  copyCode: "Copy code",
  copyLink: "Copy link",
  copied: "Copied",
  once: "Copy it now: it won't be shown again.",
  pendingTitle: "Invites",
  none: "No invites.",
  revoke: "Revoke",
  revokeConfirm: "Revoke this invite?",
  revokeYes: "Yes, revoke",
  revokeNo: "Cancel",
  expires: "Expires",
  status: {
    pending: "Pending",
    used: "Used",
    revoked: "Revoked",
    expired: "Expired",
  },
  anyCook: "No name",
  errors: {
    forbidden: "Only owners can invite to the app.",
    location: "I couldn't find that location.",
    auth: "Sign in again.",
    error: "That didn't work. Try again.",
  },
  page: {
    heading: "Milton Kitchen",
    instruction: "Open the Milton Kitchen app and enter this code",
    note: "Valid 7 days · single use",
  },
};

const de: AppInviteCopy = {
  title: "Milton-Küchen-App",
  intro: "Laden Sie einen Koch mit einem persönlichen Code in die App ein.",
  invite: "In die App einladen",
  namePlaceholder: "Name des Kochs (optional)",
  noLocations: "Noch keine Standorte.",
  validity: "7 Tage gültig · einmalig verwendbar",
  codeLabel: "Code",
  linkLabel: "Link",
  copyCode: "Code kopieren",
  copyLink: "Link kopieren",
  copied: "Kopiert",
  once: "Jetzt kopieren: Er wird nicht erneut angezeigt.",
  pendingTitle: "Einladungen",
  none: "Keine Einladungen.",
  revoke: "Widerrufen",
  revokeConfirm: "Diese Einladung widerrufen?",
  revokeYes: "Ja, widerrufen",
  revokeNo: "Abbrechen",
  expires: "Läuft ab",
  status: {
    pending: "Offen",
    used: "Verwendet",
    revoked: "Widerrufen",
    expired: "Abgelaufen",
  },
  anyCook: "Ohne Namen",
  errors: {
    forbidden: "Nur Inhaber können in die App einladen.",
    location: "Dieser Standort wurde nicht gefunden.",
    auth: "Bitte melden Sie sich erneut an.",
    error: "Das hat nicht geklappt. Bitte erneut versuchen.",
  },
  page: {
    heading: "Milton Küche",
    instruction:
      "Öffnen Sie die Milton-Küchen-App und geben Sie diesen Code ein",
    note: "7 Tage gültig · einmalig verwendbar",
  },
};

const TABLE: Record<InviteLang, AppInviteCopy> = { es, en, de };

export function appInviteCopy(lang: unknown): AppInviteCopy {
  return TABLE[inviteLang(lang)];
}

/** Language from an Accept-Language header (public page, no session). */
export function inviteLangFromHeader(header: string | null | undefined) {
  const first = (header ?? "").toLowerCase().split(",")[0]?.trim() ?? "";
  if (first.startsWith("de")) return "de";
  if (first.startsWith("en")) return "en";
  return "es";
}
