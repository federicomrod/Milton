import { NextResponse } from "next/server";

// Temporary restaurant-pivot baseline stabilization:
// keep this compatibility route so legacy callers do not fail with a 404.
const DEPRECATION_PAYLOAD = {
  error: "Legacy upload endpoint is deprecated.",
  message:
    "Use /dashboard/data with /api/data/upload-model-table. No data was processed.",
  supportedPath: {
    page: "/dashboard/data",
    api: "/api/data/upload-model-table",
  },
  processed: false,
};

export async function POST() {
  return NextResponse.json(DEPRECATION_PAYLOAD, { status: 410 });
}

export async function GET() {
  return NextResponse.json(DEPRECATION_PAYLOAD, { status: 410 });
}
