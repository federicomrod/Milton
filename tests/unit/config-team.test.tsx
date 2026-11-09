// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { afterEach } from "vitest";
import { I18nProvider } from "@/lib/i18n/client";
import { TeamPanel } from "@/components/restaurant/config/team/TeamPanel";
import { getDictionary } from "@/lib/i18n";
import { roleKind } from "@/components/restaurant/config/team/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/app/dashboard/restaurant/data/team-actions", () => ({
  inviteMember: vi.fn(async () => ({
    ok: true,
    inviteId: "i2",
    link: "https://app.milton.test/auth/invite?token=abc",
    emailSent: false,
    email: "nuevo@x.co",
    role: "manager",
    expiresAt: "2030-01-10T00:00:00Z",
  })),
  removeMember: vi.fn(async () => ({ ok: true })),
  revokeInvite: vi.fn(),
  resendInvite: vi.fn(),
  changeMemberRole: vi.fn(async () => ({ ok: true, role: "analyst" })),
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
    role: "viewer" as const,
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

function ui(canManage: boolean, actorRole: string | null = "owner") {
  return render(
    <I18nProvider lang="es">
      <TeamPanel
        members={members}
        invites={invites}
        cooks={cooks}
        canManage={canManage}
        actorRole={actorRole}
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

describe("TeamPanel roles and invites", () => {
  it("shows each role as a badge on member and invite rows", () => {
    ui(true);
    const badges = screen
      .getAllByTestId("team-role-badge")
      .map((b) => b.textContent);
    expect(badges).toEqual([d.roleOwner, d.roleReadOnly, d.roleManagement]);
  });

  it("Invitar is the solid primary blue button", () => {
    ui(true);
    expect(screen.getByText(d.invite).className).toContain("bg-[#1B40C8]");
  });

  it("the role dropdown lists the five roles, defaults to Gerente and has a hint", () => {
    ui(true);
    fireEvent.click(screen.getByText(d.invite));
    const select = screen.getByLabelText(d.role) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      "owner",
      "admin",
      "manager",
      "analyst",
      "viewer",
    ]);
    expect(select.value).toBe("manager");
    expect(screen.getByTestId("team-role-hint").textContent).toBe(d.roleHint);
  });

  it("an admin is not offered Propietario", () => {
    ui(true, "admin");
    fireEvent.click(screen.getByText(d.invite));
    const select = screen.getByLabelText(d.role) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).not.toContain(
      "owner"
    );
    expect(select.value).toBe("manager");
  });

  it("when the email fails, a note sits above the link box", async () => {
    ui(true);
    fireEvent.click(screen.getByText(d.invite));
    fireEvent.change(screen.getByPlaceholderText(d.emailPlaceholder), {
      target: { value: "nuevo@x.co" },
    });
    fireEvent.click(screen.getByText(d.send));
    const note = await waitFor(() => screen.getByTestId("team-email-failed"));
    expect(note.textContent).toContain(
      "No pudimos enviar el correo. Copia el enlace y compártelo."
    );
    const box = screen.getByTestId("team-invite-link");
    expect(box.contains(note)).toBe(true);
    expect(note.compareDocumentPosition(box.querySelector("input")!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  it("pending invites offer Reenviar (the link cannot be shown again)", () => {
    ui(true);
    expect(screen.getByText(d.resend)).toBeTruthy();
    expect(screen.getByText(d.resendNote)).toBeTruthy();
  });

  it("owner can change another member's role; nobody changes their own", () => {
    ui(true);
    // Ana (self) has no button; Leo has one.
    expect(screen.getAllByText(d.changeRole)).toHaveLength(1);
  });

  it("an admin cannot change or remove an owner", () => {
    render(
      <I18nProvider lang="es">
        <TeamPanel
          members={[
            {
              id: "m9",
              name: "Dueña",
              email: null,
              role: "owner",
              isSelf: false,
            },
          ]}
          invites={[]}
          cooks={[]}
          canManage
          actorRole="admin"
        />
      </I18nProvider>
    );
    expect(screen.queryByText(d.changeRole)).toBeNull();
    expect(screen.queryByText(d.remove)).toBeNull();
  });
});

describe("roleKind", () => {
  it("keeps each role; unknown or empty reads as the legacy «member»", () => {
    expect(roleKind("owner")).toBe("owner");
    expect(roleKind("Admin")).toBe("admin");
    expect(roleKind("manager")).toBe("manager");
    expect(roleKind("viewer")).toBe("viewer");
    expect(roleKind("analyst")).toBe("analyst");
    expect(roleKind("member")).toBe("member");
    expect(roleKind("intern")).toBe("member");
    expect(roleKind(null)).toBe("member");
  });
});
