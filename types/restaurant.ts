// types/restaurant.ts
// Restaurant domain types for Milton's restaurant profitability and operations copilot.

export type MenuItemStatus = "active" | "inactive";
export type RecommendationSeverity = "info" | "warning" | "critical";
export type RecommendationStatus =
  | "open"
  | "accepted"
  | "dismissed"
  | "resolved";
export type AgentRunStatus = "queued" | "running" | "completed" | "failed";
export type UnitOfMeasure =
  | "kg"
  | "g"
  | "l"
  | "ml"
  | "unit"
  | "portion"
  | "oz"
  | "lb";

// Explicit status for ingredient cost resolution so callers know WHY cost is null.
export type MenuItemCostStatus =
  | "complete"
  | "missing_recipe"
  | "missing_ingredient_cost"
  | "missing_unit_conversion";

// --- Brand & Location ---

export interface RestaurantBrand {
  id: string;
  company_id: string;
  name: string;
  cuisine_type?: string;
  created_at: string;
  updated_at: string;
}

export interface RestaurantLocation {
  id: string;
  brand_id: string;
  company_id: string;
  name: string;
  address?: string;
  city?: string;
  country?: string;
  currency: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// --- Suppliers ---

export interface Supplier {
  id: string;
  company_id: string;
  name: string;
  contact_email?: string;
  contact_phone?: string;
  categories: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SupplierInvoice {
  id: string;
  company_id: string;
  location_id: string;
  supplier_id: string;
  invoice_number?: string;
  invoice_date: string; // ISO date, e.g. "2025-05-18" — used as authoritative cost date
  due_date?: string;
  total_amount: number;
  currency: string;
  status: "draft" | "received" | "paid" | "overdue";
  created_at: string;
  updated_at: string;
}

export interface SupplierInvoiceLine {
  id: string;
  invoice_id: string; // join to SupplierInvoice for the authoritative date
  ingredient_id: string;
  description: string;
  quantity: number;
  unit: UnitOfMeasure; // unit for this purchase (may differ from recipe unit)
  unit_price: number; // price per `unit`
  total_price: number;
}

// --- Ingredients ---

export interface Ingredient {
  id: string;
  company_id: string;
  name: string;
  category: string;
  default_unit: UnitOfMeasure;
  current_unit_cost: number; // fallback when no invoice line is available
  currency: string;
  supplier_id?: string;
  created_at: string;
  updated_at: string;
}

// --- Menu Items & Recipes ---

export interface MenuItem {
  id: string;
  brand_id: string;
  company_id: string;
  name: string;
  category: string;
  selling_price: number;
  currency: string;
  status: MenuItemStatus;
  created_at: string;
  updated_at: string;
}

export interface Recipe {
  id: string;
  menu_item_id: string;
  company_id: string;
  version: number;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface RecipeIngredient {
  id: string;
  recipe_id: string;
  ingredient_id: string;
  quantity: number;
  unit: UnitOfMeasure; // the unit in which quantity is expressed
  waste_factor: number; // 0–1, e.g. 0.05 = 5% waste
}

// --- Menu & Recipes foundation (migration 004) ---

export type ComponentStatus = "draft" | "active" | "archived";
export type RecipeStatus = "draft" | "active" | "archived";
export type RecipeInputType = "ingredient" | "component";
export type POSMatchType = "manual" | "suggested" | "auto";

/**
 * A prepared component is a sub-product made in-house (smoked brisket,
 * coleslaw batch, BBQ sauce). It can be an input to menu items AND/OR to
 * other prepared components — the recursive case lets us model
 * raw → component → component → menu_item chains.
 */
export interface PreparedComponent {
  id: string;
  company_id: string;
  name: string;
  category?: string;
  output_unit: string;
  status: ComponentStatus;
  notes?: string;
  created_at: string;
  updated_at: string;
}

/** Recipe describing how to produce one batch of a prepared component. */
export interface ComponentRecipe {
  id: string;
  company_id: string;
  component_id: string;
  name: string;
  output_quantity: number;
  output_unit: string;
  /** Optional shrinkage factor 0–100. e.g. 65 means 65 % usable yield. */
  yield_percentage: number | null;
  status: RecipeStatus;
  created_at: string;
  updated_at: string;
}

/**
 * Inputs for a component recipe. XOR enforced in SQL: exactly one of
 * ingredient_id / component_id is non-null.
 */
export interface ComponentRecipeInput {
  id: string;
  company_id: string;
  component_recipe_id: string;
  input_type: RecipeInputType;
  ingredient_id: string | null;
  component_id: string | null;
  quantity: number;
  unit: string;
  notes?: string;
  created_at: string;
}

/**
 * Inputs for a MENU ITEM recipe. New table — the legacy
 * recipe_ingredients table is kept untouched for backward compat.
 */
export interface MenuRecipeInput {
  id: string;
  company_id: string;
  recipe_id: string;
  input_type: RecipeInputType;
  ingredient_id: string | null;
  component_id: string | null;
  quantity: number;
  unit: string;
  notes?: string;
  created_at: string;
}

/** Canonical mapping from raw POS item name → menu_items.id. */
export interface POSItemMapping {
  id: string;
  company_id: string;
  raw_pos_item_name: string;
  menu_item_id: string;
  match_type: POSMatchType;
  confidence: number | null;
  created_at: string;
  updated_at: string;
}

/** Many-to-many supplier↔ingredient with per-relationship metadata. */
export interface SupplierIngredient {
  id: string;
  company_id: string;
  supplier_id: string;
  ingredient_id: string;
  supplier_item_name?: string;
  supplier_sku?: string;
  preferred: boolean;
  created_at: string;
  updated_at: string;
}

// --- POS Sales ---

export interface POSSalesItem {
  id: string;
  company_id: string;
  location_id: string;
  menu_item_id: string;
  // Unique guest check / order identifier.
  // Present for granular POS exports; absent for daily-summary imports.
  // calculateRestaurantOverview uses this to count distinct orders.
  check_id?: string;
  sale_date: string;
  quantity: number; // units sold (dishes, drinks, etc.)
  unit_price: number;
  total_revenue: number;
  currency: string;
  channel?: "dine_in" | "takeaway" | "delivery" | "online";
}

// --- KPIs ---

export interface RestaurantKPI {
  id: string;
  company_id: string;
  location_id: string;
  period: string; // "YYYY-MM"
  total_revenue: number;
  total_orders: number; // unique check_ids (or row count for summary imports)
  total_units_sold: number; // sum of quantities
  total_covers?: number;
  food_cost_amount: number;
  food_cost_pct: number;
  gross_margin_amount: number;
  gross_margin_pct: number;
  avg_ticket: number;
  currency: string;
  calculated_at: string;
}

// --- Recommendations & Agent Framework ---

export interface RestaurantRecommendation {
  id: string;
  company_id: string;
  location_id?: string;
  agent_run_id?: string;
  severity: RecommendationSeverity;
  status: RecommendationStatus;
  title: string;
  body: string;
  action_label?: string;
  action_url?: string;
  related_entity_type?: "menu_item" | "ingredient" | "supplier" | "location";
  related_entity_id?: string;
  created_at: string;
  updated_at: string;
}

// AgentDefinition is a global template shared across all tenants.
// It describes what an agent does and how it can be triggered.
// No company_id — use AgentConfig for per-tenant enablement.
export interface AgentDefinition {
  id: string;
  key: string;
  name: string;
  description: string;
  trigger: "manual" | "scheduled" | "event";
  schedule_cron?: string;
  input_schema?: Record<string, unknown>;
}

// AgentConfig is a per-tenant activation record for an AgentDefinition.
// A tenant can override the schedule or disable an agent here.
export interface AgentConfig {
  id: string;
  company_id: string;
  agent_definition_id: string;
  is_active: boolean;
  schedule_override?: string;
  created_at: string;
  updated_at: string;
}

export interface AgentRun {
  id: string;
  company_id: string;
  agent_definition_id: string;
  status: AgentRunStatus;
  triggered_by: "user" | "schedule" | "event";
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error_message?: string;
  started_at?: string;
  completed_at?: string;
  created_at: string;
}

// --- Computed / Derived (not persisted) ---

// Result of ingredient-level cost calculation for a single menu item.
// cost is null whenever status is not "complete".
export interface MenuItemCostResult {
  cost: number | null;
  status: MenuItemCostStatus;
  missingItems?: string[]; // ingredient names that could not be costed
}

// All margin fields are null when cost is unknown to prevent false 100% margin entries.
export interface MenuItemMargin {
  menu_item_id: string;
  name: string;
  selling_price: number;
  cost_result: MenuItemCostResult;
  calculated_cost: number | null;
  gross_margin_amount: number | null;
  gross_margin_pct: number | null;
  food_cost_pct: number | null;
}

export interface RestaurantOverview {
  total_revenue: number;
  // Unique guest checks when check_id is present; otherwise unique sale rows.
  total_orders: number;
  // Sum of all item quantities across sales items (distinct from total_orders).
  total_units_sold: number;
  food_cost_amount: number;
  food_cost_pct: number;
  gross_margin_amount: number;
  gross_margin_pct: number;
  avg_ticket: number;
  currency: string;
}
