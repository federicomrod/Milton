import { menuScreens } from "./menu-screens";
import { menuEditor } from "./menu-editor";
import { menuWorkspace } from "./menu-workspace";
import { menuGroups } from "./menu-groups";

// Split in four files so four people can write in parallel.
export const menu = {
  screens: menuScreens,
  editor: menuEditor,
  workspace: menuWorkspace,
  groups: menuGroups,
} as const;
