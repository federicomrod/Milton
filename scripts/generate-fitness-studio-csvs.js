/**
 * Generate fitness studio CSV (and Excel) files with data for the last 180 days.
 * Column names match Supabase data_tables.fields for upload.
 * Run: node scripts/generate-fitness-studio-csvs.js
 * Output: test-data/fitness-studio/*.csv and optionally *.xlsx
 */

const fs = require("fs");
const path = require("path");

const BASE_DIR = path.join(__dirname, "..", "test-data", "fitness-studio");
const OUT_DIR = path.join(BASE_DIR, "run-" + Date.now());
const DAYS = 180;

// Column names from Supabase data_tables (fitness studio)
const MEMBERS_HEADERS = [
  "ID",
  "Name",
  "Last Name",
  "Join Date",
  "Status",
  "Plan ID",
  "Cancel Date",
  "Birth Date",
];
const BOOKINGS_HEADERS = [
  "Booking ID",
  "Member ID",
  "Class ID",
  "Attendance Status",
  "Price",
  "Instructor Name",
  "Instructor ID",
  "Date & Time",
];
const CLASSES_HEADERS = [
  "Class ID",
  "Type ID",
  "Instructor ID",
  "Capacity",
  "Class Starting Time",
  "Class Duration",
  "Class Name",
];
const INSTRUCTORS_HEADERS = [
  "Instructor ID",
  "Name",
  "Last Name",
  "Employment Type",
  "Status",
  "Start Date",
  "End Date",
  "Availability in %",
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
function dateTimeStr(d) {
  return d.toISOString().slice(0, 19).replace("T", " ");
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

function escapeCsv(val) {
  const s = String(val ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
function rowToCsv(headers, row) {
  return headers.map((h) => escapeCsv(row[h])).join(",");
}

const now = new Date();
const toDate = new Date(now);
const fromDate = addDays(now, -DAYS);

const firstNames = [
  "Alex",
  "Jordan",
  "Sam",
  "Taylor",
  "Morgan",
  "Casey",
  "Riley",
  "Quinn",
  "Emma",
  "Liam",
  "Olivia",
  "Noah",
  "Ava",
  "Ethan",
  "Sophia",
  "Mason",
  "Isabella",
  "William",
  "Mia",
  "James",
  "Charlotte",
  "Benjamin",
  "Amelia",
  "Lucas",
];
const lastNames = [
  "Smith",
  "Johnson",
  "Williams",
  "Brown",
  "Jones",
  "Garcia",
  "Miller",
  "Davis",
  "Martinez",
  "Wilson",
  "Anderson",
  "Thomas",
  "Taylor",
  "Moore",
  "Jackson",
  "Martin",
];

// --- Members ---
let memberId = 0;
const members = [];
const planIds = ["P001", "P002", "P003"];
for (let i = 0; i < 72; i++) {
  const joinOffset = randomBetween(0, DAYS - 1);
  const joinDate = addDays(fromDate, joinOffset);
  const id = `M${String(++memberId).padStart(4, "0")}`;
  const firstName = pick(firstNames);
  const lastName = pick(lastNames);
  let cancelDate = null;
  let status = "Active";
  if (Math.random() < 0.12) {
    const cancelOffset = randomBetween(joinOffset + 7, DAYS - 1);
    cancelDate = addDays(fromDate, cancelOffset);
    status = "Cancelled";
  }
  const birthDate = addDays(new Date(1985, 0, 1), randomBetween(0, 365 * 35));
  members.push({
    ID: id,
    Name: firstName,
    "Last Name": lastName,
    "Join Date": dateStr(joinDate),
    Status: status,
    "Plan ID": pick(planIds),
    "Cancel Date": cancelDate ? dateStr(cancelDate) : "",
    "Birth Date": dateStr(birthDate),
  });
}

// --- Instructors ---
const instructors = [
  {
    "Instructor ID": "I001",
    Name: "Jamie",
    "Last Name": "Chen",
    "Employment Type": "Part-time",
    Status: "Active",
    "Start Date": "2023-01-15",
    "End Date": "",
    "Availability in %": 80,
  },
  {
    "Instructor ID": "I002",
    Name: "Ryan",
    "Last Name": "Foster",
    "Employment Type": "Full-time",
    Status: "Active",
    "Start Date": "2022-06-01",
    "End Date": "",
    "Availability in %": 100,
  },
  {
    "Instructor ID": "I003",
    Name: "Morgan",
    "Last Name": "Lee",
    "Employment Type": "Part-time",
    Status: "Active",
    "Start Date": "2023-03-10",
    "End Date": "",
    "Availability in %": 60,
  },
  {
    "Instructor ID": "I004",
    Name: "Casey",
    "Last Name": "Wright",
    "Employment Type": "Part-time",
    Status: "Active",
    "Start Date": "2023-05-01",
    "End Date": "",
    "Availability in %": 75,
  },
  {
    "Instructor ID": "I005",
    Name: "Quinn",
    "Last Name": "Brooks",
    "Employment Type": "Full-time",
    Status: "Active",
    "Start Date": "2022-09-01",
    "End Date": "",
    "Availability in %": 100,
  },
  {
    "Instructor ID": "I006",
    Name: "Riley",
    "Last Name": "Hayes",
    "Employment Type": "Part-time",
    Status: "Active",
    "Start Date": "2024-01-01",
    "End Date": "",
    "Availability in %": 50,
  },
];

// --- Classes (master list with one sample Class Starting Time each, for lookup) ---
const classTemplateList = [
  {
    "Class ID": "C001",
    "Type ID": "T01",
    "Instructor ID": "I001",
    Capacity: 20,
    "Class Duration": 60,
    "Class Name": "Morning Flow Yoga",
  },
  {
    "Class ID": "C002",
    "Type ID": "T02",
    "Instructor ID": "I002",
    Capacity: 15,
    "Class Duration": 55,
    "Class Name": "Power Pilates",
  },
  {
    "Class ID": "C003",
    "Type ID": "T03",
    "Instructor ID": "I003",
    Capacity: 25,
    "Class Duration": 45,
    "Class Name": "HIIT Blast",
  },
  {
    "Class ID": "C004",
    "Type ID": "T01",
    "Instructor ID": "I004",
    Capacity: 18,
    "Class Duration": 50,
    "Class Name": "Stretch & Restore",
  },
  {
    "Class ID": "C005",
    "Type ID": "T02",
    "Instructor ID": "I002",
    Capacity: 10,
    "Class Duration": 60,
    "Class Name": "Reformer Pilates",
  },
  {
    "Class ID": "C006",
    "Type ID": "T03",
    "Instructor ID": "I006",
    Capacity: 20,
    "Class Duration": 50,
    "Class Name": "Strength & Conditioning",
  },
  {
    "Class ID": "C007",
    "Type ID": "T01",
    "Instructor ID": "I001",
    Capacity: 22,
    "Class Duration": 60,
    "Class Name": "Vinyasa Flow",
  },
  {
    "Class ID": "C008",
    "Type ID": "T02",
    "Instructor ID": "I005",
    Capacity: 16,
    "Class Duration": 55,
    "Class Name": "Mat Pilates",
  },
  {
    "Class ID": "C009",
    "Type ID": "T03",
    "Instructor ID": "I003",
    Capacity: 24,
    "Class Duration": 45,
    "Class Name": "Cardio Sculpt",
  },
  {
    "Class ID": "C010",
    "Type ID": "T01",
    "Instructor ID": "I004",
    Capacity: 20,
    "Class Duration": 75,
    "Class Name": "Yin Yoga",
  },
  {
    "Class ID": "C011",
    "Type ID": "T03",
    "Instructor ID": "I006",
    Capacity: 18,
    "Class Duration": 55,
    "Class Name": "Barre Fusion",
  },
  {
    "Class ID": "C012",
    "Type ID": "T02",
    "Instructor ID": "I005",
    Capacity: 14,
    "Class Duration": 50,
    "Class Name": "Core & Balance",
  },
];

// Build classes with Class Starting Time: multiple occurrences per class over the 180 days (~every 2 days)
const classes = [];
for (const t of classTemplateList) {
  for (let d = 0; d < DAYS; d += 2) {
    const day = addDays(fromDate, d);
    if (day > toDate) break;
    const hour = randomBetween(7, 18);
    const minute = pick([0, 15, 30]);
    const startTime = new Date(day);
    startTime.setHours(hour, minute, 0, 0);
    classes.push({
      "Class ID": t["Class ID"],
      "Type ID": t["Type ID"],
      "Instructor ID": t["Instructor ID"],
      Capacity: t["Capacity"],
      "Class Starting Time": dateTimeStr(startTime),
      "Class Duration": t["Class Duration"],
      "Class Name": t["Class Name"],
    });
  }
}

const instructorNames = Object.fromEntries(
  instructors.map((i) => [i["Instructor ID"], `${i["Name"]} ${i["Last Name"]}`])
);

// --- Bookings ---
const bookings = [];
let bookingId = 0;
const attendanceStatuses = [
  "Attended",
  "Attended",
  "Attended",
  "Attended",
  "Booked",
  "Cancelled",
  "No-show",
];
for (let d = 0; d < DAYS; d++) {
  const day = addDays(fromDate, d);
  const classesThisDay = randomBetween(4, 8);
  for (let c = 0; c < classesThisDay; c++) {
    const cls = pick(classTemplateList);
    const hour = randomBetween(6, 19);
    const minute = pick([0, 15, 30, 45]);
    const bookingTime = new Date(day);
    bookingTime.setHours(hour, minute, 0, 0);
    if (bookingTime > toDate) continue;
    const numAttendees = randomBetween(3, Math.min(cls.Capacity, 18));
    for (let a = 0; a < numAttendees; a++) {
      const member = pick(members);
      const joinDate = new Date(member["Join Date"]);
      if (joinDate > bookingTime) continue;
      if (member["Cancel Date"]) {
        const cancelDate = new Date(member["Cancel Date"]);
        if (cancelDate < bookingTime) continue;
      }
      const inst = pick(instructors);
      bookings.push({
        "Booking ID": `B${String(++bookingId).padStart(5, "0")}`,
        "Member ID": member["ID"],
        "Class ID": cls["Class ID"],
        "Attendance Status": pick(attendanceStatuses),
        Price:
          cls["Class Duration"] <= 45
            ? 14
            : cls["Class Duration"] <= 55
              ? 18
              : 20,
        "Instructor Name": `${inst["Name"]} ${inst["Last Name"]}`,
        "Instructor ID": inst["Instructor ID"],
        "Date & Time": dateTimeStr(bookingTime),
      });
    }
  }
}

// --- Transactions ---
const transactions = [];
let paymentId = 0;
const revenueCategories = ["Membership", "Drop-in", "Class pack", "Revenue"];
const expenseCategories = [
  "Payroll",
  "Rent",
  "Utilities",
  "Equipment",
  "Marketing",
  "Insurance",
  "Supplies",
];
for (let m = 0; m < DAYS; m++) {
  const monthStart = addDays(fromDate, m * 30);
  if (monthStart > toDate) break;
  for (let i = 0; i < randomBetween(25, 45); i++) {
    const d = addDays(monthStart, randomBetween(0, 28));
    if (d > toDate) continue;
    const member = pick(members);
    const amt = randomBetween(25, 120);
    const cat = pick(revenueCategories);
    transactions.push({
      ID: `P${String(++paymentId).padStart(5, "0")}`,
      "Counterparty ID": member["ID"],
      Date: dateStr(d),
      Amount: amt,
      Currency: "EUR",
      "Direction (inflow / outflow)": "inflow",
      Category: cat,
      "Payment Method": pick(["Card", "Bank", "Cash"]),
      Source: "Studio",
    });
  }
  for (let e = 0; e < randomBetween(5, 12); e++) {
    const d = addDays(monthStart, randomBetween(0, 28));
    if (d > toDate) continue;
    const amt = -randomBetween(500, 3500);
    const cat = pick(expenseCategories);
    transactions.push({
      ID: `P${String(++paymentId).padStart(5, "0")}`,
      "Counterparty ID": "",
      Date: dateStr(d),
      Amount: amt,
      Currency: "EUR",
      "Direction (inflow / outflow)": "outflow",
      Category: cat,
      "Payment Method": "Bank",
      Source: "Bank",
    });
  }
}

// --- Write CSVs ---
fs.mkdirSync(OUT_DIR, { recursive: true });

fs.writeFileSync(
  path.join(OUT_DIR, "Members.csv"),
  [
    MEMBERS_HEADERS.join(","),
    ...members.map((r) => rowToCsv(MEMBERS_HEADERS, r)),
  ].join("\n"),
  "utf8"
);
fs.writeFileSync(
  path.join(OUT_DIR, "Instructors.csv"),
  [
    INSTRUCTORS_HEADERS.join(","),
    ...instructors.map((r) => rowToCsv(INSTRUCTORS_HEADERS, r)),
  ].join("\n"),
  "utf8"
);
fs.writeFileSync(
  path.join(OUT_DIR, "Classes.csv"),
  [
    CLASSES_HEADERS.join(","),
    ...classes.map((r) => rowToCsv(CLASSES_HEADERS, r)),
  ].join("\n"),
  "utf8"
);
fs.writeFileSync(
  path.join(OUT_DIR, "Bookings.csv"),
  [
    BOOKINGS_HEADERS.join(","),
    ...bookings.map((r) => rowToCsv(BOOKINGS_HEADERS, r)),
  ].join("\n"),
  "utf8"
);
fs.writeFileSync(
  path.join(OUT_DIR, "Transactions.csv"),
  [
    TRANSACTIONS_HEADERS.join(","),
    ...transactions.map((r) => rowToCsv(TRANSACTIONS_HEADERS, r)),
  ].join("\n"),
  "utf8"
);

// --- Write Excel (one workbook, one sheet per table) ---
try {
  const XLSX = require("xlsx");
  const wb = XLSX.utils.book_new();
  const toSheet = (headers, rows) => {
    const data = [headers, ...rows.map((r) => headers.map((h) => r[h] ?? ""))];
    return XLSX.utils.aoa_to_sheet(data);
  };
  XLSX.utils.book_append_sheet(
    wb,
    toSheet(MEMBERS_HEADERS, members),
    "Members"
  );
  XLSX.utils.book_append_sheet(
    wb,
    toSheet(INSTRUCTORS_HEADERS, instructors),
    "Instructors"
  );
  XLSX.utils.book_append_sheet(
    wb,
    toSheet(CLASSES_HEADERS, classes),
    "Classes"
  );
  XLSX.utils.book_append_sheet(
    wb,
    toSheet(BOOKINGS_HEADERS, bookings),
    "Bookings"
  );
  XLSX.utils.book_append_sheet(
    wb,
    toSheet(TRANSACTIONS_HEADERS, transactions),
    "Transactions"
  );
  XLSX.writeFile(wb, path.join(OUT_DIR, "fitness-studio-upload.xlsx"));
  console.log("  fitness-studio-upload.xlsx (all sheets)");
} catch (e) {
  console.log("  (xlsx not available, CSV only)");
}

console.log("Generated in", OUT_DIR);
console.log("  Members.csv:     ", members.length, "rows");
console.log("  Instructors.csv: ", instructors.length, "rows");
console.log("  Classes.csv:     ", classes.length, "rows");
console.log("  Bookings.csv:    ", bookings.length, "rows");
console.log("  Transactions.csv:", transactions.length, "rows");
console.log(
  "  Date range:      ",
  dateStr(fromDate),
  "to",
  dateStr(toDate),
  "(last",
  DAYS,
  "days)"
);
