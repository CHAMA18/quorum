import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserFromToken, SESSION_COOKIE } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { setSetting } from "@/lib/db";
import { CUSTOM_RULES_KEY, readRules, type CustomRule } from "@/lib/custom-rules";

const RuleSchema = z.object({
  name: z.string().min(2).max(80),
  keyword: z.string().min(2).max(80),
  severity: z.enum(["HIGH", "MEDIUM", "LOW"]),
});

/** GET/POST/DELETE /api/settings/rules — workspace compliance rules. */
export async function GET(request: NextRequest) {
  const user = await getUserFromToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!can(user.role, "manage_rules") && !can(user.role, "view_oversight")) {
    return NextResponse.json({ error: "Rule or oversight access required." }, { status: 403 });
  }
  return NextResponse.json({ rules: readRules() });
}

export async function POST(request: NextRequest) {
  const user = await getUserFromToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!can(user.role, "manage_rules")) return NextResponse.json({ error: "Rule management access required." }, { status: 403 });
  const parsed = RuleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A rule needs a name, a keyword of 2+ characters, and a severity." }, { status: 422 });
  const rule: CustomRule = { id: `rule-${Date.now().toString(36)}`, ...parsed.data, enabled: true };
  const rules = [...readRules(), rule].slice(-50);
  setSetting(CUSTOM_RULES_KEY, JSON.stringify(rules));
  return NextResponse.json({ rules, created: rule }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const user = await getUserFromToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!can(user.role, "manage_rules")) return NextResponse.json({ error: "Rule management access required." }, { status: 403 });
  const id = request.nextUrl.searchParams.get("id") ?? "";
  const rules = readRules().filter((r) => r.id !== id);
  setSetting(CUSTOM_RULES_KEY, JSON.stringify(rules));
  return NextResponse.json({ rules });
}
