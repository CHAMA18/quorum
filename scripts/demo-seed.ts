/**
 * Live demo seed — three fully-populated tenders, fifteen supplier accounts,
 * five bids per tender, a drafted tender notice with published evaluation
 * criteria, and one review run per tender that parks at the human-approval
 * gate.
 *
 * Everything goes through the same HTTP routes the demo will use: the
 * procurement-plan actions as the signed-in officer, the supplier portal as
 * each organization's own session, the desk activation through the oversight
 * route. Nothing writes the sidecar store directly, so every step lands in
 * the hash-chained tool log exactly like a hand-driven demo would.
 *
 *   bun scripts/demo-seed.ts            # against the live Render origin
 *   DEMO_BASE=http://127.0.0.1:3000 bun scripts/demo-seed.ts
 *
 * Safe to re-run: an existing organization, an already-filed bid and a run
 * already at a gate are reported and skipped rather than duplicated.
 */

const BASE = (process.env.DEMO_BASE ?? "https://quorum-api-tgw2.onrender.com").replace(/\/$/, "");
const JUDGE = { email: "judge@quorum.test", password: "Gatekeeper#2026" };
const OFFICER = { email: "demo.officer@quorum.test", password: "QuorumDemo#2026" };
const SUPPLIER_PASSWORD = "Supplier#2026";
const JP = "?XTransformPort=3031";

type Tender = {
  ref: string;
  title: string;
  office: string;
  buyer: string;
  currency: string;
  ceiling: number;
  closing: string;
  category: string;
  specification: string;
  method: string;
  contact: string;
  technicalWeightPct: number;
  procedure: string;
  criteria: { title: string; weight: number; evidence: string; scoringMethod: string }[];
  suppliers: { name: string; amount: number; reg: string; pin: string; contact: string; phone: string; city: string; note: string }[];
};

const TENDERS: Tender[] = [
  {
    ref: "KE-MOH-2026-117",
    title: "Essential medicines tracer list (48 items) to Level 4–6 facilities — 12 counties",
    office: "Ministry of Health · Kenya",
    buyer: "Ministry of Health · Kenya · Division of Health Products and Technologies",
    currency: "KES",
    ceiling: 624_800_000,
    closing: "2027-01-30T07:00:00.000Z",
    category: "Health commodities · pharmaceuticals",
    specification:
      "Supply of the 48-item essential medicines tracer list to Level 4–6 facilities across 12 counties; WHO-prequalified or PPB-registered products; validated cold chain for thermolabile items; quarterly delivery call-offs against a frame agreement.",
    method: "Open competitive bidding (national)",
    contact: "Procurement Secretariat, Division of Health Products and Technologies — tenders@health.go.ke · +254 20 271 7077",
    technicalWeightPct: 60,
    procedure:
      "Bids are opened publicly at the closing time and examined in three stages: preliminary examination against the required documents, technical scoring against the published criteria, and financial comparison of technically compliant bids only. The lowest evaluated price receives the full financial weight. Kira's review is advisory evidence for the committee; the committee records the scores and the accounting officer approves the outcome.",
    criteria: [
      { title: "Regulatory standing and product prequalification", weight: 30, evidence: "PPB wholesaler licence, WHO prequalification or PPB registration certificate for each tracer item, and certificates of analysis for every quoted batch", scoringMethod: "Scored out of 30: full marks where every tracer item is WHO-prequalified or PPB-registered with batch analyses on file; a proportional deduction for each item without a certificate" },
      { title: "Tracer-list coverage and cold-chain capability", weight: 30, evidence: "Price schedule covering all 48 tracer items, a validated cold-chain capability report, and a delivery plan for the 12 counties", scoringMethod: "Scored out of 30: 15 for complete tracer-list coverage and 15 for validated cold chain with a delivery plan for all 12 counties" },
      { title: "Evaluated price", weight: 40, evidence: "Completed price schedule in KES, valid for 90 days from bid opening", scoringMethod: "The lowest evaluated price scores 40; every other compliant bid scores 40 multiplied by the lowest evaluated price divided by its own evaluated price" },
    ],
    suppliers: [
      { name: "Savanna Pharma Distributors Ltd", amount: 598_400_000, reg: "PVT-KE-2016-88421", pin: "P051882734Q", contact: "Amina Wanjiku Otieno", phone: "+254722145880", city: "Nairobi", note: "PPB wholesaler licence held for all twelve counties; cold-chain fleet with 14 validated vehicles; WHO prequalified source manufacturers." },
      { name: "Equatorial Medicines Supply Ltd", amount: 612_250_000, reg: "PVT-KE-2014-55190", pin: "P051447290M", contact: "Joseph Kariuki Mwangi", phone: "+254733908214", city: "Nakuru", note: "Full tracer list quoted; two thermolabile lines offered from a PPB-registered secondary source; cold-chain capability report attached." },
      { name: "Coastline Health Partners Ltd", amount: 704_900_000, reg: "PVT-KE-2019-11207", pin: "P052001188K", contact: "Fatuma Said Ali", phone: "+254711466203", city: "Mombasa", note: "Bid 12.8% above the published ceiling; regional depot model with third-party cold-chain subcontractor." },
      { name: "Rift Valley Medical Wholesalers Ltd", amount: 655_300_000, reg: "PVT-KE-2020-77341", pin: "P051993204T", contact: "Daniel Kipchoge Bett", phone: "+254720774118", city: "Eldoret", note: "Tracer list partially quoted; 44 of 48 lines priced, four lines deferred to a second call-off." },
      { name: "Lakeside Pharmaceuticals Ltd", amount: 631_700_000, reg: "PVT-KE-2011-60837", pin: "P051330887D", contact: "Rose Atieno Ouma", phone: "+254715664902", city: "Kisumu", note: "Full tracer list quoted; WHO prequalification certificates for 46 of 48 items; validated cold chain subcontracted to a licensed third party." },
    ],
  },
  {
    ref: "KE-WRA-2026-058",
    title: "Supply and commissioning of solar submersible borehole pumps, lots 1–3",
    office: "Water Resources Authority",
    buyer: "Water Resources Authority · Nairobi",
    currency: "KES",
    ceiling: 8_000_000,
    closing: "2027-03-20T07:00:00.000Z",
    category: "Water infrastructure · pumping equipment",
    specification:
      "Supply, install and commission solar submersible borehole pumps across three lots (Lot 1: 6 units, Lot 2: 9 units, Lot 3: 12 units); pump test certificates per unit; five-year warranty; WRA-registered installer required.",
    method: "Open competitive bidding (national)",
    contact: "Procurement Office, Water Resources Authority — procurement@wra.go.ke · +254 20 271 6030",
    technicalWeightPct: 70,
    procedure:
      "Bids are opened publicly at the closing time and examined in two stages before price comparison: preliminary examination against the required documents, then technical scoring against the published criteria. Only bids reaching the technical threshold proceed to financial evaluation. Kira's review is advisory evidence for the committee; the committee records the scores and the accounting officer approves the outcome.",
    criteria: [
      { title: "Pump specification and test certification", weight: 35, evidence: "Pump test certificates for each unit, manufacturer datasheets against the published duty points, and the five-year warranty terms", scoringMethod: "Scored out of 35 against the published duty points for each lot; a unit without a test certificate scores zero for that lot" },
      { title: "Installation capacity and statutory registration", weight: 35, evidence: "Water Resources Authority installer registration, the installation methodology and a commissioning plan for all three lots", scoringMethod: "Scored out of 35: 20 for WRA-registered installation capacity and 15 for a commissioning plan covering every lot" },
      { title: "Evaluated price", weight: 30, evidence: "Lot-by-lot price schedule in KES, valid for 90 days from bid opening", scoringMethod: "The lowest evaluated price scores 30; every other compliant bid scores 30 multiplied by the lowest evaluated price divided by its own evaluated price" },
    ],
    suppliers: [
      { name: "Aqua Dynamics Engineering Ltd", amount: 7_640_000, reg: "PVT-KE-2013-33820", pin: "P051226610H", contact: "Grace Njeri Kamau", phone: "+254701882744", city: "Nairobi", note: "All three lots quoted; pump test certificates and manufacturer warranty letter attached; in-house WRA-registered installation crew." },
      { name: "Rift Pumps & Boreholes Ltd", amount: 7_980_000, reg: "PVT-KE-2017-90214", pin: "P051773019B", contact: "Peter Omondi Ochieng", phone: "+254726551900", city: "Kisumu", note: "Lots 1 and 2 quoted; Lot 3 offered with an alternative impeller material (AISI 316 stainless) at the same price." },
      { name: "Sahel Water Works Ltd", amount: 9_240_000, reg: "PVT-KE-2015-41009", pin: "P051668034F", contact: "Halima Abdalla Noor", phone: "+254799203611", city: "Garissa", note: "Single lump-sum bid for all lots; bid value 15.5% above the published ceiling; commissioning included." },
      { name: "Tsavo Pump Systems Ltd", amount: 6_880_000, reg: "PVT-KE-2021-12056", pin: "P052118840R", contact: "Mercy Wambui Kariuki", phone: "+254714330872", city: "Machakos", note: "Lowest compliant-looking offer; installation subcontracted to a WRA-registered partner; pump test certificates attached." },
      { name: "Highland Borehole Services Ltd", amount: 7_410_000, reg: "PVT-KE-2018-40392", pin: "P051812065C", contact: "Elias Mwangi Gichuru", phone: "+254728110547", city: "Nyeri", note: "Lots 1 and 3 quoted; Lot 2 priced separately as a framework call-off; five-year warranty letter from the pump manufacturer attached." },
    ],
  },
  {
    ref: "KE-MOE-2026-205",
    title: "Supply and installation of student desks and physics laboratory kits — 40 secondary schools",
    office: "Ministry of Education · State Department for Basic Education",
    buyer: "Ministry of Education · State Department for Basic Education",
    currency: "KES",
    ceiling: 90_000_000,
    closing: "2027-03-03T07:00:00.000Z",
    category: "Education supplies · furniture and laboratory equipment",
    specification:
      "Supply and install 6,000 two-seater student desks and 40 physics laboratory kits across 40 secondary schools in eight counties; ISO 9001-manufactured furniture; manufacturer authorization for laboratory kits; installation within 90 days of contract signature.",
    method: "Open competitive bidding (national)",
    contact: "Procurement Unit, State Department for Basic Education — tenders@education.go.ke · +254 20 318 5812",
    technicalWeightPct: 60,
    procedure:
      "Bids are opened publicly at the closing time and examined in three stages: preliminary examination against the required documents, technical scoring against the published criteria, and financial comparison of technically compliant bids only. The lowest evaluated price receives the full financial weight. Kira's review is advisory evidence for the committee; the committee records the scores and the accounting officer approves the outcome.",
    criteria: [
      { title: "Manufacturing quality and manufacturer authorization", weight: 30, evidence: "ISO 9001 certificate and a manufacturer authorization letter covering every quoted laboratory kit", scoringMethod: "Scored out of 30: 15 for a current ISO 9001 certificate and 15 for manufacturer authorization covering every quoted kit" },
      { title: "Scope coverage and installation plan", weight: 30, evidence: "Bill of quantities for 6,000 desks and 40 kits, with an installation schedule for 40 schools in eight counties", scoringMethod: "Scored out of 30: 15 for complete scope coverage and 15 for an installation schedule inside 90 days of contract signature" },
      { title: "Evaluated price", weight: 40, evidence: "Completed price schedule in KES, valid for 90 days from bid opening", scoringMethod: "The lowest evaluated price scores 40; every other compliant bid scores 40 multiplied by the lowest evaluated price divided by its own evaluated price" },
    ],
    suppliers: [
      { name: "Lakeshore Educational Supplies Ltd", amount: 86_400_000, reg: "PVT-KE-2012-20981", pin: "P051034472L", contact: "Beatrice Achieng Odhiambo", phone: "+254705118349", city: "Kisumu", note: "6,000 desks and all 40 kits quoted; ISO 9001 certificate and manufacturer authorization letter attached." },
      { name: "Rift Valley Lab Equipment Ltd", amount: 88_900_000, reg: "PVT-KE-2018-66450", pin: "P051889220C", contact: "Simon Kiprono Cheruiyot", phone: "+254738004711", city: "Nakuru", note: "Laboratory kits fully specified; desk supply offered from a subcontracted workshop without a manufacturer authorization letter." },
      { name: "Summit Learning Systems Ltd", amount: 94_750_000, reg: "PVT-KE-2016-77318", pin: "P051552036N", contact: "Wanjiru Muthoni Karanja", phone: "+254720667214", city: "Nairobi", note: "Bid 5.3% above the ceiling; premium ergonomic desk specification offered as a value-add at no change to the quoted total." },
      { name: "Mara Educational Works Ltd", amount: 82_150_000, reg: "PVT-KE-2022-30117", pin: "P052204418G", contact: "David Ole Sankale", phone: "+254712998450", city: "Narok", note: "Desks manufactured in-house; 36 of 40 laboratory kits quoted, remaining four deferred." },
      { name: "Nyanza Furniture Works Ltd", amount: 84_600_000, reg: "PVT-KE-2019-58624", pin: "P052009771J", contact: "Emily Anyango Were", phone: "+254736445120", city: "Kisumu", note: "All 6,000 desks and 40 kits quoted; ISO 9001 and manufacturer authorization attached; installation crew based in Siaya and Kisumu." },
    ],
  },
];

/* ── plumbing ───────────────────────────────────────────────────────────── */

type Cookie = string;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function login(email: string, password: string): Promise<Cookie> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const cookie = res.headers.get("set-cookie")?.split(";")[0];
    if (res.ok && cookie) return cookie;
    /* The sign-in door is rate limited too — wait out the window rather
       than hammering it. */
    if (res.status === 429) {
      warn(`sign-in for ${email} rate limited — waiting 60s`);
      await sleep(60_000);
      continue;
    }
    throw new Error(`login failed for ${email}: HTTP ${res.status} ${await res.text().catch(() => "")}`.slice(0, 300));
  }
  throw new Error(`login rate window never cleared for ${email}`);
}

async function call(path: string, opts: { cookie?: Cookie; method?: string; body?: unknown } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? (opts.body ? "POST" : "GET"),
    headers: {
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
      ...(opts.body ? { "content-type": "application/json" } : {}),
    },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  let data: any = {};
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 400) }; }
  return { status: res.status, data, cookie: res.headers.get("set-cookie")?.split(";")[0] };
}

const log = (msg: string) => console.log(msg);
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const skip = (msg: string) => console.log(`  · ${msg}`);
const warn = (msg: string) => console.log(`  ! ${msg}`);

/* A small, valid one-page PDF so uploaded bid evidence is a real file the
   storage layer inspects (magic bytes + type + size), not a placeholder. */
function pdf(title: string, lines: string[]): Uint8Array {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const content = [
    "BT /F1 15 Tf 56 760 Td (" + esc(title) + ") Tj ET",
    ...lines.map((line, i) => `BT /F1 9 Tf 56 ${730 - i * 16} Td (${esc(line)}) Tj ET`),
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

/* ── steps ──────────────────────────────────────────────────────────────── */

let judge: Cookie;

async function planTender(t: Tender) {
  log(`\n▸ ${t.ref} — procurement plan`);
  /* The cycle endpoint is the read model for both workflow records and the
     procurement pipeline; there is no GET /api/pipeline route. */
  const existing = await call(`/api/cycle${JP}`, { cookie: judge });
  if (existing.status !== 200) throw new Error(`pipeline/cycle read failed (${existing.status}): ${JSON.stringify(existing.data).slice(0, 260)}`);
  const rows: any[] = Array.isArray(existing.data.pipeline) ? existing.data.pipeline : [];
  const linked = rows.find((row) => row.linkedTenderId === t.ref);
  if (linked) {
    skip(`plan entry already linked (${linked.ref})`);
    return linked;
  }
  const created = await call(`/api/pipeline${JP}`, {
    cookie: judge,
    body: { title: t.title, office: t.office, budgetEstimate: t.ceiling, currency: t.currency, expectedPublication: "2026-12-01" },
  });
  if (created.status !== 201 && created.status !== 200) throw new Error(`pipeline refused: ${JSON.stringify(created.data)}`);
  const entry = created.data.entry ?? created.data;
  ok(`plan entry ${entry.ref} created (${t.currency} ${t.ceiling.toLocaleString("en-US")} ceiling)`);

  const req = await call(`/api/pipeline/${entry.id}/requisition${JP}`, {
    cookie: judge,
    body: { budgetValidated: true, budgetReference: `VOTE-${t.currency}-FY2026/27-${t.ref.slice(-3)}`, note: "Requirement confirmed against the approved procurement plan and the vote book line." },
  });
  if (req.status >= 400) warn(`requisition: ${JSON.stringify(req.data).slice(0, 200)}`);
  else ok("requisition validated against the vote book");

  const link = await call(`/api/pipeline/${entry.id}/link${JP}`, { cookie: judge, body: { tenderId: t.ref } });
  if (link.status >= 400) warn(`link: ${JSON.stringify(link.data).slice(0, 200)}`);
  else ok(`linked to tender pack ${t.ref}`);

  const closing = await call(`/api/tenders/${t.ref}/closing${JP}`, { cookie: judge, body: { closingDate: t.closing, actor: "Judge Demo" } });
  if (closing.status >= 400) warn(`closing: ${JSON.stringify(closing.data).slice(0, 200)}`);
  else ok(`closing date recorded (${t.closing.slice(0, 10)})`);

  return entry;
}

async function registerSupplier(t: Tender, s: Tender["suppliers"][number]): Promise<{ cookie: Cookie; org: any } | null> {
  const email = `bids+${s.reg.toLowerCase().replace(/[^a-z0-9]/g, "")}@quorum.test`;
  /* The public registration door allows 10 attempts per network per 15
     minutes — an honest abuse limit this script must respect, not defeat.
     A seed of twelve organizations therefore waits out the window. */
  let reg = await call("/api/org/auth/register", {
    body: {
      name: s.name,
      email,
      password: SUPPLIER_PASSWORD,
      registrationNo: s.reg,
      country: "Kenya",
      legalForm: "Private limited company",
      taxPin: s.pin,
      taxClearanceNo: `KRA-TCC-${s.pin.slice(-6)}`,
      taxClearanceExpiry: "2027-06-30",
      regulator: t.ref.startsWith("KE-MOH") ? "Pharmacy and Poisons Board" : t.ref.startsWith("KE-WRA") ? "Water Resources Authority" : "Kenya Bureau of Standards",
      regulatorNo: `REG-${s.reg.slice(-5)}`,
      contactName: s.contact,
      phone: s.phone,
      address: `${s.city}, Kenya`,
      categories: [t.category],
      description: `${s.name} is a Kenya-registered supplier serving public buyers in ${t.category.toLowerCase()} since ${2012 + (s.reg.length % 7)}.`,
    },
  });
  for (let attempt = 0; reg.status === 429 && attempt < 30; attempt++) {
    warn(`registration rate window reached — waiting 60s (attempt ${attempt + 1})`);
    await sleep(60_000);
    reg = await call("/api/org/auth/register", {
      body: {
        name: s.name,
        email,
        password: SUPPLIER_PASSWORD,
        registrationNo: s.reg,
        country: "Kenya",
        legalForm: "Private limited company",
        taxPin: s.pin,
        taxClearanceNo: `KRA-TCC-${s.pin.slice(-6)}`,
        taxClearanceExpiry: "2027-06-30",
        regulator: t.ref.startsWith("KE-MOH") ? "Pharmacy and Poisons Board" : t.ref.startsWith("KE-WRA") ? "Water Resources Authority" : "Kenya Bureau of Standards",
        regulatorNo: `REG-${s.reg.slice(-5)}`,
        contactName: s.contact,
        phone: s.phone,
        address: `${s.city}, Kenya`,
        categories: [t.category],
        description: `${s.name} is a Kenya-registered supplier serving public buyers in ${t.category.toLowerCase()} since ${2012 + (s.reg.length % 7)}.`,
      },
    });
  }
  if (reg.status === 409) {
    /* Organization sign-in has its own rate limit, and a 429 here must be
       waited out rather than abandoning an account that already exists. */
    let signed = await call("/api/org/auth/login", { body: { email, password: SUPPLIER_PASSWORD } });
    for (let attempt = 0; signed.status === 429 && attempt < 30; attempt++) {
      warn(`${s.name}: organization sign-in rate limited — waiting 60s (attempt ${attempt + 1})`);
      await sleep(60_000);
      signed = await call("/api/org/auth/login", { body: { email, password: SUPPLIER_PASSWORD } });
    }
    if (signed.status !== 200 || !signed.cookie) {
      warn(`${s.name}: exists, sign-in failed (${signed.status})`);
      return null;
    }
    skip(`${s.name} already registered`);
    return { cookie: signed.cookie, org: signed.data.org };
  }
  if (reg.status !== 201 || !reg.cookie) {
    warn(`${s.name}: registration refused — ${JSON.stringify(reg.data).slice(0, 220)}`);
    return null;
  }
  ok(`${s.name} registered (${email})`);
  return { cookie: reg.cookie, org: reg.data.org };
}

async function fileBid(t: Tender, s: Tender["suppliers"][number], orgId: string, cookie: Cookie) {
  const before = await call(`/api/applications${JP}&orgId=${encodeURIComponent(orgId)}`, { cookie: judge });
  const mine: any[] = (before.data.applications ?? []).filter((a: any) => a.tenderId === t.ref);
  if (mine.length) {
    skip(`${s.name}: bid already on record (${mine[0].id})`);
    return;
  }

  const requirements = await call(`/api/org/tenders/${t.ref}/documents`, { cookie });
  if (requirements.status !== 200) {
    warn(`${s.name}: requirements unreadable (${requirements.status}) ${JSON.stringify(requirements.data).slice(0, 160)}`);
    return;
  }
  const required: string[] = requirements.data.requiredDocuments ?? [];
  const uploaded: { requirement: string; key: string }[] = [];

  for (const requirement of required) {
    const form = new FormData();
    form.append("requirement", requirement);
    form.append(
      "file",
      new Blob([pdf(requirement, [
        `Bidder: ${s.name}`,
        `Registration: ${s.reg}`,
        `Tax PIN: ${s.pin}`,
        `Tender: ${t.ref} — ${t.title}`,
        `Issued for the Quorum demonstration desk.`, 
        `This document is fictional evidence created for a product demonstration.`,
      ]) as unknown as BlobPart], { type: "application/pdf" }),
      `${s.reg}-${requirement.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf`,
    );
    const put = await fetch(`${BASE}/api/org/tenders/${t.ref}/documents`, { method: "POST", headers: { cookie }, body: form });
    const body = (await put.json().catch(() => ({}))) as any;
    if (!put.ok || !body.document?.key) {
      warn(`${s.name}: upload "${requirement}" failed (${put.status}) ${JSON.stringify(body).slice(0, 180)}`);
      return;
    }
    uploaded.push({ requirement, key: body.document.key });
  }
  ok(`${s.name}: ${uploaded.length}/${required.length} required documents uploaded`);

  const filed = await call("/api/org/applications", {
    cookie,
    body: {
      tenderRef: t.ref,
      amount: s.amount,
      currency: t.currency,
      coverNote: s.note,
      bidDocuments: uploaded,
    },
  });
  if (filed.status !== 201) {
    warn(`${s.name}: bid refused (${filed.status}) ${JSON.stringify(filed.data).slice(0, 220)}`);
    return;
  }
  ok(`${s.name} filed a bid — ${t.currency} ${s.amount.toLocaleString("en-US")}`);
}

async function seedSuppliers(t: Tender) {
  log(`\n▸ ${t.ref} — supplier accounts and bids`);
  /* A bid already on record means the account, the desk activation and the
     filing all landed in an earlier run — skip the whole chain rather than
     spend the registration rate window re-proving it. */
  const filed = await call(`/api/applications${JP}`, { cookie: judge });
  const onRecord = new Set<string>(
    (filed.data.applications ?? [])
      .filter((a: any) => a.tenderId === t.ref)
      .map((a: any) => String(a.orgName ?? "").trim().toLowerCase()),
  );
  for (const s of t.suppliers) {
    if (onRecord.has(s.name.trim().toLowerCase())) {
      skip(`${s.name}: bid already on record`);
      continue;
    }
    const account = await registerSupplier(t, s);
    if (!account) continue;
    const orgId = account.org?.id ?? "";
    if (!orgId) { warn(`${s.name}: no organization id returned`); continue; }

    /* The desk verifies the organization's identity and statutory record —
       the same oversight action an officer takes before bids open. */
    /* /api/oversight is a PATCH endpoint; a POST here returns 405 and the
       organization correctly remains unaudited and unfileable. */
    const activation = await call("/api/oversight", {
      cookie: judge,
      method: "PATCH",
      body: { orgId, status: "ACTIVE", reason: "Identity, registration and tax standing verified by the demonstration desk." },
    });
    if (activation.status >= 400) {
      const detail = JSON.stringify(activation.data).slice(0, 160);
      if (!/already|same/i.test(detail)) warn(`${s.name}: activation ${activation.status} ${detail}`);
    }
    await fileBid(t, s, orgId, account.cookie);
  }
}

async function draftNotice(t: Tender, officer: Cookie) {
  log(`\n▸ ${t.ref} — tender notice`);
  const cycleRead = await call(`/api/cycle${JP}`, { cookie: judge });
  const cycle = (cycleRead.data.cycles ?? []).find((c: any) => c.tenderId === t.ref);
  const existing = (cycle?.notices ?? []).at(-1);
  /* The workspace jurisdiction supplies the evaluation currency and FX basis
     when the draft does not state them, which is why a Kenyan tender seeded in
     a Zambian-era workspace read ZMW. A draft still carrying that stamp is
     replaced by a corrected one on the next run. */
  const stale =
    !!existing &&
    !existing.issuedAt &&
    (!existing.md.includes(`**Evaluation currency:** ${t.currency}`) || existing.md.includes("**FX basis:** NOT STATED"));
  if (existing && !stale) {
    skip(`notice ${existing.id} already on record${existing.issuedAt ? " (issued)" : " (draft)"}`);
    return;
  }
  if (stale) warn(`notice ${existing.id} carried the workspace default currency — drafting a corrected revision`);

  /* The notice is generated from the specification, so the evaluation criteria
     have to be on the file before the notice is drafted — otherwise the
     criteria table in the notice is empty and it cannot be issued. */
  const criteria = await call(`/api/tenders/${t.ref}/specs/criteria${JP}`, {
    cookie: officer,
    body: { criteria: t.criteria, procedure: t.procedure },
  });
  if (criteria.status >= 400) {
    warn(`evaluation criteria refused (${criteria.status}) ${JSON.stringify(criteria.data).slice(0, 220)}`);
    return;
  }
  ok(`${t.criteria.length} evaluation criteria recorded in the specification (${t.criteria.map((c) => c.weight).join(" / ")})`);

  const market = await call(`/api/marketplace${JP}`, { cookie: judge });
  const row = (market.data.tenders ?? []).find((r: any) => r.ref === t.ref);
  const requiredDocs: string[] = row?.requiredDocuments ?? [];

  const drafted = await call(`/api/tenders/${t.ref}/notices/draft${JP}`, {
    cookie: officer,
    body: {
      buyer: t.buyer,
      subject: t.title,
      method: t.method,
      contact: t.contact,
      closingDate: t.closing,
      ceiling: `${t.currency} ${t.ceiling.toLocaleString("en-US")}`,
      technicalWeightPct: t.technicalWeightPct,
      evaluationCurrency: t.currency,
      fxBasis: `${t.currency} is the evaluation currency; any figure quoted in another currency is converted at the Central Bank mean rate for the bid opening date`,
      requiredDocs,
    },
  });
  if (drafted.status !== 201) {
    warn(`notice draft refused (${drafted.status}) ${JSON.stringify(drafted.data).slice(0, 260)}`);
    return;
  }
  const notice = drafted.data.notice ?? drafted.data;
  const missing = (notice.fieldCheck ?? []).filter((field: any) => !field.present).map((field: any) => field.field);
  if (missing.length) warn(`draft ${notice.id} is missing mandatory fields: ${missing.join(", ")}`);
  else ok(`notice ${notice.id} drafted with every mandatory field (${requiredDocs.length} required documents, ${notice.md.length} chars)`);
}

/** A bid document for one supplier, in the pack's convention: the stated
 *  "**Bidder:**" line is what the register, matrix and review agree on. */
function bidDocument(t: Tender, s: Tender["suppliers"][number]): string {
  return [
    `# BID — ${s.name}`,
    "",
    `**Reference:** ${t.ref}`,
    `**Bidder:** ${s.name}`,
    `**Bid value:** ${t.currency} ${s.amount.toLocaleString("en-US")}`,
    "",
    "## Documents enclosed",
    "",
    ...(t.ref === "KE-MOH-2026-117"
      ? ["- PPB wholesaler licence — current", "- WHO prequalification or PPB registration certificates", "- Certificate of analysis — samples for the quoted batches", "- Cold-chain capability report", "- Tax compliance certificate — current"]
      : t.ref === "KE-WRA-2026-058"
        ? ["- Pump test certificate — one per unit", "- Manufacturer warranty letter — five years", "- Water Resources Authority registration", "- Tax compliance certificate — current"]
        : ["- ISO 9001 certificate", "- Manufacturer authorization letter — laboratory kits", "- Tax compliance certificate — current"]),
    "",
    "## Declarations",
    "",
    s.note,
    `The bidder shall maintain the quoted price for 90 days from bid opening.`,
    "No deviations from the technical specification are offered beyond those stated above.",
    "",
  ].join("\n");
}

async function normalisePack(t: Tender, officer: Cookie) {
  log(`\n▸ ${t.ref} — bid pack`);
  const prune = await call(`/api/tenders/${t.ref}/pack/prune${JP}`, { cookie: officer, method: "POST", body: {} });
  if (prune.status >= 400) {
    warn(`pack prune refused (${prune.status}) ${JSON.stringify(prune.data).slice(0, 200)}`);
    return;
  }
  const removed: string[] = prune.data.removed ?? [];
  const staged = new Set<string>((prune.data.bidders ?? []).map((name: string) => name.trim().toLowerCase()));
  if (removed.length) ok(`withdrew ${removed.length} staged bid file(s) that were not on the certified register`);

  for (const s of t.suppliers) {
    if (staged.has(s.name.trim().toLowerCase())) {
      skip(`${s.name}: bid document already in the pack`);
      continue;
    }
    const form = new FormData();
    const slug = s.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    form.append("file", new Blob([bidDocument(t, s)], { type: "text/markdown" }), `bid-${slug}.md`);
    const put = await fetch(`${BASE}/api/tenders/${t.ref}/docs`, { method: "POST", headers: { cookie: officer }, body: form });
    const body = (await put.json().catch(() => ({}))) as any;
    if (!put.ok || body.staged !== true) {
      warn(`${s.name}: bid document not staged (${put.status}) ${JSON.stringify(body).slice(0, 180)}`);
      continue;
    }
    ok(`${s.name}: bid document staged as ${body.files?.[0] ?? body.key}`);
  }
}

async function buildMatrix(t: Tender, officer: Cookie) {
  log(`\n▸ ${t.ref} — evaluation matrix`);
  const res = await call(`/api/tenders/${t.ref}/matrix${JP}`, {
    cookie: officer,
    body: { technicalWeightPct: t.technicalWeightPct, criteria: t.criteria.map(({ title, weight }) => ({ title, weight })) },
  });
  if (res.status === 201) {
    ok(`matrix ${res.data.matrix?.id ?? ""} built from the issued notice (${t.criteria.length} criteria)`);
    return;
  }
  if (/already exists/i.test(JSON.stringify(res.data))) {
    skip("matrix already on record — the published basis is immutable");
    return;
  }
  warn(`matrix not built (${res.status}) ${JSON.stringify(res.data).slice(0, 240)}`);
}

async function launchReview(t: Tender, officer: Cookie) {
  log(`\n▸ ${t.ref} — review run`);
  const runs = await call(`/api/runs${JP}`, { cookie: judge });
  const existing = (runs.data.runs ?? []).find((r: any) => r.tenderId === t.ref);
  if (existing && existing.status !== "FAILED") {
    skip(`run already on record (${existing.id}, ${existing.status}${existing.gateId ? `, gate ${existing.gateId}` : ""})`);
    return existing;
  }
  const launched = await call(`/api/runs${JP}`, {
    cookie: officer,
    body: {
      tenderId: t.ref,
      detail: {
        buyer: t.buyer,
        currency: t.currency,
        ceiling: t.ceiling,
        method: "Open competitive selection (national)",
        publishedDate: "2026-12-01",
        deadlineDate: t.closing.slice(0, 10),
        noticeRef: t.ref,
        category: t.category,
        specification: t.specification,
        awardCriteria: "Technical compliance and delivery capacity scored against the published matrix; lowest evaluated price among compliant bids.",
        evaluationChecks: ["Tax compliance certificate", "Statutory registration", "Technical compliance schedule", "Delivery plan"],
      },
    },
  });
  if (launched.status !== 201 && launched.status !== 200) {
    warn(`launch refused (${launched.status}) ${JSON.stringify(launched.data).slice(0, 260)}`);
    return null;
  }
  const run = launched.data.run ?? launched.data;
  ok(`review launched (${run.id}) by ${OFFICER.email}`);

  const deadline = Date.now() + 240_000;
  let latest: any = run;
  while (Date.now() < deadline) {
    const list = await call(`/api/runs${JP}`, { cookie: judge });
    latest = (list.data.runs ?? []).find((r: any) => r.id === run.id) ?? latest;
    if (latest.status === "AWAITING_GATE" || latest.status === "FAILED") break;
    await sleep(2000);
  }
  if (latest.status === "AWAITING_GATE" && latest.gateId) ok(`stopped at the human-approval gate (${latest.gateId}) with ${latest.findings?.length ?? 0} findings`);
  else warn(`run status ${latest.status}${latest.error ? ` — ${latest.error}` : ""}`);
  return latest;
}

/* ── run ────────────────────────────────────────────────────────────────── */

log(`Quorum demo seed → ${BASE}`);
judge = await login(JUDGE.email, JUDGE.password);
ok(`signed in as ${JUDGE.email}`);
const officer = await login(OFFICER.email, OFFICER.password);
ok(`signed in as ${OFFICER.email} (prepares reviews so four eyes holds at approval)`);

for (const tender of TENDERS) {
  await planTender(tender);
  await seedSuppliers(tender);
  await draftNotice(tender, officer);
  await normalisePack(tender, officer);
}

for (const tender of TENDERS) {
  await buildMatrix(tender, officer);
}

for (const tender of TENDERS) {
  await launchReview(tender, officer);
}

log("\n▸ final state");
const gates = await call(`/api/gates${JP}`, { cookie: judge });
const pending: any[] = (gates.data.gates ?? []).filter((g: any) => g.status === "PENDING" || g.status === "AWAITING_SECOND");
for (const gate of pending) log(`  · gate ${gate.id} · ${gate.tenderId} · ${gate.tool} · ${gate.status}`);
const market = await call(`/api/marketplace${JP}`, { cookie: judge });
for (const tender of TENDERS) {
  const row = (market.data.tenders ?? []).find((r: any) => r.ref === tender.ref);
  log(`  · ${tender.ref}: ${row?.applications ?? 0} bids on record · ${row?.status ?? "?"}`);
}
log("\nDone. Sign in as chungu424@gmail.com (the single accounting-officer approver) and approve from Approvals.");

export {};
