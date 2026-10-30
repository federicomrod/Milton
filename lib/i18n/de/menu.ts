import type { Dictionary } from "../types";
import { menuScreens } from "./menu-screens";
import { menuEditor } from "./menu-editor";
import { menuWorkspace } from "./menu-workspace";
import { menuGroups } from "./menu-groups";

export const menu: Dictionary["menu"] = {
  screens: menuScreens,
  editor: menuEditor,
  workspace: menuWorkspace,
  groups: menuGroups,
};
