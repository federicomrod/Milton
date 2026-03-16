/**
 * Field accessors for E-Commerce data tables using exact column names from data_tables.
 * Also tries case-insensitive and common variants so imports with different key casing still work.
 */

function readField(record: any, ...keys: string[]): any {
  for (const key of keys) {
    const v = record?.[key];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  // Case-insensitive match (CSV/import may normalize keys)
  if (record && typeof record === "object") {
    const keyList = keys.map((k) => k.toLowerCase());
    for (const k of Object.keys(record)) {
      if (keyList.includes(k.toLowerCase())) {
        const v = record[k];
        if (v !== undefined && v !== null && v !== "") return v;
      }
    }
  }
  return undefined;
}

/** Get numeric value from record by trying exact keys then any key containing given substrings. */
function readNumByKeys(record: any, ...keyVariants: string[]): number {
  const v = readField(record, ...keyVariants);
  return parseNum(v);
}

/** Get value for a key that might be stored with different names (e.g. "Total Revenue" / "total_revenue"). */
function readFieldFlexible(
  record: any,
  preferred: string,
  ...fallbacks: string[]
): any {
  const v = readField(record, preferred, ...fallbacks);
  if (v !== undefined && v !== null && v !== "") return v;
  if (!record || typeof record !== "object") return undefined;
  const lower = preferred.toLowerCase().replace(/\s+/g, " ");
  for (const k of Object.keys(record)) {
    if (k.toLowerCase().replace(/\s+/g, " ") === lower) return record[k];
  }
  for (const sub of [preferred, ...fallbacks].map((s) => s.toLowerCase())) {
    for (const k of Object.keys(record)) {
      if (k.toLowerCase().includes(sub) || sub.includes(k.toLowerCase())) {
        const val = record[k];
        if (val !== undefined && val !== null && val !== "") return val;
      }
    }
  }
  return undefined;
}

function parseNum(val: any): number {
  if (val == null) return 0;
  if (typeof val === "number" && !Number.isNaN(val)) return val;
  const s = String(val)
    .trim()
    .replace(/[$€£,\s]/g, "");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

export function parseFlexibleDate(value: any): Date | null {
  if (value == null || value === "") return null;
  const str = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [y, m, d] = str.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return isNaN(dt.getTime()) ? null : dt;
  }
  if (/^\d{4}-\d{2}-\d{2}[T ]/.test(str)) {
    const dt = new Date(str.replace(" ", "T"));
    return isNaN(dt.getTime()) ? null : dt;
  }
  const mdy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (mdy) {
    const month = parseInt(mdy[1], 10) - 1;
    const day = parseInt(mdy[2], 10);
    const yRaw = parseInt(mdy[3], 10);
    const year = yRaw < 100 ? 2000 + yRaw : yRaw;
    const dt = new Date(year, month, day);
    return isNaN(dt.getTime()) ? null : dt;
  }
  return null;
}

export function toPeriod(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** E-Com Customers: ID, First Order Date, Acquisition Channel, E-Mail, ... */
export const ecomCustomerAcc = {
  id: (r: any) => readField(r, "ID") ?? "",
  firstOrderDate: (r: any) =>
    parseFlexibleDate(readField(r, "First Order Date")),
};

/** E-Com Orders: ID, Order Date, Customer ID, Total Revenue, Discount, ... */
export const ecomOrderAcc = {
  id: (r: any) => readField(r, "ID", "id") ?? "",
  orderDate: (r: any) =>
    parseFlexibleDate(
      readFieldFlexible(r, "Order Date", "Date", "order_date", "OrderDate")
    ),
  customerId: (r: any) =>
    readField(r, "Customer ID", "Customer Id", "customer_id") ?? "",
  totalRevenue: (r: any) =>
    readNumByKeys(
      r,
      "Total Revenue",
      "Total revenue",
      "total_revenue",
      "Revenue",
      "Total",
      "Total Amount",
      "total"
    ),
  discount: (r: any) => readNumByKeys(r, "Discount", "discount"),
  shippingRevenue: (r: any) =>
    readNumByKeys(r, "Shipping Revenue", "Shipping", "shipping_revenue"),
};

/** E-Com Order Items: ID, Order ID, Product ID, Quantity, Price, Cost, ... */
export const ecomOrderItemAcc = {
  orderId: (r: any) => readField(r, "Order ID", "Order Id", "order_id") ?? "",
  productId: (r: any) =>
    readField(r, "Product ID", "Product Id", "product_id") ?? "",
  quantity: (r: any) => readNumByKeys(r, "Quantity", "quantity", "Qty", "qty"),
  price: (r: any) => readNumByKeys(r, "Price", "price", "Unit Price"),
  cost: (r: any) =>
    readNumByKeys(r, "Cost", "cost", "Unit Cost", "unit_cost", "COGS"),
};

/** E-Com Marketing Spend: ID, Date, Channel, Campaign, Spend, Clicks, Impressions */
export const ecomMarketingAcc = {
  date: (r: any) =>
    parseFlexibleDate(
      readFieldFlexible(r, "Date", "date", "Spend Date", "spend_date")
    ),
  spend: (r: any) =>
    readNumByKeys(r, "Spend", "spend", "Amount", "amount", "Cost"),
};

/** E-Com Products: ID, Name, Category, Unit Cost, Price, Sub-Category, Status */
export const ecomProductAcc = {
  id: (r: any) => readField(r, "ID") ?? "",
  unitCost: (r: any) => parseNum(readField(r, "Unit Cost")),
  price: (r: any) => parseNum(readField(r, "Price")),
};

/** Transactions: ID, Counterparty ID, Date, Amount, Direction (inflow / outflow), ... */
export const ecomTransactionAcc = {
  date: (r: any) => parseFlexibleDate(readField(r, "Date")),
  amount: (r: any) => parseNum(readField(r, "Amount")),
  direction: (r: any) =>
    (readField(r, "Direction (inflow / outflow)") ?? "").toLowerCase(),
};
