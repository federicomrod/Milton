// app/dashboard/restaurant/rentabilidad/page.tsx
//
// Rentabilidad (#400): is the restaurant making money this month? One
// restaurant and one calendar month, computed by lib/restaurant/rentabilidad.ts.
// Visible only with the `costs.fixed` capability (owner, admin, manager).

import { redirect } from "next/navigation";
import { RentabilidadGroupPage } from "@/components/restaurant/rentabilidad/RentabilidadGroupPage";
import { RentabilidadPage } from "@/components/restaurant/rentabilidad/RentabilidadPage";
import { capabilityFlags } from "@/lib/auth/permissions";
import {
  getCachedActor,
  getCachedAuthUser,
  getCachedCompanyId,
} from "@/lib/restaurant/auth-user";
import { monthStartOf, previousMonthStart } from "@/lib/restaurant/fixed-costs";
import { COCKPIT_HREF, COSTS_HREF } from "@/lib/restaurant/navigation";
import {
  loadRentabilidadGroups,
  loadRentabilidadPages,
  type RentabilidadGroupData,
  type RentabilidadPageData,
} from "@/lib/restaurant/rentabilidad-server";
import { resolveRestaurantContext } from "@/lib/restaurant/restaurant-context-server";
import { OperatingPageHeader } from "@/components/restaurant/shell/OperatingPageHeader";
import { createClient } from "@/lib/supabase/server";
import { apiDictionary } from "@/lib/restaurant/api-lang";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) =>
  Array.isArray(v) ? v[0] : v;

function Note({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="w-full space-y-3 px-6 py-3 lg:px-10">
      <OperatingPageHeader title={title} showDateRange={false} />
      <div className="rounded-[14px] border border-[#dbe3f7] bg-white px-4 py-3.5 text-[13px] text-[#6b7385]">
        {children}
      </div>
    </div>
  );
}

export default async function RentabilidadRoute({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const d = (await apiDictionary()).rentabilidad;
  const user = await getCachedAuthUser();
  const companyId = user?.id ? await getCachedCompanyId(user.id) : null;
  if (!user?.id || !companyId) return <Note title={d.title}>{d.signIn}</Note>;
  const supabase = await createClient();
  // The role check and the restaurant list do not depend on each other.
  const [actor, context] = await Promise.all([
    getCachedActor(user.id, companyId),
    resolveRestaurantContext(supabase, companyId, first(params.location)),
  ]);
  // Checked here on the server, never only in the menu: analyst, viewer and
  // every other role go back to the cockpit.
  if (!capabilityFlags(actor)["costs.fixed"]) redirect(COCKPIT_HREF);
  // One restaurant: the selected one, or the only one the company has.
  const selected =
    context.selected?.locationId ??
    (context.locations.length === 1 ? context.locations[0].id : null);
  const currentMonth = monthStartOf(new Date()) as string;
  const requested = first(params.month)
    ? monthStartOf(first(params.month)!)
    : null;
  const month =
    requested && requested <= currentMonth ? requested : currentMonth;
  // The picker's three months are loaded together (one shared read), so the
  // page switches between them without another request.
  const pickerMonths = [
    previousMonthStart(previousMonthStart(currentMonth)),
    previousMonthStart(currentMonth),
    currentMonth,
  ];
  const wantedMonths = [...new Set([...pickerMonths, month])];
  if (!selected) {
    // «Todos los restaurantes»: one line per restaurant plus the total.
    if (context.locations.length < 2)
      return <Note title={d.title}>{d.pickRestaurant}</Note>;
    let groups: Record<string, RentabilidadGroupData>;
    try {
      groups = await loadRentabilidadGroups({
        supabase,
        companyId,
        locations: context.locations.map((l) => ({ id: l.id, name: l.name })),
        months: wantedMonths,
      });
    } catch (err) {
      console.error("[rentabilidad] group load failed:", err);
      return (
        <Note title={d.title}>
          {d.loadFailedBefore}{" "}
          <a className="underline" href={COSTS_HREF}>
            {d.loadFailedLink}
          </a>
          .
        </Note>
      );
    }
    return (
      <RentabilidadGroupPage
        key="group"
        data={groups[month]}
        pages={groups}
        months={pickerMonths}
        currentMonth={currentMonth}
      />
    );
  }
  let pages: Record<string, RentabilidadPageData>;
  try {
    pages = await loadRentabilidadPages({
      supabase,
      companyId,
      locationId: selected,
      restaurantIds: context.locations.map((l) => l.id),
      months: wantedMonths,
    });
  } catch (err) {
    console.error("[rentabilidad] load failed:", err);
    return (
      <Note title={d.title}>
        {d.loadFailedBefore}{" "}
        <a className="underline" href={COSTS_HREF}>
          {d.loadFailedLink}
        </a>
        .
      </Note>
    );
  }
  return (
    <RentabilidadPage
      key={`${selected}|${month}`}
      data={pages[month]}
      pages={pages}
      locationId={selected}
      locationName={
        context.locations.find((l) => l.id === selected)?.name ?? null
      }
      months={pickerMonths}
      currentMonth={currentMonth}
    />
  );
}
