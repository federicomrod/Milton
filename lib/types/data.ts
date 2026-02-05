// Data Tables - Centralized table definitions
export interface DataTableField {
  name: string;
  type: string;
  required: boolean;
  primaryKey?: boolean;
  references?: { table: string; field?: string };
  defaultValue?: unknown;
}

export interface DataTable {
  id: string;
  slug: string;
  name: string;
  description?: string;
  fields: DataTableField[];
  created_at: string;
  updated_at: string;
}

// Data Table Relationships
export interface DataTableRelationship {
  from_table: string;
  from_field: string;
  to_table: string;
  to_field: string;
  relationship_id: string;
  relationship_type:
    | "one_to_one"
    | "one_to_many"
    | "many_to_one"
    | "many_to_many";
}

// User Roles
export type UserRole = "user" | "admin";
