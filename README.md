# Milton — AI-Powered KPI Dashboard for SMBs

Milton is a web application that helps small and medium businesses understand their performance through automated data analysis and KPI dashboards. Users upload their existing business data files (Excel/CSV), and the app uses AI to classify and map that data, calculate relevant KPIs, and generate insights — without requiring any technical knowledge.

---

## Table of Contents

- [Product Overview](#product-overview)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Architecture Overview](#architecture-overview)
- [User Flows](#user-flows)
- [Codebase Structure](#codebase-structure)
- [Database Schema](#database-schema)
- [Business Model System](#business-model-system)
- [KPI System](#kpi-system)
- [AI Integration](#ai-integration)
- [Authentication & Permissions](#authentication--permissions)
- [API Reference](#api-reference)
- [Testing](#testing)

---

## Product Overview

**Target users:** Startup founders, SMB owners/operators (no technical background required)

**Core value:** Upload your business data (bookings, orders, transactions, memberships) → get automatic KPI dashboards and AI-generated insights.

**Supported business types:**

- Fitness Studio / Gym / Yoga Studio
- Restaurant / Cafe
- E-commerce
- (Partial / legacy: SaaS, Agency)

**Key capabilities:**

- AI-driven business type detection (from conversation or file contents)
- AI-powered column mapping — automatically maps CSV/Excel columns to data fields
- Automatic KPI calculation from uploaded data
- AI-generated insights and anomaly detection
- PDF report generation
- Visual data model builder (for understanding table relationships)

---

## Tech Stack

| Layer                     | Technology                                                  |
| ------------------------- | ----------------------------------------------------------- |
| **Framework**             | Next.js 16 (App Router, TypeScript)                         |
| **UI**                    | React 19, Tailwind CSS 4, Radix UI, Shadcn/ui, Lucide icons |
| **Database & Auth**       | Supabase (PostgreSQL + Row Level Security)                  |
| **AI**                    | Vercel AI SDK + OpenAI API (gpt-4o-mini)                    |
| **Charts**                | Recharts                                                    |
| **Data Model Visualizer** | React Flow                                                  |
| **File Parsing**          | xlsx (Excel), PapaParse (CSV)                               |
| **PDF Generation**        | jsPDF + html2canvas                                         |
| **Form Handling**         | React Hook Form + Zod                                       |
| **Testing**               | Vitest (unit), Playwright (E2E)                             |

---

## Getting Started

### Prerequisites

- Node.js v24+
- A Supabase project
- An OpenAI API key

### Installation

```bash
git clone <repo-url>
cd milton
npm install
```

### Environment Variables

Create a `.env.local` file:

```env
# OpenAI
OPENAI_API_KEY=your-openai-api-key

# Supabase (public — safe in browser)
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Supabase (secret — server-side only, bypasses RLS)
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

**Where to find Supabase keys:** Dashboard → Settings → API

### Run

```bash
npm run dev      # development server at http://localhost:3000
npm run build    # production build
npm run test     # run unit tests
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Next.js App Router                        │
│                                                                   │
│  Pages (app/)          API Routes (app/api/)                     │
│  ├── /auth             ├── /auth/signup-complete                 │
│  ├── /onboarding       ├── /ai/*  (classify, analyze, insights)  │
│  ├── /dashboard        ├── /data/* (parse, upload, status)       │
│  ├── /management       ├── /kpis/* (calculate, select)          │
│  └── /                 └── /analytics/* (per business type)      │
└───────────────────────────────┬─────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
   Supabase                 OpenAI API            Client Browser
   (Auth + DB)           (gpt-4o-mini)          (React components)
```

### Core Data Flow

```
User upload (CSV/Excel)
  │
  ▼
/api/data/parse          — Extract sheets, headers, sample rows
  │
  ▼
/api/ai/dataset-classifier — Identify which business table this file maps to
  │
  ▼
Data Mapping UI          — User confirms/adjusts column → field mappings
  │
  ▼
Value Normalization      — Case-correct categories, normalize dates
  │
  ▼
/api/data/upload-model-table — Insert rows into model_data table (JSONB)
  │
  ▼
/api/kpis/calculate      — Query model_data, aggregate, return KPI values
  │
  ▼
Dashboard                — Display KPI cards, charts, AI insights
```

---

## User Flows

### 1. Onboarding (First-Time User)

1. **Sign up** — Email/password registration; Supabase creates `auth.users`, app creates `profiles` and `companies` records
2. **Chat** (`/onboarding/chat`) — Describe your business in natural language; AI identifies business type (fitness_studio, restaurant, ecommerce, etc.)
3. **Data Sources** (`/onboarding/data-sources`) — Select which data sources you have (bookings, transactions, orders, etc.)
4. **Upload** (`/onboarding/upload`) — Upload Excel or CSV files; AI classifies each sheet to a canonical table
5. **Map & Normalize** — Confirm column-to-field mappings per table; review value normalization
6. **KPI Selection** (`/onboarding/kpi-selection`) — Choose and rank which KPIs to track
7. **Dashboard** — Redirect to `/dashboard` with KPIs populated

### 2. Dashboard Usage

- View KPI cards with current values and trend indicators
- Drill into analytics by business area (members, revenue, classes, etc.)
- Upload additional data files at any time
- Generate and export PDF reports with AI-written insights
- Adjust KPI selection and date ranges

### 3. Admin Operations

Accessible at `/management/` (requires admin role):

- **KPIs** — Create/edit KPI definitions, link to business types, publish/unpublish
- **Templates** — Manage business model templates (required tables, relationships, KPI lists)
- **Data Tables** — Define canonical table schemas (fields, types, relationships)

---

## Codebase Structure

```
milton/
├── app/                          # Next.js App Router
│   ├── (root)/page.tsx           # Landing page
│   ├── auth/                     # Login, signup, OAuth callback
│   ├── onboarding/               # 6-step onboarding flow
│   │   ├── chat/                 # AI business model chat
│   │   ├── data-sources/         # Source selection
│   │   ├── upload/               # File upload step
│   │   ├── model/                # Data model viewer
│   │   └── kpi-selection/        # KPI selection step
│   ├── dashboard/                # Main app
│   │   ├── page.tsx              # KPI dashboard home
│   │   ├── analytics/            # Analytics & drill-downs
│   │   ├── data/                 # Data management
│   │   ├── upload/               # Additional uploads
│   │   ├── reporting/            # PDF report generation
│   │   ├── account/              # User account
│   │   └── settings/             # Dashboard settings
│   ├── management/               # Admin panel
│   │   ├── dashboard/            # Admin overview
│   │   ├── kpis/                 # KPI CRUD
│   │   ├── templates/            # Template CRUD
│   │   └── data-tables/          # Data table CRUD
│   └── api/                      # API routes (see API Reference)
│
├── components/
│   ├── dashboard/                # Dashboard & upload UI components
│   ├── onboarding/               # Onboarding wizard components
│   ├── management/               # Admin panel components
│   ├── layout/                   # Navigation, providers, theme
│   ├── auth/                     # Login/signup forms
│   ├── ai-elements/              # Chat UI components
│   └── ui/                       # Shadcn/Radix primitives
│
├── lib/
│   ├── model/
│   │   ├── transform.ts          # Core model types (TableDef, ModelProposal, etc.) + graph logic
│   │   └── default-models.ts     # Hardcoded fallback models (fitness, restaurant, ecom)
│   ├── kpi-calculations/         # One file per KPI calculator function
│   │   ├── fitness/              # Fitness studio KPIs
│   │   ├── restaurant/           # Restaurant KPIs
│   │   ├── ecom/                 # E-commerce KPIs
│   │   ├── financial/            # Cross-sector financial KPIs
│   │   ├── fieldAccessors.ts     # Flexible field reading from JSONB rows
│   │   └── index.ts              # Exports all calculators
│   ├── ai/                       # AI helper modules
│   │   ├── dashboard-context.ts  # Build AI context from KPI data
│   │   ├── normalize-values.ts   # AI value normalization
│   │   ├── generate-ids.ts       # AI-generated IDs for table rows
│   │   ├── insights.ts           # Generic insight framework
│   │   ├── fitness-studio-insights.ts
│   │   └── restaurant-insights.ts
│   ├── types/
│   │   ├── data.ts               # Shared data types (DataTable, TransactionData, etc.)
│   │   ├── kpi.ts                # KPI types and selectors
│   │   ├── pipeline.ts           # CRM/pipeline types
│   │   └── report.ts             # Report data structures
│   ├── supabase/
│   │   ├── client.ts             # Browser Supabase client
│   │   └── server.ts             # Server-side Supabase client (service role)
│   ├── data-table-service.ts     # Data table CRUD (Supabase)
│   ├── business-models.ts        # BusinessModel record CRUD
│   ├── dashboard-kpis.ts         # KPI routing by business type
│   ├── kpi-recipe-service.ts     # Map KPI IDs → calculator functions
│   ├── kpi-availability.ts       # Which KPIs are available
│   ├── report-data-service.ts    # Gather data for PDF reports
│   └── utils.ts                  # cn(), normalizeDateValue(), etc.
│
├── types/
│   └── schema.ts                 # ColumnMapping and other shared types
│
├── supabase/                     # DB migrations
├── test-data/                    # Sample data files for testing
└── tests/                        # Test suites
    ├── unit/                     # Vitest unit tests
    └── smoke/                    # Playwright E2E tests
```

---

## Database Schema

### Core Tables

| Table                      | Purpose                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| `auth.users`               | Supabase-managed authentication                                                              |
| `profiles`                 | User profile; stores `role` ("user" or "admin")                                              |
| `companies`                | Tenant record; linked to creator user                                                        |
| `business_models`          | Per-company business type, KPI selections, canonical data model, onboarding answers          |
| `data_tables`              | Admin-defined canonical table schemas (`fields` as JSONB array)                              |
| `model_data`               | All uploaded business data — rows stored as JSONB, scoped to `company_id` + `model_table_id` |
| `kpis`                     | KPI definitions (name, formula reference, business_types, is_published)                      |
| `business_model_templates` | Templates per business type (required tables, relationships, KPI lists)                      |
| `custom_datasets`          | Metadata about uploaded files (schema, source info)                                          |
| `dashboard_insights`       | Cached AI-generated insight text                                                             |

### Key Relationships

```
auth.users
  └── profiles (one-to-one)
  └── companies (one-to-many via created_by)
        └── business_models (one-to-one)
        └── model_data (one-to-many) ← all uploaded rows live here
              └── data_tables (many-to-one via model_table_id)
```

### model_data Structure

This is the central storage table for all uploaded business data:

```sql
model_data (
  id             uuid PRIMARY KEY,
  company_id     uuid REFERENCES companies(id),
  model_table_id uuid REFERENCES data_tables(id),
  data           jsonb,            -- the actual row data
  indexed_fields jsonb,            -- extracted fields for faster querying
  created_at     timestamptz
)
```

All KPI calculations query this table, filtering by `company_id` and `model_table_id`, then reading the flexible `data` JSONB column.

### Row Level Security

- Users can only read/write rows where `company_id` matches their company
- Admin-only tables (kpis, data_tables, templates) have admin-role policies
- Server-side operations using the service role key bypass RLS where needed

---

## Business Model System

The "business model" represents a company's canonical data structure — which tables they use, what relationships exist, and what KPIs are relevant.

### How it Works

1. **Templates** (admin-defined, in Supabase) — define which tables, relationships, and KPIs belong to each business type
2. **Default Models** (hardcoded in `lib/model/default-models.ts`) — fallback definitions used during onboarding when no Supabase template is available
3. **Canonical Model** (user-specific, stored in `business_models.canonical_model` as JSONB) — the actual model applied to a company, derived from the template + any user customizations

### TableDef and ModelProposal

The core types in `lib/model/transform.ts`:

```typescript
interface FieldDef {
  name: string;
  type: "string" | "number" | "integer" | "date" | "currency" | "boolean";
  required: boolean;
  primaryKey?: boolean;
  references?: { table: string; field?: string } | null;
  allowedValues?: string[]; // For enum/categorical fields
  displayName?: string; // Human-readable label (e.g., "Order Items" vs "ecom_order_items")
}

interface TableDef {
  name: string; // Internal name used in DB (e.g., "ecom_orders")
  displayName?: string; // User-facing label (e.g., "Orders")
  fields: FieldDef[];
  fileMapping?: { fileName?: string; columnMap?: Record<string, string> };
}

interface ModelProposal {
  businessType: string;
  recommendedTables: TableDef[];
  relationships: RelationshipDef[];
}
```

### Supported Business Types

| Key              | Display Name   | Tables                                                    |
| ---------------- | -------------- | --------------------------------------------------------- |
| `fitness_studio` | Fitness Studio | Customers, Classes, Instructors, Bookings, Payments       |
| `restaurant`     | Restaurant     | Tables, Menu Items, Orders, Order Items, Reservations     |
| `ecommerce`      | E-commerce     | Orders, Order Items, Products, Customers, Marketing Spend |

---

## KPI System

### KPI Definition

KPIs are stored in the `kpis` Supabase table. Each KPI has:

- `name` — display name
- `definition` — description
- `formula` — optional formula string (documentation)
- `required_data` — array of `data_tables.id` UUIDs the KPI needs
- `business_types` — which business types this KPI applies to
- `is_published` — whether visible to users (drafts hidden)

### KPI Calculators

Each KPI has a dedicated TypeScript function in `lib/kpi-calculations/`:

```typescript
// Common signature
async function calculateXxx(
  supabase: SupabaseClient,
  userId: string,
  fromDate: string,
  toDate: string
): Promise<{
  currentValue: number;
  historicalData: Array<{ period: string; value: number }>;
}>;
```

**Fitness Studio KPIs:**

- Active Members, Monthly Churn Rate, Churned Members, New Members
- Revenue Per Member, Revenue Per Class, Average Member Tenure
- Total Classes Held, Average Class Size, Class Attendance Rate
- Average Class Occupancy, Utilization Rate
- No Show Rate, Cancellation Rate

**Financial KPIs (cross-sector):**

- Burn Rate, Net Income, Net Cash Flow, Runway, Revenue Growth Rate

**Restaurant KPIs:**

- Total Revenue, Covers, Average Ticket Size, Prime Cost %

**E-commerce KPIs:**

- True CAC, CAC Payback Period, Marketing Efficiency Ratio
- Contribution Margin After Marketing
- Product Profitability Leaderboard, Growth Quality Score

### KPI Availability

When a user opens the KPI selector, the app:

1. Fetches `GET /api/data/status` → gets which `data_tables` have uploaded data (by UUID)
2. For each KPI, checks if all `required_data` UUIDs have data
3. If any required table is missing, the KPI is locked (greyed out, cannot select)
4. Name-based fallback matching handles cases where UUIDs differ between environments

### KPI Display

Selected KPIs appear on the dashboard as:

- **Cards** — current value with trend indicator (vs previous period)
- **Charts** — historical time series (line/bar/area via Recharts)
- Both modes can be selected per KPI

---

## AI Integration

The app uses two OpenAI integration patterns:

### 1. Vercel AI SDK (Streaming)

Used for conversational interfaces:

- Onboarding chat (`/app/onboarding/chat`)
- Dashboard AI insights
- Milton chat sidebar

### 2. Direct OpenAI API Calls

Used for one-shot classification/analysis tasks:

- Dataset classification (`/api/ai/dataset-classifier`) — which business table does a file map to?
- Business model analysis (`/api/ai/business-model-analyzer`) — what type of business is this?
- Value normalization (`/api/data/normalize-values`) — correct inconsistent categorical values
- ID generation (`lib/ai/generate-ids.ts`) — human-readable IDs for uploaded rows
- Insight generation (various AI modules in `lib/ai/`)

### Model Used

All AI calls use `gpt-4o-mini` for cost efficiency. The model is not configurable per-call; it is set globally in each AI helper.

---

## Authentication & Permissions

### Flow

1. User signs up at `/auth/signup`
2. Supabase creates `auth.users`
3. `POST /api/auth/signup-complete` creates `profiles` (role = "user") and `companies` records
4. Session stored via Supabase SSR (HTTP-only cookies)

### Roles

| Role    | Access                                                   |
| ------- | -------------------------------------------------------- |
| `user`  | Own company data only; dashboard, uploads, KPI selection |
| `admin` | All management routes; KPI/template/table CRUD           |

Admin role is stored in `profiles.role`. Checked server-side via `isUserAdmin(userId)` in `lib/profile-service.ts`.

### Supabase Clients

- `lib/supabase/client.ts` — browser client (anon key, subject to RLS)
- `lib/supabase/server.ts` — server client (service role key, bypasses RLS)

---

## API Reference

### Data Management

| Method | Endpoint                       | Description                                                     |
| ------ | ------------------------------ | --------------------------------------------------------------- |
| POST   | `/api/data/parse`              | Parse Excel/CSV; returns sheets, headers, sample rows, all rows |
| POST   | `/api/data/upload-model-table` | Insert mapped rows into `model_data` table                      |
| DELETE | `/api/data/delete-model-table` | Remove data for a specific table                                |
| GET    | `/api/data/status`             | Which data tables have uploaded data (with row counts)          |
| GET    | `/api/data/table-names`        | Resolve table UUIDs to names                                    |
| GET    | `/api/data/table-preview`      | Preview first N rows of a table                                 |
| POST   | `/api/data/normalize-values`   | AI-normalize categorical field values                           |

### KPI Endpoints

| Method | Endpoint              | Description                                   |
| ------ | --------------------- | --------------------------------------------- |
| POST   | `/api/kpis/calculate` | Calculate all selected KPIs for a date range  |
| POST   | `/api/kpis/series`    | Get historical time series for a KPI          |
| GET    | `/api/kpis/selected`  | Get user's selected KPI IDs and display modes |
| POST   | `/api/kpis/select`    | Save KPI selection                            |

### AI Endpoints

| Method | Endpoint                          | Description                                    |
| ------ | --------------------------------- | ---------------------------------------------- |
| POST   | `/api/ai/business-model-analyzer` | Classify business type from description        |
| POST   | `/api/ai/dataset-classifier`      | Classify uploaded dataset to a canonical table |
| POST   | `/api/ai/onboarding`              | Stream onboarding chat responses               |
| POST   | `/api/ai/insight-generator`       | Generate AI insights from KPI data             |
| POST   | `/api/milton/ask`                 | Dashboard chat assistant                       |

### Analytics (per business type)

| Endpoint                                  | Business Type | Returns                                          |
| ----------------------------------------- | ------------- | ------------------------------------------------ |
| `GET /api/analytics/fitness-studio/kpis`  | Fitness       | All fitness KPI values                           |
| `GET /api/analytics/ecommerce/kpis`       | E-commerce    | All ecom KPI values                              |
| `GET /api/analytics/restaurant/overview`  | Restaurant    | Revenue, covers, etc.                            |
| Various `/api/analytics/fitness-studio/*` | Fitness       | Members, instructors, classes, cash flow, charts |

### Admin Endpoints (admin role required)

| Method         | Endpoint                             | Description                          |
| -------------- | ------------------------------------ | ------------------------------------ |
| GET/POST       | `/api/admin/kpis`                    | List / create KPIs                   |
| PUT/DELETE     | `/api/admin/kpis/[id]`               | Update / delete KPI                  |
| GET            | `/api/admin/kpis/impact/[id]`        | Impact analysis before delete        |
| GET/POST       | `/api/admin/templates`               | List / create templates              |
| GET/PUT/DELETE | `/api/admin/templates/[key]`         | Manage specific template             |
| GET/POST       | `/api/admin/data-tables`             | List / create data table definitions |
| PUT/DELETE     | `/api/admin/data-tables/[id]`        | Update / delete data table           |
| GET            | `/api/admin/data-tables/impact/[id]` | Impact analysis before delete        |

---

## Testing

### Unit Tests (Vitest)

```bash
npm run test:unit        # run once
npm run test:unit:watch  # watch mode
```

Located in `tests/unit/`. Cover:

- All KPI calculator functions with mocked Supabase responses
- KPI time series calculations

### E2E Tests (Playwright)

```bash
npx playwright test      # run all E2E tests
```

Located in `tests/smoke/`. Cover:

- Landing page load
- Auth flows (login, signup)
- Dashboard basic functionality

### Test Data

Sample data files for manual testing are in `test-data/` organized by business type (e.g., `test-data/restaurant/`).

---

## Key Files Quick Reference

| File                                                 | Purpose                                                                 |
| ---------------------------------------------------- | ----------------------------------------------------------------------- |
| `lib/model/transform.ts`                             | Core data model types and transformation logic                          |
| `lib/model/default-models.ts`                        | Hardcoded fallback business models                                      |
| `lib/kpi-calculations/fieldAccessors.ts`             | Flexible field reading from JSONB rows                                  |
| `lib/kpi-calculations/index.ts`                      | Exports all KPI calculator functions                                    |
| `lib/utils.ts`                                       | `normalizeDateValue()`, `cn()`, shared utilities                        |
| `lib/data-table-service.ts`                          | Read data table definitions from Supabase                               |
| `lib/dashboard-kpis.ts`                              | Routes KPI calculation requests by business type                        |
| `lib/kpi-recipe-service.ts`                          | Maps KPI IDs to calculator functions                                    |
| `app/api/data/upload-model-table/route.ts`           | Central upload handler with ID generation, FK resolution, normalization |
| `app/api/data/parse/route.ts`                        | File parsing endpoint (Excel/CSV → rows)                                |
| `components/dashboard/ModelTableDetailView.tsx`      | Single-table upload + mapping UI                                        |
| `components/dashboard/MultiFileUploadView.tsx`       | Multi-file drag-drop upload flow                                        |
| `components/dashboard/data-mapping-confirmation.tsx` | Column mapping modal                                                    |
| `components/dashboard/kpi-selector.tsx`              | KPI selection dialog                                                    |
