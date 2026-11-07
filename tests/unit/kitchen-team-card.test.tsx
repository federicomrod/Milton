// @vitest-environment jsdom
// Configuración › Equipo: the kitchen team card shows each cook with the three
// manager tools. A temporary PIN is shown once; destructive steps confirm inline.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const actions = vi.hoisted(() => ({
  list: vi.fn(),
  reset: vi.fn(),
  link: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("@/app/dashboard/restaurant/kitchen/team-actions", () => ({
  listKitchenTeamAction: actions.list,
  resetKitchenPinAction: actions.reset,
  sendNewKitchenLinkAction: actions.link,
  signOutKitchenPhoneAction: actions.signOut,
}));
let lang = "es";
vi.mock("@/components/restaurant/shell/shell-chrome-context", () => ({
  useRestaurantShellChrome: () => ({ lang }),
}));

import { KitchenTeamCard } from "@/components/restaurant/kitchen/KitchenTeamCard";
import { kitchenTeamCopy } from "@/lib/restaurant/kitchen/team-copy";

const LOC = "22222222-2222-4222-8222-222222222222";
const member = {
  id: "44444444-4444-4444-8444-444444444441",
  name: "Luis",
  locationId: LOC,
  hasPin: true,
  pinMustChange: false,
  isSelf: false,
  devices: [{ id: "d1", label: "iPhone", platform: "ios", lastSeenAt: null }],
};
function setup() {
  actions.list.mockResolvedValue({
    ok: true,
    kitchenCode: "ABC234",
    team: [member],
  });
  render(<KitchenTeamCard locations={[{ id: LOC, name: "Centro" }]} />);
}
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  lang = "es";
});

describe("KitchenTeamCard", () => {
  it("lists the cook with the kitchen code and the three tools", async () => {
    setup();
    expect(await screen.findByText("Luis")).toBeTruthy();
    expect(screen.getByTestId("kitchen-code").textContent).toBe("ABC234");
    expect(screen.getByText(/Restablecer PIN/)).toBeTruthy();
    expect(screen.getByText("Enviar nuevo enlace")).toBeTruthy();
    expect(screen.getByText("Cerrar sesión en este teléfono")).toBeTruthy();
  });
  it("a temporary PIN asks first, then is shown once", async () => {
    actions.reset.mockResolvedValue({ ok: true, temporaryPin: "804216" });
    setup();
    await screen.findByText("Luis");
    fireEvent.click(screen.getByText(/Restablecer PIN/));
    expect(actions.reset).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Confirmar"));
    await waitFor(() =>
      expect(screen.getByTestId("team-shown-pin").textContent).toContain(
        "804216"
      )
    );
    expect(actions.reset).toHaveBeenCalledWith(member.id, "temporary");
  });
  it("a new link is shown once as /k/<code> and keeps the same cook", async () => {
    actions.link.mockResolvedValue({
      ok: true,
      code: "secretcode",
      expiresAt: "2026-11-11",
    });
    setup();
    await screen.findByText("Luis");
    fireEvent.click(screen.getByText("Enviar nuevo enlace"));
    fireEvent.click(screen.getByText("Confirmar"));
    await waitFor(() =>
      expect(screen.getByTestId("team-shown-link").textContent).toContain(
        "/k/secretcode"
      )
    );
    expect(actions.link).toHaveBeenCalledWith(member.id);
  });
  it("signing a phone out confirms, then calls the action for THAT phone", async () => {
    actions.signOut.mockResolvedValue({ ok: true });
    setup();
    await screen.findByText("Luis");
    fireEvent.click(screen.getByText("Cerrar sesión en este teléfono"));
    expect(actions.signOut).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Confirmar"));
    await waitFor(() =>
      expect(actions.signOut).toHaveBeenCalledWith(member.id, "d1")
    );
  });
  it("shows the error in the user's language and no yellow box", async () => {
    lang = "de";
    actions.list.mockResolvedValue({ ok: false, error: "forbidden" });
    render(<KitchenTeamCard locations={[]} />);
    expect(
      await screen.findByText(kitchenTeamCopy("de").errors.forbidden)
    ).toBeTruthy();
    expect(document.body.innerHTML).not.toMatch(/FDE68A|yellow|amber/i);
  });
  it("es, en and de have the same keys", () => {
    const keys = (o: object): string[] =>
      Object.entries(o).flatMap(([k, v]) =>
        typeof v === "object" ? keys(v).map((x) => `${k}.${x}`) : [k]
      );
    expect(keys(kitchenTeamCopy("en"))).toEqual(keys(kitchenTeamCopy("es")));
    expect(keys(kitchenTeamCopy("de"))).toEqual(keys(kitchenTeamCopy("es")));
  });
});
