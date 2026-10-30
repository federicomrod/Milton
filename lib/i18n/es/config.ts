import { configShared } from "./config-shared";
import { configAjustes } from "./config-ajustes";
import { configSites } from "./config-sites";
import { configGoals } from "./config-goals";
import { configTeam } from "./config-team";
import { configAccount } from "./config-account";

// One file per section so sections can be written in parallel.
export const config = {
  shared: configShared,
  ajustes: configAjustes,
  sites: configSites,
  goals: configGoals,
  team: configTeam,
  account: configAccount,
} as const;
