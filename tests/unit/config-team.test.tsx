// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { I18nProvider } from "@/lib/i18n/client";
import { TeamPanel } from "@/components/restaurant/config/team/TeamPanel";
import { getDictionary } from "@/lib/i18n";
import { roleKind } from "@/components/restaurant/config/team/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/app/dashboard/restaurant/data/team-actions", () => ({
  inviteMember: vi.fn(),
  removeMember: vi.fn(async () => ({ ok: true })),
  revokeInvite: vi.fn(),
}));

afterEach(cleanup);

const d = getDictionary("es").config.team;
const members = [
  {
    id: "m1",
    name: "Ana Ruiz",
    email: "ana@x.co",
    role: "owner" as const,
    isSelf: true,
  },
  {
    id: "m2",
    name: null,
    email: "leo@x.co",
    role: "readOnly" as const,
    isSelf: false,
  },
];
const invites = [
  {
    id: "i1",
    email: "new@x.co",
    role: "member" as const,
    expiresAt: "2030-01-10T00:00:00Z",
  },
];
const cooks = [
  { id: "c1", name: "Pepe", location: "Centro", via: "telegram" as const },
  { id: "c2", name: "Lola", location: null, via: "app" as const },
];

function ui(canManage: boolean) {
  return render(
    <I18nProvider lang="es">
      <TeamPanel
        members={members}
        invites={invites}
        cooks={cooks}
        canManage={canManage}
      />
    </I18nProvider>
  );
}

describe("TeamPanel", () => {
  it("shows both lists read-only for non-owners, with no actions", () => {
    ui(false);
    expect(screen.getByText("Ana Ruiz")).toBeTruthy();
    expect(screen.getByText("leo@x.co")).toBeTruthy();
    expect(screen.getByText(d.roleOwner)).toBeTruthy();
    expect(screen.getByText(d.roleReadOnly)).toBeTruthy();
    expect(screen.getByText("new@x.co")).toBeTruthy();
    expect(screen.getByText("Pepe")).toBeTruthy();
    expect(screen.getByText(d.viaApp)).toBeTruthy();
    expect(screen.getByText(d.viaTelegram)).toBeTruthy();
    expect(screen.queryByText(d.invite)).toBeNull();
    expect(screen.queryByText(d.remove)).toBeNull();
    expect(screen.queryByText(d.revoke)).toBeNull();
    expect(
      screen.getByText(getDictionary("es").config.shared.readOnly)
    ).toBeTruthy();
  });

  it("owner: Invitar opens the form in place; Quitar asks inline, never for yourself", () => {
    ui(true);
    // Only the non-self member has Quitar.
    expect(screen.getAllByText(d.remove)).toHaveLength(1);
    fireEvent.click(screen.getByText(d.invite));
    expect(screen.getByPlaceholderText(d.emailPlaceholder)).toBeTruthy();
    fireEvent.click(screen.getByText(d.remove));
    expect(screen.getByText("¿Quitar a leo@x.co?")).toBeTruthy();
    fireEvent.click(screen.getByText(d.yes).nextElementSibling!);
    expect(screen.queryByText("¿Quitar a leo@x.co?")).toBeNull();
  });
});

describe("roleKind", () => {
  it("maps roles to the three chips", () => {
    expect(roleKind("owner")).toBe("owner");
    expect(roleKind("Admin")).toBe("management");
    expect(roleKind("manager")).toBe("management");
    expect(roleKind("viewer")).toBe("readOnly");
    expect(roleKind("analyst")).toBe("readOnly");
  });
});
