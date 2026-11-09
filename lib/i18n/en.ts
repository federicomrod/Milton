// lib/i18n/en.ts — one module per area under ./en/, same shape as es.
import type { Dictionary } from "./types";
import { common } from "./en/common";
import { shell } from "./en/shell";
import { auth } from "./en/auth";
import { onboarding } from "./en/onboarding";
import { cockpit } from "./en/cockpit";
import { sales } from "./en/sales";
import { costs } from "./en/costs";
import { rentabilidad } from "./en/rentabilidad";
import { menu } from "./en/menu";
import { kitchen } from "./en/kitchen";
import { connect } from "./en/connect";
import { ask } from "./en/ask";
import { settings } from "./en/settings";
import { errors } from "./en/errors";
import { comms } from "./en/comms";
import { admin } from "./en/admin";
import { config } from "./en/config";
import { support } from "./en/support";

export const en: Dictionary = {
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
  config,
  support,
};
