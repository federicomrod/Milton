// lib/i18n/es.ts — source of truth (Spanish). One module per area under ./es/.
import { common } from "./es/common";
import { shell } from "./es/shell";
import { auth } from "./es/auth";
import { onboarding } from "./es/onboarding";
import { cockpit } from "./es/cockpit";
import { sales } from "./es/sales";
import { costs } from "./es/costs";
import { rentabilidad } from "./es/rentabilidad";
import { menu } from "./es/menu";
import { kitchen } from "./es/kitchen";
import { connect } from "./es/connect";
import { ask } from "./es/ask";
import { settings } from "./es/settings";
import { errors } from "./es/errors";
import { comms } from "./es/comms";
import { admin } from "./es/admin";
import { config } from "./es/config";
import { support } from "./es/support";

export const es = {
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
} as const;
