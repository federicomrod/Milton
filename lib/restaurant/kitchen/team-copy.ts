// lib/restaurant/kitchen/team-copy.ts
//
// Copy for the kitchen team tools on the web (Configuración › Equipo), in
// Spanish, English and German. Same shape as app-invite-copy.

import type { InviteLang } from "./app-invite-copy";

export interface KitchenTeamCopy {
  title: string;
  intro: string;
  kitchenCode: string;
  kitchenCodeHint: string;
  none: string;
  noPin: string;
  hasPin: string;
  mustChange: string;
  phones: string;
  noPhones: string;
  lastSeen: string;
  never: string;
  resetPin: string;
  temporaryPin: string;
  clearPin: string;
  newLink: string;
  signOutPhone: string;
  signOutAll: string;
  confirm: string;
  cancel: string;
  pinShownOnce: string;
  pinMustChangeNote: string;
  linkShownOnce: string;
  linkNote: string;
  copy: string;
  copied: string;
  done: string;
  errors: Record<"forbidden" | "notFound" | "auth" | "error", string>;
}

const es: KitchenTeamCopy = {
  title: "Equipo de cocina en la app",
  intro:
    "Restablece el PIN de un cocinero, envíale un nuevo enlace o cierra sesión en un teléfono.",
  kitchenCode: "Código de cocina",
  kitchenCodeHint:
    "Con este código, su nombre y su PIN, un cocinero entra en otro teléfono.",
  none: "Aún no hay cocineros en la app.",
  noPin: "Sin PIN",
  hasPin: "Con PIN",
  mustChange: "Debe cambiar el PIN",
  phones: "Teléfonos",
  noPhones: "Sin sesión abierta",
  lastSeen: "Visto",
  never: "nunca",
  resetPin: "Restablecer PIN",
  temporaryPin: "PIN temporal",
  clearPin: "Quitar PIN",
  newLink: "Enviar nuevo enlace",
  signOutPhone: "Cerrar sesión en este teléfono",
  signOutAll: "Cerrar sesión en todos",
  confirm: "Confirmar",
  cancel: "Cancelar",
  pinShownOnce: "PIN temporal: díctaselo al cocinero. No se vuelve a mostrar.",
  pinMustChangeNote: "Tendrá que cambiarlo la próxima vez que entre.",
  linkShownOnce:
    "Nuevo enlace: es de un solo uso y vale 7 días. No se vuelve a mostrar.",
  linkNote: "Es el mismo cocinero: su historial se queda.",
  copy: "Copiar",
  copied: "Copiado",
  done: "Listo",
  errors: {
    forbidden: "Tu rol no puede hacer esto.",
    notFound: "No encontré a ese cocinero.",
    auth: "Vuelve a iniciar sesión.",
    error: "No pude hacer ese cambio.",
  },
};

const en: KitchenTeamCopy = {
  title: "Kitchen team in the app",
  intro: "Reset a cook's PIN, send them a new link, or sign a phone out.",
  kitchenCode: "Kitchen code",
  kitchenCodeHint:
    "With this code, their name and their PIN, a cook signs in on another phone.",
  none: "There are no cooks in the app yet.",
  noPin: "No PIN",
  hasPin: "Has a PIN",
  mustChange: "Must change the PIN",
  phones: "Phones",
  noPhones: "No open session",
  lastSeen: "Seen",
  never: "never",
  resetPin: "Reset PIN",
  temporaryPin: "Temporary PIN",
  clearPin: "Remove PIN",
  newLink: "Send a new link",
  signOutPhone: "Sign out on this phone",
  signOutAll: "Sign out everywhere",
  confirm: "Confirm",
  cancel: "Cancel",
  pinShownOnce: "Temporary PIN: tell it to the cook. It is not shown again.",
  pinMustChangeNote: "They must change it the next time they sign in.",
  linkShownOnce: "New link: single use, valid 7 days. It is not shown again.",
  linkNote: "It is the same cook: their history stays.",
  copy: "Copy",
  copied: "Copied",
  done: "Done",
  errors: {
    forbidden: "Your role cannot do this.",
    notFound: "I could not find that cook.",
    auth: "Please sign in again.",
    error: "I could not make that change.",
  },
};

const de: KitchenTeamCopy = {
  title: "Küchenteam in der App",
  intro:
    "Setze die PIN eines Kochs zurück, sende einen neuen Link oder melde ein Telefon ab.",
  kitchenCode: "Küchencode",
  kitchenCodeHint:
    "Mit diesem Code, ihrem Namen und ihrer PIN meldet sich ein Koch auf einem anderen Telefon an.",
  none: "Noch keine Köche in der App.",
  noPin: "Keine PIN",
  hasPin: "Hat eine PIN",
  mustChange: "Muss die PIN ändern",
  phones: "Telefone",
  noPhones: "Keine offene Sitzung",
  lastSeen: "Zuletzt gesehen",
  never: "nie",
  resetPin: "PIN zurücksetzen",
  temporaryPin: "Temporäre PIN",
  clearPin: "PIN entfernen",
  newLink: "Neuen Link senden",
  signOutPhone: "Auf diesem Telefon abmelden",
  signOutAll: "Überall abmelden",
  confirm: "Bestätigen",
  cancel: "Abbrechen",
  pinShownOnce:
    "Temporäre PIN: Sag sie dem Koch. Sie wird nicht erneut angezeigt.",
  pinMustChangeNote: "Er muss sie bei der nächsten Anmeldung ändern.",
  linkShownOnce:
    "Neuer Link: einmalig nutzbar, 7 Tage gültig. Er wird nicht erneut angezeigt.",
  linkNote: "Es ist derselbe Koch: sein Verlauf bleibt erhalten.",
  copy: "Kopieren",
  copied: "Kopiert",
  done: "Fertig",
  errors: {
    forbidden: "Deine Rolle darf das nicht.",
    notFound: "Dieser Koch wurde nicht gefunden.",
    auth: "Bitte melde dich erneut an.",
    error: "Die Änderung konnte nicht vorgenommen werden.",
  },
};

const TABLE: Record<InviteLang, KitchenTeamCopy> = { es, en, de };

export const kitchenTeamCopy = (lang: InviteLang): KitchenTeamCopy =>
  TABLE[lang];
