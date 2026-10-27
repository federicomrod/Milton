// Restaurant, Ajustes and Cuenta already have their own server layouts
// (RestaurantShell). The legacy CFO client wrapper is gone: no session
// probe, no KPI / data-status fetches, no Milton chat on these pages.

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
