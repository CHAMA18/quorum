import { POST as evaluateBids } from "../compare-bidders/route";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return evaluateBids(request);
}
