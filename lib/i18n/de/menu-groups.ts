import type { Dictionary } from "../types";

export const menuGroups: Dictionary["menu"]["groups"] = {
  filter: {
    all: "Alle",
    grouped: "Gruppiert",
    ungrouped: "Nicht gruppiert",
    ariaLabel: "Gruppierungsfilter",
  },
  bar: {
    ariaLabel: "Gruppierungsaktionen",
    selectedOne: "ausgewählt",
    selectedOther: "ausgewählt",
    addTo: "Zu {name} hinzufügen",
    addToExisting: "Zu bestehender Gruppe hinzufügen…",
    groupAs: "Gruppieren als…",
    merge: "Zusammenführen…",
    ungroup: "Gruppierung aufheben",
    clearSelection: "Auswahl aufheben",
  },
  groupAs: {
    title: "Gruppieren als…",
    dialogLabel: "Gruppieren als",
    namePlaceholder: "Gruppenname",
    nameAria: "Gruppenname",
    inside: "Innerhalb von",
    noParent: "Keine (oberste Gruppe)",
    hint: "Optional: In eine andere Gruppe legen, z. B. Limonaden in Getränke.",
    cancel: "Abbrechen",
    create: "Gruppe erstellen",
  },
  picker: {
    searchPlaceholder: "Gruppe suchen…",
    searchAria: "Gruppe suchen",
    noParent: "Keine (oberste Gruppe)",
    empty: "Keine Gruppen mit diesem Namen.",
    cancel: "Abbrechen",
  },
  chip: {
    none: "Kein Vorschlag",
    ask: "Zu {name} hinzufügen?",
    askAria: "Zu {name} hinzufügen",
  },
  toast: {
    undo: "Rückgängig",
    close: "Schließen",
  },
  menu: {
    ariaLabel: "Gruppenaktionen",
    rename: "Umbenennen",
    moveInside: "Verschieben nach…",
    combine: "Zusammenführen mit…",
    ungroup: "Gruppierung aufheben",
  },
  toolbar: {
    duplicateHint: "Sehen aus wie Duplikate? Gruppieren als „{name}“",
  },
  suggestions: {
    title: "Milton schlägt vor:",
    reasonName: "Gleicher Namensanfang",
    reasonCategory: "Gleiche Kategorie",
    reasonDefault: "Vorschlag von Milton",
    more: "+{n} weitere",
    thinking: "Überlege…",
    askMore: "Milton nach mehr fragen",
    mark: "Von Milton gruppiert",
    preview: "Vorschau · {n} {items}. Zählt noch nicht als gruppiert.",
    nameLabel: "Name",
    nameAria: "Name der vorgeschlagenen Gruppe",
    apply: "Übernehmen",
    dismiss: "Verwerfen",
    closePreview: "Vorschau schließen",
    itemProducts: "Produkte",
    itemIngredients: "Zutaten",
    itemPreparations: "Zubereitungen",
  },
  rowActions: {
    drill: "Aufschlüsselung",
    recipe: "Rezept",
  },
  list: {
    searchPlaceholder: "Suchen…",
    closeGroup: "Gruppe schließen",
    openGroup: "Gruppe öffnen",
    renameAria: "{name} umbenennen",
    renameTitle: "Umbenennen",
    combineTitle: "Zusammenführen mit…",
    moveTitle: "Gruppe verschieben nach…",
    noMatch: "Nichts passt zu „{query}“.",
  },
  hook: {
    saveGroupingFailed: "Die Gruppierung konnte nicht gespeichert werden.",
    undone: "Rückgängig gemacht",
    saveFailed: "Speichern nicht möglich.",
    changeFailed: "Diese Änderung war nicht möglich.",
  },
  suggestHook: {
    failed: "Milton konnte gerade keine Gruppen vorschlagen.",
    aiUnavailable:
      "KI ist in dieser Umgebung nicht eingerichtet: Es gibt nur Vorschläge nach Name und Kategorie.",
    noMore: "Milton hat keine weiteren eindeutigen Gruppen gefunden.",
  },
  dishPath: "Gericht · {name}",
  otherRestaurant:
    "„{group}“ gehört zu {restaurant}: Sie kann keine Produkte eines anderen Restaurants enthalten.",
  aRestaurant: "einem Restaurant",
  note: "{sales} Umsatz nicht gruppiert · {share}%",
  notAvailableTail:
    "Bis dahin können Sie die Produkte ansehen, aber keine Gruppen speichern.",
  searchPlaceholder: "Produkt oder Gruppe suchen…",
  mixedRestaurants:
    "Die Auswahl mischt Restaurants (oder Produkte beider): Die Gruppe wird gemeinsam genutzt.",
  colProduct: "Produkt",
  colGroupProduct: "Gruppe / Produkt",
  colSales: "Umsatz",
  colMargin: "Marge",
  colCost: "Kosten %",
  colShare: "% des Gesamtumsatzes",
  colSuggestion: "Vorschlag",
  allGrouped: "Alle Produkte sind gruppiert.",
  noneWithFilter: "Keine Produkte mit diesem Filter.",
  viewBreakdown: "Aufschlüsselung ansehen",
  productOne: "Produkt",
  productOther: "Produkte",
  menuDishTag: "Gericht der Speisekarte",
  select: "{name} auswählen",
  noPrice: "Kein Preis",
  ops: {
    nameRequired: "Geben Sie einen Namen für die Gruppe ein.",
    nameTooLong: "Der Name ist zu lang.",
    nameClash: "Dort gibt es bereits eine Gruppe „{name}“.",
    groupGone: "Diese Gruppe existiert nicht mehr.",
    saveMiltonFirst:
      "Speichern Sie zuerst die Gruppierung von Milton, um dieses Gericht gruppieren zu können.",
    sameKind: "Eine Gruppe gehört in eine Gruppe derselben Art.",
    notInsideSelf: "Eine Gruppe kann nicht in sich selbst liegen.",
    autoNoUngroup:
      "Gerichte der Speisekarte lassen sich nicht auflösen: Nutzen Sie „Verschieben“ oder „Gericht ausschließen“.",
    pickTwo: "Wählen Sie mindestens zwei Gruppen.",
    autoNoMerge:
      "Ein Gericht der Speisekarte lässt sich nicht mit einer anderen Gruppe zusammenführen.",
    mergeSameKind:
      "Nur Gruppen derselben Art und desselben Restaurants lassen sich zusammenführen.",
    mergeNested:
      "Eine Gruppe lässt sich nicht mit einer Gruppe zusammenführen, die in ihr liegt.",
    subgroupClash:
      "Beide Gruppen haben eine Untergruppe „{name}“. Benennen Sie zuerst eine um.",
    created: "Gruppe „{name}“ erstellt",
    createdWith: "Gruppe „{name}“ mit {count} erstellt",
    addedOne: "{count} zu „{name}“ hinzugefügt",
    addedOther: "{count} zu „{name}“ hinzugefügt",
    ungrouped: "{count} nicht gruppiert",
    suggestionsOne: "{count} Vorschlag von Milton",
    suggestionsOther: "{count} Vorschläge von Milton",
    alreadyGrouped: "„{name}“ war bereits gruppiert",
    acceptedByMilton: "Gruppe „{name}“ von Milton gruppiert",
    noChanges: "Keine Änderungen",
    renamed: "„{from}“ heißt jetzt „{to}“",
    moved: "„{name}“ verschoben",
    movedTop: "„{name}“ auf die oberste Ebene verschoben",
    dissolved: "Gruppe „{name}“ aufgelöst",
    merged: "{count} Gruppen zu „{name}“ zusammengeführt",
  },
  parse: {
    missingChanges: "Die Änderungen der Gruppierung fehlen.",
    badFormat: "Die Änderungen haben nicht das erwartete Format.",
    tooMany: "Zu viele Änderungen auf einmal.",
    badId: "Es gibt eine ungültige Kennung.",
    groupNoId: "Eine Gruppe hat keine gültige Kennung.",
    groupName: "Der Name einer Gruppe ist ungültig.",
    groupType: "Ungültiger Gruppentyp.",
    dimension: "Ungültige Dimension.",
    origin: "Ungültiger Ursprung.",
    status: "Ungültiger Status.",
    reference: "Ungültige Referenz.",
    memberInvalid: "Ein Mitglied ist ungültig.",
    memberType: "Ungültiger Mitgliedstyp.",
    memberRef: "Ungültige Mitgliedsreferenz.",
  },
  upload: {
    fileTooBig:
      "Diese Datei ist größer als 4 MB. Teilen Sie sie auf oder laden Sie die Seiten als Fotos hoch.",
    unknownType:
      "Diesen Dateityp kann ich noch nicht lesen. Verwenden Sie Excel, Word, PDF, CSV oder ein Foto.",
    oldDoc: "Speichern Sie die Datei als .docx und laden Sie sie erneut hoch.",
    noRecipes: "Ich habe in dieser Datei keine Rezepte gefunden.",
    readFailed:
      "Ich konnte die Rezepte in dieser Datei nicht lesen. Bitte versuchen Sie es erneut.",
    aiUnavailable:
      "Milton kann Dateien gerade nicht mit KI lesen. Bitte versuchen Sie es später erneut.",
    skippedOne:
      "Ich konnte 1 Teil der Datei nicht lesen; die Rezepte daraus wurden nicht geladen. Laden Sie sie erneut hoch.",
    skippedOther:
      "Ich konnte {count} Teile der Datei nicht lesen; die Rezepte daraus wurden nicht geladen. Laden Sie sie erneut hoch.",
    pdfTooLong: "Diese PDF hat mehr als 30 Seiten. Teilen Sie sie auf.",
    chunkCap:
      "Ich habe die ersten 30 Blätter/Seiten gelesen; laden Sie den Rest in einer weiteren Datei hoch.",
    fileUnreadable:
      "Ich konnte diese Datei nicht lesen. Prüfen Sie, ob sie beschädigt ist, und laden Sie sie erneut hoch.",
    noText: "Ich habe in dieser Datei keinen Text gefunden.",
    tooManyTabs: "Diese Datei hat mehr als {max} Blätter. Teilen Sie sie auf.",
    sheetTooManyRows:
      "Ein Blatt hat mehr als {rows} Zeilen. Teilen Sie es auf.",
    fileTooManyRows:
      "Die Datei hat mehr als {rows} Zeilen. Teilen Sie sie auf.",
    draftSaveError:
      "Einige Rezepte konnten nicht gespeichert werden. Bitte versuchen Sie es erneut.",
    noIngredients: "keine Zutaten gefunden",
    notARecipe: "sieht nicht wie ein Rezept aus",
    noRecipeName: "keinen Rezeptnamen gefunden",
    unreadableRecipe: "dieses Rezept nicht richtig lesen können",
  },
  priceCatalog: {
    rowError: "Der Preis in dieser Zeile enthält einen Fehler in Ihrer Datei.",
    noPrice: "Diese Zeile enthält keinen Preis.",
    confirmUnit: "Die Einheit dieser Zeile muss noch bestätigt werden.",
    missingUnitOrPrice: "Die Einheit oder der Preis fehlt.",
    alsoPerUnit: "auch ${cost} pro Einheit",
    rowNote: "{sheet} · Zeile {row}",
    confirmedRowNote: "{sheet} · Zeile {row} (Einheit bestätigt)",
    ingredientNotFound: "Ich habe die Zutat in Ihrer Liste nicht gefunden.",
    noStoredPrice:
      "Die Liste hat für diese Zutat keinen gespeicherten Preis hinterlassen. Wählen Sie den aus den Rezepten oder „Keine (Ausstehend lassen)“.",
    convertCostFailed:
      "Ich konnte diese Kosten nicht in die Einheit der Zutat umrechnen.",
    saveCostFailed: "Ich konnte die gewählten Kosten nicht speichern.",
    twoCosts: "Zwei Kosten für {name}. Bestätigen Sie, welche gelten sollen.",
    decisionNotFound: "Ich habe diese Entscheidung nicht gefunden.",
    decisionResolved: "Diese Entscheidung ist bereits erledigt.",
    uploadUndone: "Dieser Upload wurde bereits rückgängig gemacht.",
    optionMissing: "Diese Option gibt es nicht.",
    rowNotFound: "Ich habe diese Zeile in Ihrer Liste nicht gefunden.",
    rowResolved: "Diese Zeile ist bereits erledigt.",
    rowNoName: "Diese Zeile hat keinen Namen.",
    addIngredientFailed: "Ich konnte die Zutat nicht hinzufügen.",
    convertPriceFailed:
      "Ich konnte diesen Preis nicht in die Einheit der Zutat umrechnen.",
    savePriceFailed: "Ich konnte den Preis nicht speichern.",
  },
  menuReading: {
    urlRequired: "Geben Sie die Adresse Ihrer Speisekarte ein.",
    urlInvalid: "Diese Adresse ist ungültig.",
    urlHttps: "Die Adresse muss mit https:// beginnen.",
    urlCredentials:
      "Die Adresse darf keinen Benutzernamen und kein Passwort enthalten.",
    urlPort: "Die Adresse darf keinen anderen Port verwenden.",
    urlIp: "Geben Sie die Adresse mit dem Seitennamen ein, nicht mit einer IP.",
    urlNotPublic: "Diese Adresse ist keine öffentliche Seite.",
    pageError:
      "Die Seite hat mit einem Fehler geantwortet ({status}). Fügen Sie den Text der Speisekarte ein.",
    notWebPage:
      "Diese Adresse ist keine Webseite (möglicherweise ein PDF oder ein Bild). Fügen Sie den Text der Speisekarte ein.",
    pageTooBig: "Die Seite ist zu groß.",
    tooManyRedirects: "Die Seite leitet zu oft weiter.",
    timeout:
      "Die Seite hat zu lange nicht geantwortet. Fügen Sie den Text der Speisekarte ein.",
    openFailed:
      "Ich konnte diese Seite nicht öffnen. Prüfen Sie die Adresse oder fügen Sie den Text der Speisekarte ein.",
    menuNotFoundOnPage:
      "Ich habe die Speisekarte auf dieser Seite nicht gefunden (sie wird eventuell per JavaScript geladen). Fügen Sie den Text der Speisekarte ein.",
    textTooShort: "Dieser Text ist zu kurz für eine Speisekarte.",
    notFoundInMenu: "In der Speisekarte nicht gefunden",
    hasRecipeReason:
      "hat bereits ein Rezept (aus Ihrem Excel oder von Hand); die Speisekarte ändert es nicht",
    noComponentsReason: "die Speisekarte sagt nicht, was in diesem Gericht ist",
    draftExistsReason: "hat bereits einen Entwurf aus der Speisekarte",
    hitPreparation:
      "Aus der Speisekarte; sieht aus wie Ihre Zubereitung „{name}“. Bestätigen Sie sie und tragen Sie die Menge ein.",
    hitIngredient:
      "Aus der Speisekarte; sieht aus wie Ihre Zutat „{name}“. Bestätigen Sie sie und tragen Sie die Menge ein.",
    notInList:
      "Aus der Speisekarte; nicht in Ihrer Liste. Neu, vorgeschlagen: Legen Sie sie an oder wählen Sie eine aus Ihrer Liste.",
    fromMenu: "Aus der Speisekarte: {name}",
    missingQuantities:
      "Die Mengen fehlen: Die Speisekarte sagt, was enthalten ist, nicht wie viel.",
    batchUrl: "Speisekarte · {host}",
    batchPasted: "Speisekarte · eingefügter Text",
    noDishesFound:
      "Ich habe in dieser Speisekarte keine Gerichte gefunden. Prüfen Sie die Adresse oder fügen Sie den Text ein.",
    draftNote: "Entwurf aus der Speisekarte",
    estimateTablesMissing:
      "Das Datenbank-Update (062) muss noch eingespielt werden.",
    estimateApproved:
      "Dieses Gericht hat bereits ein freigegebenes Rezept; Milton ändert es nicht.",
    estimateNotFound: "Für dieses Gericht gibt es keine Schätzung von Milton.",
    estimateNoDraft:
      "Dieses Gericht hat keinen Entwurf aus der Speisekarte, in den die Schätzung kopiert werden kann.",
    estimateDraftCreate:
      "Ich konnte den Entwurf aus der Speisekarte für dieses Gericht nicht vorbereiten. Nutzen Sie „Speisekarte lesen“ und versuchen Sie es erneut.",
    estimateEmpty: "Die Schätzung enthält keine Zutaten zum Kopieren.",
    readEstimatesFailed: "Ich konnte die Schätzungen nicht lesen.",
    confirmWriteQty: "Bestätigen Sie sie und tragen Sie die Menge ein.",
    confirmOnly: "Bestätigen Sie sie.",
    estimatedReview:
      "Von Milton geschätzt: Prüfen Sie Menge und Einheit vor der Freigabe.",
    quantitiesEstimated:
      "Mengen von Milton geschätzt: Prüfen Sie sie vor der Freigabe.",
    dishNotFound: "Ich habe dieses Gericht nicht gefunden.",
    readEstimateFailed: "Ich konnte die Schätzung nicht lesen.",
    readDishFailed: "Ich konnte das Gericht nicht lesen.",
    saveDraftFailed: "Ich konnte den Entwurf nicht speichern.",
  },
  menuReadSummary: {
    readOne: "Ich habe 1 Gericht in Ihrer Speisekarte gelesen{parts}.",
    readOther: "Ich habe {n} Gerichte in Ihrer Speisekarte gelesen{parts}.",
    partDrafted: "{n} mit neuem Entwurf",
    partHasRecipeOne: "{n} hatte bereits ein Rezept",
    partHasRecipeOther: "{n} hatten bereits ein Rezept",
    partDraftExistsOne: "{n} hatte bereits einen Entwurf",
    partDraftExistsOther: "{n} hatten bereits einen Entwurf",
    partNoneOne: "{n} sagt nicht, was enthalten ist",
    partNoneOther: "{n} sagen nicht, was enthalten ist",
    partNoPos: "{n} ohne Produkt in Ihrem Kassensystem",
    partFailed: "{n} mit Fehler",
    draftedOne: "Ich habe {n} Rezeptentwurf vorbereitet.",
    draftedOther: "Ich habe {n} Rezeptentwürfe vorbereitet.",
    draftedPending: "Die Mengen bleiben offen: Sie tragen sie ein.",
    noIngredientsOne:
      "1 Gericht der Speisekarte sagt nicht, was enthalten ist: Ich konnte den Entwurf nicht erstellen. Nutzen Sie „Mit Milton schätzen“.",
    noIngredientsOther:
      "{n} Gerichte der Speisekarte sagen nicht, was enthalten ist: Ich konnte den Entwurf nicht erstellen. Nutzen Sie „Mit Milton schätzen“.",
    notOnMenuOne:
      "1 Gericht mit Umsatz in diesem Monat hat kein Rezept und steht nicht in der Speisekarte.",
    notOnMenuOther:
      "{n} Gerichte mit Umsatz in diesem Monat haben kein Rezept und stehen nicht in der Speisekarte.",
    failedOne:
      "Ich konnte 1 Gericht nicht vorbereiten. Versuchen Sie es erneut.",
    failedOther:
      "Ich konnte {n} Gerichte nicht vorbereiten. Versuchen Sie es erneut.",
    newComponentsOne:
      "{n} Bestandteil ist neu (Neu, vorgeschlagen): Legen Sie ihn an oder wählen Sie einen aus Ihrer Liste.",
    newComponentsOther:
      "{n} Bestandteile sind neu (Neu, vorgeschlagen): Legen Sie sie an oder wählen Sie einen aus Ihrer Liste.",
    truncated:
      "Die Speisekarte war sehr lang und ich habe nur den ersten Teil gelesen.",
  },
  api: {
    fileReadFailed:
      "Ich konnte die Datei nicht lesen. Bitte versuchen Sie es erneut.",
    pickFile: "Wählen Sie eine Datei zum Hochladen aus.",
    locationCheckFailed:
      "Ich konnte den Standort nicht prüfen. Bitte versuchen Sie es erneut.",
    locationNotFound: "Ich habe diesen Standort nicht gefunden.",
  },
};
