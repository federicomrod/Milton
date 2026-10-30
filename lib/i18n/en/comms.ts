import type { Dictionary } from "../types";

export const comms: Dictionary["comms"] = {
  api: {
    briefingContextFailed: "Could not prepare the briefing.",
    prefsLoadFailed: "Could not load the delivery preferences.",
    prefsSaveFailed: "Could not save the settings.",
    bodyNotJson: "The request body is not valid JSON.",
    cadenceInvalid: "Frequency must be one of: off, daily, weekly.",
    recipientRequired:
      "A valid email address is required when delivery is daily or weekly.",
    timezoneRequired:
      "A valid time zone is required when delivery is daily or weekly.",
    recipientLookupFailed: "Could not look up the briefing recipient.",
    recipientMissing: "No briefing recipient email is configured.",
    recipientMissingHelp:
      "Save a recipient email in the briefing delivery settings before sending a test.",
    briefingGenerateFailed: "Could not generate the briefing.",
  },
  emailCard: {
    title: "Briefing delivery",
    description: "Receive the Milton briefing by email",
    loading: "Loading…",
    cadence: "Frequency",
    cadenceOff: "Off",
    cadenceDaily: "Daily",
    cadenceWeekly: "Weekly",
    recipient: "Recipient email",
    invalidEmail: "Enter a valid email address.",
    weekday: "Day of the week",
    weekdays: [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ],
    timezone: "Delivery time zone",
    timezonePlaceholder: "Choose a time zone",
    timezoneMissing: "The time zone is missing: choose it above.",
    save: "Save",
    saving: "Saving…",
    saved: "Saved.",
    sendTest: "Send test email",
    sending: "Sending…",
    sentTo: "Sent. Check {recipient}.",
    sentToInbox: "Sent. Check your inbox.",
    loadFailed: "Could not load the delivery preferences.",
    saveFailed: "Could not save the settings.",
    testFailed: "Could not send the test email. Try again.",
  },
};
