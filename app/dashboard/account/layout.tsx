// /dashboard/account lives inside the restaurant shell (left sidebar, Configuración
// at the bottom), like Cockpit, Ventas, Menú, Costos and Cocina.

import RestaurantShellLayout from "@/components/restaurant/RestaurantShellLayout";

export default function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <RestaurantShellLayout>{children}</RestaurantShellLayout>;
}
