import { NextResponse } from "next/server";
import { API_DIRECTORY } from "@/lib/api-directory";

export async function GET() {
  return NextResponse.json(API_DIRECTORY, {
    headers: { "cache-control": "public, max-age=300, stale-while-revalidate=600" },
  });
}
