// /dashboard/settings lives inside the restaurant shell (left sidebar, Configuración
// at the bottom), like Cockpit, Ventas, Menú, Costos and Cocina.

import { SettingsPreferencesProviders } from "@/components/layout/settings-preferences-providers";
import RestaurantShellLayout from "@/components/restaurant/RestaurantShellLayout";

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RestaurantShellLayout>
      <SettingsPreferencesProviders>{children}</SettingsPreferencesProviders>
    </RestaurantShellLayout>
  );
}
