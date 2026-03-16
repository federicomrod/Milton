/**
 * Generate B2B SaaS CSV files with data for the last 180 days.
 * Column names match Supabase data_tables.fields for CRM, Employees, Employee Capacity,
 * Invoices, Subscriptions, and Transactions.
 * Run: node scripts/generate-b2b-saas-csvs.js
 * Output: test-data/b2b-saas/*.csv
 */

const fs = require("fs");
const path = require("path");

const BASE_DIR = path.join(__dirname, "..", "test-data", "b2b-saas");
const DAYS = 180;

// Column names from Supabase data_tables (B2B SaaS)
const CRM_HEADERS = [
  "Deal ID",
  "Deal Name",
  "Deal Phase",
  "Amount",
  "Client Name",
  "Deal Start Date",
  "Deal Closing Date",
  "Invoice Number",
  "Client ID",
  "Product",
];
const EMPLOYEE_CAPACITY_HEADERS = [
  "Employee ID",
  "Month",
  "Availability in %",
  "Contract Hours",
  "Cost Center",
];
const EMPLOYEES_HEADERS = [
  "Employee ID",
  "First Name",
  "Last Name",
  "Email",
  "Role Title",
  "Department",
  "Employment Type",
  "Status",
  "Start_date",
  "End_date",
];
const INVOICES_HEADERS = [
  "ID",
  "Number",
  "Type",
  "Counterparty ID",
  "Issue Date",
  "Due Date",
  "Status",
  "Currency",
  "Net Amount",
  "Tax Amount",
  "Total Amount",
  "Paid Amount",
  "Paid Date",
  "Category",
];
const SUBSCRIPTIONS_HEADERS = [
  "ID",
  "Customer ID",
  "Plan ID",
  "Monthly Recurring Revenue",
  "Start Date",
  "End Date",
  "Status (active, paused, cancelled, etc.)",
  "Cancelled Date",
  "Billing Period",
  "Currency",
  "Number of Seats",
];
const TRANSACTIONS_HEADERS = [
  "ID",
  "Counterparty ID",
  "Date",
  "Amount",
  "Currency",
  "Direction (inflow / outflow)",
  "Category",
  "Payment Method",
  "Source",
];

function dateStr(d) {
  return d.toISOString().split("T")[0];
}
function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function randomBetween(a, b) {
  return a + Math.floor(Math.random() * (b - a + 1));
}
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Always quote and escape so parsers (e.g. Excel) never split on commas inside headers or values
function quoteCsv(val) {
  const s = String(val ?? "");
  return '"' + s.replace(/"/g, '""') + '"';
}
function rowToCsv(headers, row) {
  return headers.map((h) => quoteCsv(row[h])).join(",");
}

const now = new Date();
const toDate = new Date(now);
const fromDate = addDays(now, -DAYS);

// --- Customers (for Client ID / Counterparty ID / Customer ID) ---
const customerIds = [];
for (let i = 1; i <= 40; i++) {
  customerIds.push(`C${String(i).padStart(4, "0")}`);
}

// --- Employees ---
const employees = [
  {
    "Employee ID": "E001",
    "First Name": "Jordan",
    "Last Name": "Smith",
    Email: "jordan.smith@company.com",
    "Role Title": "CEO",
    Department: "Leadership",
    "Employment Type": "Full-time",
    Status: "Active",
    Start_date: "2022-01-01",
    End_date: "",
  },
  {
    "Employee ID": "E002",
    "First Name": "Casey",
    "Last Name": "Lee",
    Email: "casey.lee@company.com",
    "Role Title": "CTO",
    Department: "Engineering",
    "Employment Type": "Full-time",
    Status: "Active",
    Start_date: "2022-03-15",
    End_date: "",
  },
  {
    "Employee ID": "E003",
    "First Name": "Morgan",
    "Last Name": "Brown",
    Email: "morgan.brown@company.com",
    "Role Title": "Head of Sales",
    Department: "Sales",
    "Employment Type": "Full-time",
    Status: "Active",
    Start_date: "2022-06-01",
    End_date: "",
  },
  {
    "Employee ID": "E004",
    "First Name": "Riley",
    "Last Name": "Davis",
    Email: "riley.davis@company.com",
    "Role Title": "Software Engineer",
    Department: "Engineering",
    "Employment Type": "Full-time",
    Status: "Active",
    Start_date: "2023-01-10",
    End_date: "",
  },
  {
    "Employee ID": "E005",
    "First Name": "Quinn",
    "Last Name": "Wilson",
    Email: "quinn.wilson@company.com",
    "Role Title": "Account Executive",
    Department: "Sales",
    "Employment Type": "Full-time",
    Status: "Active",
    Start_date: "2023-04-01",
    End_date: "",
  },
  {
    "Employee ID": "E006",
    "First Name": "Alex",
    "Last Name": "Martinez",
    Email: "alex.martinez@company.com",
    "Role Title": "Customer Success",
    Department: "CS",
    "Employment Type": "Full-time",
    Status: "Active",
    Start_date: "2023-07-01",
    End_date: "",
  },
];
const employeeIds = employees.map((e) => e["Employee ID"]);

// --- Employee Capacity (one row per employee per month) ---
const employeeCapacity = [];
for (const e of employees) {
  for (let m = 0; m < 7; m++) {
    const month = addDays(fromDate, m * 30);
    if (month > toDate) break;
    employeeCapacity.push({
      "Employee ID": e["Employee ID"],
      Month: dateStr(month),
      "Availability in %": randomBetween(85, 100),
      "Contract Hours": 160,
      "Cost Center": e["Department"],
    });
  }
}

// --- Subscriptions (active MRR) ---
const plans = [
  { id: "PLAN_STARTER", mrr: 99 },
  { id: "PLAN_PRO", mrr: 299 },
  { id: "PLAN_ENTERPRISE", mrr: 999 },
];
const subscriptions = [];
let subId = 0;
for (let i = 0; i < customerIds.length * 0.7; i++) {
  const custId = customerIds[i % customerIds.length];
  const plan = pick(plans);
  const startDate = addDays(fromDate, randomBetween(0, DAYS - 90));
  const status = Math.random() < 0.85 ? "active" : "cancelled";
  const endDate =
    status === "cancelled" ? addDays(startDate, randomBetween(30, DAYS)) : null;
  subscriptions.push({
    ID: `SUB${String(++subId).padStart(4, "0")}`,
    "Customer ID": custId,
    "Plan ID": plan.id,
    "Monthly Recurring Revenue": plan.mrr,
    "Start Date": dateStr(startDate),
    "End Date": endDate ? dateStr(endDate) : "",
    "Status (active, paused, cancelled, etc.)": status,
    "Cancelled Date": endDate ? dateStr(endDate) : "",
    "Billing Period": "monthly",
    Currency: "USD",
    "Number of Seats": randomBetween(1, 50),
  });
}

// --- Invoices (AR = sales, AP = bills) ---
const invoices = [];
let invId = 0;
// AR invoices (revenue)
for (let m = 0; m < DAYS; m += 15) {
  const issueDate = addDays(fromDate, m);
  if (issueDate > toDate) break;
  for (let i = 0; i < randomBetween(8, 20); i++) {
    const custId = pick(customerIds);
    const total = randomBetween(500, 15000);
    const net = Math.round(total / 1.2);
    const tax = total - net;
    const paid = Math.random() < 0.8 ? total : 0;
    const paidDate = paid ? addDays(issueDate, randomBetween(5, 30)) : null;
    invoices.push({
      ID: `INV-AR-${String(++invId).padStart(5, "0")}`,
      Number: `AR-${invId}`,
      Type: "AR",
      "Counterparty ID": custId,
      "Issue Date": dateStr(issueDate),
      "Due Date": dateStr(addDays(issueDate, 30)),
      Status: paid ? "paid" : "sent",
      Currency: "USD",
      "Net Amount": net,
      "Tax Amount": tax,
      "Total Amount": total,
      "Paid Amount": paid,
      "Paid Date": paidDate ? dateStr(paidDate) : "",
      Category: "sales",
    });
  }
}
// AP invoices (expenses)
const apCategories = ["rent", "ads", "licenses", "payroll", "software"];
for (let m = 0; m < DAYS; m += 30) {
  const issueDate = addDays(fromDate, m);
  if (issueDate > toDate) break;
  for (let i = 0; i < randomBetween(5, 12); i++) {
    const total = -randomBetween(200, 8000);
    const net = Math.round(total / 1.2);
    const tax = total - net;
    invoices.push({
      ID: `INV-AP-${String(++invId).padStart(5, "0")}`,
      Number: `AP-${invId}`,
      Type: "AP",
      "Counterparty ID": "VENDOR-" + randomBetween(1, 20),
      "Issue Date": dateStr(issueDate),
      "Due Date": dateStr(addDays(issueDate, 30)),
      Status: "paid",
      Currency: "USD",
      "Net Amount": net,
      "Tax Amount": tax,
      "Total Amount": total,
      "Paid Amount": total,
      "Paid Date": dateStr(addDays(issueDate, 14)),
      Category: pick(apCategories),
    });
  }
}

// --- CRM deals ---
const phases = [
  "Lead",
  "Qualified",
  "Proposal",
  "Negotiation",
  "Closed Won",
  "Closed Lost",
];
const products = [
  "Enterprise Plan",
  "Professional Plan",
  "Starter Plan",
  "Add-on Support",
  "Custom Integration",
];
const crmDeals = [];
let dealId = 0;
const companyNames = [
  "Acme Corp",
  "Beta Inc",
  "Gamma LLC",
  "Delta Co",
  "Epsilon Ltd",
  "Zeta Industries",
  "Eta Solutions",
  "Theta Labs",
];
for (let i = 0; i < 60; i++) {
  const startDate = addDays(fromDate, randomBetween(0, DAYS - 60));
  const phase = pick(phases);
  const isClosed = phase === "Closed Won" || phase === "Closed Lost";
  const closingDate = isClosed
    ? addDays(startDate, randomBetween(7, 90))
    : addDays(startDate, randomBetween(14, 120)); // expected close for open deals
  const amount = randomBetween(2000, 25000);
  const clientId = pick(customerIds);
  crmDeals.push({
    "Deal ID": `D${String(++dealId).padStart(4, "0")}`,
    "Deal Name": `${pick(companyNames)} - ${phase}`,
    "Deal Phase": phase,
    Amount: amount,
    "Client Name": pick(companyNames),
    "Deal Start Date": dateStr(startDate),
    "Deal Closing Date": dateStr(closingDate),
    "Invoice Number": isClosed && phase === "Closed Won" ? `AR-${dealId}` : "",
    "Client ID": clientId,
    Product: pick(products),
  });
}

// --- Transactions (inflows from payments, outflows for expenses) ---
const transactions = [];
let txId = 0;
const inflowCategories = ["Subscription", "One-time", "License", "Revenue"];
const outflowCategories = [
  "Payroll",
  "Rent",
  "Software",
  "Marketing",
  "Hosting",
  "Insurance",
];
for (let m = 0; m < DAYS; m++) {
  const d = addDays(fromDate, m);
  if (d > toDate) break;
  // Inflows
  for (let i = 0; i < randomBetween(3, 12); i++) {
    const amt = randomBetween(500, 12000);
    transactions.push({
      ID: `TX${String(++txId).padStart(6, "0")}`,
      "Counterparty ID": pick(customerIds),
      Date: dateStr(d),
      Amount: amt,
      Currency: "USD",
      "Direction (inflow / outflow)": "inflow",
      Category: pick(inflowCategories),
      "Payment Method": pick(["Card", "Bank", "Wire"]),
      Source: "Stripe",
    });
  }
  // Outflows
  for (let i = 0; i < randomBetween(2, 8); i++) {
    const amt = -randomBetween(300, 8000);
    transactions.push({
      ID: `TX${String(++txId).padStart(6, "0")}`,
      "Counterparty ID": "",
      Date: dateStr(d),
      Amount: amt,
      Currency: "USD",
      "Direction (inflow / outflow)": "outflow",
      Category: pick(outflowCategories),
      "Payment Method": "Bank",
      Source: "Bank",
    });
  }
}

// --- Write CSVs ---
fs.mkdirSync(BASE_DIR, { recursive: true });

const files = [
  { name: "CRM.csv", headers: CRM_HEADERS, rows: crmDeals },
  {
    name: "Employee Capacity.csv",
    headers: EMPLOYEE_CAPACITY_HEADERS,
    rows: employeeCapacity,
  },
  { name: "Employees.csv", headers: EMPLOYEES_HEADERS, rows: employees },
  { name: "Invoices.csv", headers: INVOICES_HEADERS, rows: invoices },
  {
    name: "Subscriptions.csv",
    headers: SUBSCRIPTIONS_HEADERS,
    rows: subscriptions,
  },
  {
    name: "Transactions.csv",
    headers: TRANSACTIONS_HEADERS,
    rows: transactions,
  },
];

for (const { name, headers, rows } of files) {
  // Quote every header and every value so column alignment is never broken by commas
  const headerLine = headers.map((h) => quoteCsv(h)).join(",");
  const content = [headerLine, ...rows.map((r) => rowToCsv(headers, r))].join(
    "\n"
  );
  fs.writeFileSync(path.join(BASE_DIR, name), content, "utf8");
  console.log(`  ${name}: ${rows.length} rows`);
}

// STRUCTURE.md
const structureMd = `# B2B SaaS – CSV files for upload

This folder contains **CSV** files you can upload so that B2B SaaS KPIs, Sales Pipeline, Revenue & MRR, Financials, and Cash & Runway have data.

Column headers match your Supabase **data_tables** definitions for the B2B SaaS business model.

## Files (last ${DAYS} days)

| File | Description |
|------|-------------|
| **CRM.csv** | Deals: Deal ID, Deal Name, Deal Phase, Amount, Client Name, dates, Client ID |
| **Employee Capacity.csv** | Per-employee monthly capacity and hours |
| **Employees.csv** | Employee ID, name, role, department, status |
| **Invoices.csv** | AR (sales) and AP (bills): Total Amount, Issue Date, Status, Counterparty ID |
| **Subscriptions.csv** | Customer ID, Plan ID, Monthly Recurring Revenue, Start/End Date, Status |
| **Transactions.csv** | ID, Counterparty ID, Date, Amount, Direction (inflow / outflow), Category |

Dates use **YYYY-MM-DD**. Upload each CSV to the matching table in the app (Dashboard → Data / Model → upload and map columns).

## Regenerate

\`\`\`bash
node scripts/generate-b2b-saas-csvs.js
\`\`\`
`;

fs.writeFileSync(path.join(BASE_DIR, "STRUCTURE.md"), structureMd, "utf8");

console.log("\nGenerated in " + BASE_DIR);
console.log(
  "Date range: " +
    dateStr(fromDate) +
    " to " +
    dateStr(toDate) +
    " (last " +
    DAYS +
    " days)"
);
console.log(
  "\nUpload each CSV to the matching table name in Dashboard → Data → Upload."
);
