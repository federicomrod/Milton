// Which restaurant a cost-workbook upload is for.
//
// Costs / recipes live on the company catalog, but POS links and new
// menu items are scoped to one location so a Los Ranchos file cannot
// silently attach itself to Lavara. When the switcher is on
// "Todos los restaurantes" and the company has more than one restaurant,
// we refuse instead of guessing.

export interface UploadRestaurantOption {
  id: string;
  name: string;
  brand_id: string | null;
}

export type UploadRestaurantScope =
  | {
      ok: true;
      locationId: string | null;
      brandId: string | null;
      name: string | null;
    }
  | { ok: false; code: "pick_restaurant" };

export const PICK_RESTAURANT_ERROR_ES =
  "Elige un restaurante en el menú de arriba a la izquierda. Con «Todos los restaurantes» no subo el archivo: este libro es de un restaurante y no quiero guardarlo en el lugar equivocado.";

export const PICK_RESTAURANT_ERROR_EN =
  "Pick a restaurant in the switcher at the top left. Uploading with All Restaurants selected is blocked so this file is not saved to the wrong place.";

export function resolveUploadRestaurantScope(input: {
  locations: UploadRestaurantOption[];
  requestedLocationId: string | null | undefined;
}): UploadRestaurantScope {
  const locations = input.locations;
  const requested = input.requestedLocationId?.trim() || null;

  if (locations.length === 0) {
    return { ok: true, locationId: null, brandId: null, name: null };
  }

  if (locations.length === 1) {
    const only = locations[0];
    return {
      ok: true,
      locationId: only.id,
      brandId: only.brand_id,
      name: only.name,
    };
  }

  if (!requested) return { ok: false, code: "pick_restaurant" };
  const match = locations.find((row) => row.id === requested);
  if (!match) return { ok: false, code: "pick_restaurant" };
  return {
    ok: true,
    locationId: match.id,
    brandId: match.brand_id,
    name: match.name,
  };
}
