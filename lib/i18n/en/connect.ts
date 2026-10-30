import type { Dictionary } from "../types";

export const connect: Dictionary["connect"] = {
  header: "Connect your data so Milton can show real numbers",
  subheader:
    "Pick how your sales data will reach Milton. You can change this later.",
  skip: "Skip for now → dashboard",
  recommended: "Matches your POS",
  requestSent: "Thanks — we'll get back to you",
  requestError: "Something went wrong. Please try again.",
  notePlaceholder: "Anything we should know? (optional)",
  otherTextLabel: "What holds your sales data today?",
  otherTextPlaceholder: "e.g. our POS is called … / we keep sales in …",
  otherSubmit: "Send",
  sendRequest: "Send request",
  sending: "Sending…",
  comingSoon: "Coming soon",
  options: {
    spreadsheet: {
      title: "Excel / spreadsheet upload",
      description:
        "Works today. Heads up: the uploader currently expects the item-level sales format (the Revel “Customer Items” columns), so not every spreadsheet will import yet.",
      upload: "Upload a spreadsheet",
    },
    revel: {
      title: "Revel",
      description:
        "Upload a Revel “Customer Items” export today. Live Revel sync is coming soon — request it and we'll let you know.",
      export: "Upload a Revel export",
      request: "Request it",
    },
    odoo: {
      title: "Odoo",
      description: "The Milton team connects Odoo for you during the pilot.",
      connect: "Connect Odoo",
      sent: "Thanks! The Milton team connects Odoo for you. We'll contact you to set it up.",
    },
    other: {
      title: "Other / tell us what holds your data",
      description:
        "Using something else? Tell us what holds your sales data and we'll look into it.",
      send: "Send",
    },
  },
  picks: {
    square: "Square",
    toast: "Toast",
    other: "Other",
  },
  api: {
    atLeastOneProduct: "Specify at least one product.",
    bodyMustBeJson: "The body must be JSON.",
    companyNotFound: "I did not find the company.",
    datesOrder: "start_date must be on or before end_date.",
    datesTogether:
      "start_date and end_date must go together, in YYYY-MM-DD format.",
    fileEmpty: "The file is empty.",
    linkChangeFailed: "I could not change the link.",
    linkChangeMissing: "Specify the Odoo product and the recipe.",
    linkCreateMissing: "Specify the Odoo product and its name.",
    missingColumns: "Required columns are missing.",
    noSheets: "The file has no sheets.",
    noValidRows: "There are no valid rows to save.",
    odooProductIdMissing: "odoo_product_id is missing.",
    recipeCreateFailed: "I could not create the recipe.",
    replaceFailed: "I could not replace the existing rows.",
    resaleCreateFailed: "I could not create the resale cost.",
    resaleMissing: "Specify the Odoo product, what you buy and the unit.",
    rowsSaveFailed: "I could not save the rows.",
    telegramAlreadyConnected:
      "This restaurant already has a Telegram chat connected.",
    treatmentMissing: "Specify the Odoo product and how it is costed.",
    treatmentSaveFailed: "I could not save how it is costed.",
    undoFailed: "I could not undo the confirmation.",
    uploadFailed: "The file could not be uploaded.",
    uploadFile: "Upload a file.",
    fileTooBigMb: "The file is larger than {mb} MB.",
    salesUploadDenied: "Your role cannot upload sales.",
  },
};
