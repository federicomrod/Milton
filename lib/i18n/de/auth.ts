import type { Dictionary } from "../types";

export const auth: Dictionary["auth"] = {
  landing: {
    signIn: "Anmelden",
    getStarted: "Loslegen",
    headline1: "Das KI-Betriebssystem für die ",
    headline2: "Rentabilität Ihres Restaurants.",
    pill1: "Kassenumsätze",
    pill2: "Wareneinsatz",
    pill3: "Lieferanten und Rechnungen",
    pill4: "Rezeptmargen",
    body: "Behalten Sie Umsatz, Wareneinsatz, Lieferanten, Rezepte und die Maßnahmen im Blick, die Ihre Marge schützen — alles in einer Kommandozentrale für Ihr Restaurant.",
    cta: "Kostenlos loslegen",
    nocard: "Keine Kreditkarte nötig · Einrichtung in unter 1 Stunde",
    login: "Anmelden",
    signup: "Registrieren",
  },
  login: {
    title: "Willkommen zurück",
    subtitle:
      "Melden Sie sich in Ihrem Bereich für die Restaurant-Rentabilität an",
    passwordUpdated:
      "Sie haben Ihr Passwort geändert. Melden Sie sich mit dem neuen an.",
    email: "E-Mail",
    emailPlaceholder: "sie@unternehmen.de",
    password: "Passwort",
    forgot: "Passwort vergessen?",
    submit: "Anmelden",
    submitting: "Anmeldung läuft…",
    noAccount: "Noch kein Konto?",
    createOne: "Konto erstellen",
    resendLabel: "Bestätigungs-E-Mail erneut senden",
    authFailed: "Die Anmeldung ist fehlgeschlagen",
    authFailedRetry:
      "Die Anmeldung ist fehlgeschlagen. Bitte versuchen Sie es erneut.",
    magicLinkFailed: "Die Anmeldung mit dem Magic Link ist fehlgeschlagen",
  },
  signup: {
    title: "Konto erstellen",
    description:
      "Umsatz, Kosten, Lieferanten und Rezepte Ihres Restaurants an einem Ort.",
    restaurantName: "Name des Restaurants",
    restaurantPlaceholder: "Mein Restaurant",
    email: "E-Mail",
    emailPlaceholder: "sie@unternehmen.de",
    password: "Passwort",
    minChars: "Mindestens 6 Zeichen",
    submit: "Konto erstellen",
    submitting: "Ihr Konto wird erstellt…",
    haveAccount: "Sie haben bereits ein Konto?",
    signIn: "Anmelden",
    createFailed:
      "Ihr Konto konnte nicht erstellt werden. Bitte versuchen Sie es erneut.",
    pendingInvite:
      "Für diese E-Mail-Adresse liegt eine Einladung vor. Verwenden Sie den Link aus Ihrer Einladung.",
    profileFailed:
      "Das Profil Ihres Restaurants konnte nicht erstellt werden. Bitte versuchen Sie es erneut.",
    genericFailed: "Beim Erstellen Ihres Kontos ist ein Fehler aufgetreten.",
  },
  checkEmail: {
    title: "Prüfen Sie Ihre E-Mails",
    bodyBefore: "Wir haben eine E-Mail an ",
    bodyAfter: " gesendet. Bestätigen Sie sie und melden Sie sich danach an.",
    spam: "Wenn Sie sie nach einigen Minuten nicht sehen, prüfen Sie Ihren Spam-Ordner.",
    goToLogin: "Zur Anmeldung",
  },
  password: {
    show: "Passwort anzeigen",
    hide: "Passwort verbergen",
  },
  resend: {
    label: "E-Mail erneut senden",
    sending: "Wird gesendet…",
    done: "Erledigt: Wir haben die E-Mail erneut an {email} gesendet.",
  },
  confirmedNotice: "E-Mail bestätigt",
  confirmedPage: {
    title: "E-Mail bestätigt",
    description: "E-Mail bestätigt, Sie können sich jetzt anmelden.",
    login: "Anmelden",
  },
  forgot: {
    title: "Passwort vergessen?",
    description:
      "Geben Sie Ihre E-Mail-Adresse ein, wir senden Ihnen einen Link zum Festlegen eines neuen Passworts.",
    sentNote: "Falls ein Konto existiert, haben wir einen Link gesendet.",
    email: "E-Mail",
    emailPlaceholder: "sie@unternehmen.de",
    send: "Link zum Zurücksetzen senden",
    sendAgain: "Erneut senden",
    sending: "Wird gesendet…",
    back: "Zurück zur Anmeldung",
  },
  reset: {
    checking: "Ihr Link wird geprüft…",
    invalidTitle: "Link abgelaufen oder ungültig",
    invalidDescription:
      "Links zum Zurücksetzen des Passworts funktionieren nur einmal und laufen nach kurzer Zeit ab.",
    invalidAlert: "Dieser Link ist nicht mehr gültig.",
    sendNew: "Neuen Link senden",
    title: "Neues Passwort festlegen",
    description: "Wählen Sie ein Passwort mit mindestens 8 Zeichen.",
    newPassword: "Neues Passwort",
    confirm: "Passwort bestätigen",
    tooShort: "Das Passwort muss mindestens 8 Zeichen lang sein.",
    mismatch: "Die Passwörter stimmen nicht überein.",
    updateFailed:
      "Ihr Passwort konnte nicht geändert werden. Der Link ist möglicherweise abgelaufen: Fordern Sie einen neuen an.",
    submit: "Passwort ändern",
    updating: "Wird geändert…",
  },
  invite: {
    unavailable: "Einladung nicht verfügbar",
    askNewLink: "Bitten Sie Ihren Milton-Kontakt um einen neuen Link.",
    join: "{workspace} beitreten",
    activateDescription: "Aktivieren Sie Ihr Milton-Konto.",
    yourWorkspace: "Ihr Arbeitsbereich",
    stateInvalid: "Dieser Einladungslink ist nicht gültig.",
    stateExpired: "Dieser Einladungslink ist abgelaufen.",
    stateAccepted: "Dieser Einladungslink wurde bereits verwendet.",
    stateRevoked: "Diese Einladung wurde zurückgezogen.",
    backToLogin: "Zurück zur Anmeldung",
    errInvalid:
      "Dieser Einladungslink ist nicht gültig. Bitten Sie Ihren Milton-Kontakt um einen neuen Link.",
    errUsed: "Dieser Einladungslink wurde bereits verwendet.",
    errRevoked:
      "Diese Einladung wurde zurückgezogen. Bitten Sie Ihren Milton-Kontakt um einen neuen Link.",
    errExpired:
      "Dieser Einladungslink ist abgelaufen. Bitten Sie Ihren Milton-Kontakt um einen neuen Link.",
    errEmailMismatch:
      "Sie sind mit einer anderen E-Mail-Adresse angemeldet als der eingeladenen. Melden Sie sich ab und verwenden Sie die eingeladene Adresse.",
    errOtherCompany:
      "Dieses Konto gehört bereits zu einem anderen Arbeitsbereich und kann diesem nicht beitreten.",
    errInvalidPassword:
      "Das Passwort muss zwischen 8 und 72 Zeichen lang sein.",
    errLoginRequired:
      "Melden Sie sich mit der eingeladenen E-Mail-Adresse an und öffnen Sie diesen Link erneut.",
    errAcceptFailed:
      "Diese Einladung konnte nicht aktiviert werden. Versuchen Sie es erneut oder bitten Sie Ihren Milton-Kontakt um Hilfe.",
    errGeneric: "Etwas ist schiefgelaufen. Bitte versuchen Sie es erneut.",
    accountExists:
      "Für diese E-Mail-Adresse existiert bereits ein Konto, daher können wir über diesen Link kein neues Passwort festlegen.",
    accountExistsLoginBefore: "Melden Sie sich an",
    accountExistsOr: " (oder ",
    accountExistsReset: "setzen Sie Ihr Passwort zurück",
    accountExistsAfter:
      ") und öffnen Sie diesen Einladungslink danach erneut, um dem Arbeitsbereich beizutreten.",
    signedInAs: "Sie sind als {email} angemeldet.",
    joining: "Beitritt läuft…",
    joinButton: "Arbeitsbereich beitreten",
    passwordTooShort: "Das Passwort muss mindestens 8 Zeichen lang sein.",
    passwordMismatch: "Die Passwörter stimmen nicht überein.",
    differentAccount:
      "Sie sind mit einem anderen Konto angemeldet. Melden Sie sich ab, um diese Einladung zu aktivieren.",
    email: "E-Mail",
    fullName: "Vollständiger Name (optional)",
    password: "Passwort",
    confirm: "Passwort bestätigen",
    activating: "Wird aktiviert…",
    activate: "Konto aktivieren",
  },
};
