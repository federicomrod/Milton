# R1-17b — Ventas › Detalle redesign

Spec: Sofia's `review.md` + mocks 1, 2, 4 (3 is Turnos, PR A). Stacked on R1-17a (shifts + business day, migration 054).

## Roles
The Cockpit is the summary ("how am I doing"). **Ventas › Detalle explores and compares** ("why, when, where"). Nothing is repeated between them in the same form.

## One request, everything in the browser
`GET /api/restaurant/sales-detail?location_id=` returns the **cube**: one row per (business date, hour, restaurant, channel, payment, category, shift, order) plus the goals and the restaurants. After that, every filter, comparison, tab and click is computed in the browser (`lib/restaurant/sales-detail.ts`): no per-control round trip, no reload (a full recompute with filters and a comparison on 100k rows takes ~5 ms). The whole state is in the URL (`tab, dim, vista, p, desde, hasta, cmp, canal, pago, cat, turno, dia, hora, graf, mapa, cruzar`).

- **Tickets** are DISTINCT orders (an order with two categories is one ticket). Tips are never sales, units or tickets.
- **Business day** and **shifts** come from R1-17a (cutoff per restaurant; shift = clock time on the business weekday; «Otro horario» only when > 0).
- **Δ** = (actual − anterior) ÷ anterior. No comparable period (the data does not reach back, base 0) is «—», never 0%. Trailing averages (6/12 months) are cut to where the data starts and scaled to the days of the period.
- **Goals** (Objetivos): a line and chips only if they exist and no dimension filter is active (a sales goal is for the whole business). No goal = no line, no chip, never 0.
- The cube holds the last 460 business days (a 90-day period + a 12-month comparison); the period is clipped to it and the page says so.

## Page
Filter bar (sticky, independent): Período (7 d / 30 d / 90 d / Personalizado) · Comparar con (período anterior, semana anterior, mismo período año pasado, promedio 6/12 meses) · Canal · Pago · Categoría · Turno (only with ≥ 2 active shifts). Filters with no control (Día, Hora from the heatmap; a single day from the chart) get a chip with ✕.

- **Tendencia**: 5 KPI cards (Ventas netas ⓘ with net/descuento/bruto/propinas, Tickets, Ticket promedio, Unidades, Mejor día), «Ventas por día» (bars < 8 days, straight line beyond, dashed daily goal, Ventas/Tickets), one card per shift, «Hora × día» (Ventas/Tickets/Ticket prom., «Cruzar con» Canal/Pago/Categoría).
- **Desglose**: Categoría / Canal / Pago / Turno × ▦ Tarjetas (default) / ☰ Tabla (+ $/unid., sortable); same rows. Click filters the page; ⌘/Ctrl/Shift adds; summary chip with sum and share and ✕; double-click or «Ver platos» opens Platos.
- **Platos**: not a new drill-down. The list is the menu dishes of the page's period and restaurant (the same economics as Menú › Platos); a click opens the existing «Plato del menú» Desglose (read-only here). Period, restaurant and Categoría narrow it; Canal / Pago / Turno cannot (dish costing is by period and restaurant) and the tab says so.

## Removed
Targets tab and "Edit targets" (now a link to Configuración › Objetivos), the "AI recommendations are not active yet" card, both mix-over-time charts, "Más hallazgos" (→ the Mejor día KPI), "More filters", the orange "¿Qué más debo revisar…?" link, the old English explorer (`RestaurantSalesExplorer`, `DeferredSalesExplorer`, `SalesInvestigateFacts`). One «Preguntar a Milton» (the header's). Channel names: Eat In → Comer aquí, To Go → Para llevar, no channel → Sin canal; Odoo category/payment names stay as they are.
