// Menú › Preparaciones (R1-09b): list on the left, detail on the right.

import {
  MenuWorkspacePage,
  type MenuWorkspaceSearchParams,
} from "@/components/restaurant/menu/MenuWorkspacePage";

export const dynamic = "force-dynamic";

export default async function MenuPreparacionesPage({
  searchParams,
}: {
  searchParams: Promise<MenuWorkspaceSearchParams>;
}) {
  return <MenuWorkspacePage view="preparaciones" params={await searchParams} />;
}
