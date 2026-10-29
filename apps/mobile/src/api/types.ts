// Shapes of the kitchen API (/api/mobile/v1/kitchen/*). Copied by hand from the
// server's allow-list serializers in lib/restaurant/kitchen/kitchen-serializer.ts
// (web repo, same repository). None of these has a price, cost, margin, total
// or sales field, and the app must never invent one.

export interface RedeemResponse {
  deviceToken: string;
  staff: { id: string; name: string };
  location: { id: string; name: string };
}

export interface KitchenMe {
  staff: { id: string; name: string };
  company: { name: string };
  locations: { id: string; name: string }[];
}

export type ItemKind = "photo" | "voice" | "document" | "text";

export interface HistoryItem {
  id: string;
  kind: ItemKind;
  text: string | null;
  status: "received" | "processed";
  createdAt: string;
}

export interface HistoryPage {
  items: HistoryItem[];
  nextCursor: string | null;
}

export interface UploadTicket {
  reportId: string;
  uploadUrl: string | null;
  uploadToken: string | null;
  path: string;
  expiresInS: number;
  duplicate: boolean;
}

export interface UploadResult {
  reportId: string;
  mediaId: string | null;
  duplicate: boolean;
}

export interface Recipe {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  yield: { quantity: number; unit: string } | null;
  ingredients: {
    name: string;
    quantity: number;
    unit: string;
    note: string | null;
  }[];
  steps: string[];
}

export interface RecipesPage {
  recipes: Recipe[];
  nextCursor: string | null;
}

export type RedeemReason = "invalid" | "used" | "revoked" | "expired" | "error";
