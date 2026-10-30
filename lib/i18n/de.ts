// lib/i18n/de.ts — one module per area under ./de/, same shape as es.
import type { Dictionary } from "./types";
import { common } from "./de/common";
import { shell } from "./de/shell";
import { auth } from "./de/auth";
import { onboarding } from "./de/onboarding";
import { cockpit } from "./de/cockpit";
import { sales } from "./de/sales";
import { costs } from "./de/costs";
import { rentabilidad } from "./de/rentabilidad";
import { menu } from "./de/menu";
import { kitchen } from "./de/kitchen";
import { connect } from "./de/connect";
import { ask } from "./de/ask";
import { settings } from "./de/settings";
import { errors } from "./de/errors";
import { comms } from "./de/comms";
import { admin } from "./de/admin";

export const de: Dictionary = {
  common,
  shell,
  auth,
  onboarding,
  cockpit,
  sales,
  costs,
  rentabilidad,
  menu,
  kitchen,
  connect,
  ask,
  settings,
  errors,
  comms,
  admin,
};
