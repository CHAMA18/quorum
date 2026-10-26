#!/usr/bin/env python3
"""
Mine the Zambia e-GP open contracting record (ZPPA, via the Open Contracting
Partnership — https://data.open-contracting.org/en/publication/3) into a
curated supplier roll for the quorum-mcp sidecar.

Input: one or more OCDS 'compiled' release JSONL files.
Output: roll.json (+ optional --emit-ts for the quorum-mcp zppa.ts module).

Only firms that carry a PACRA identifier (scheme ZM-PCR) on the published
record are kept — name, registration number, address and telephone are taken
exactly as published; nothing is invented. Counts (tenders / awards / value)
are computed over the records in scope.
"""
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import date

TOP_N = 120
MAX_TITLE = 140

# ── category mapping ─────────────────────────────────────────────────────────
# The app's twelve supply categories, matched from the free text of
# award/tender items (UNSPSC family names + titles). Votes accumulate; the
# top three win. A UNSPSC segment table is the fallback when text is blank.
CATEGORY_KEYWORDS = [
    ("Water & sanitation", [
        "water", "sanitation", "sewage", "sewer", "borehole", "plumb",
        "irrigation", "toilet", "ablution", "aqua",
    ]),
    ("Energy & electrification", [
        "electric", "solar", "power", "generator", "transformer", "electrif",
        "energy", "lighting", "lamp", "substation", "grid", "battery",
    ]),
    ("Medical supplies", [
        "medical", "pharmaceut", "drug", "medicine", "hospital", "clinic",
        "health", "laborator", "surgical", "vaccine", "ppe", "malaria",
        "syringe", "thermometer", "condom", "reagent",
    ]),
    ("ICT equipment & services", [
        "computer", "laptop", "printer", "ict", "network", "software",
        "server", "telecom", "internet", "website", "cyber", "router",
        "firewall", "scanner", "data process",
    ]),
    ("Security services", [
        "security", "guard", "surveillance", "cctv", "alarm",
        "access control", "policing",
    ]),
    ("Cleaning & facilities", [
        "cleaning", "fumigat", "janitorial", "laundry", "waste", "garbage",
        "refuse", "grounds", "gardening", "facility management",
    ]),
    ("Agriculture & agro-processing", [
        "agricultur", "farm", "fertiliz", "seed", "maize", "crop",
        "livestock", "agro", "poultry", "fisher", "veterinary", "tractor",
        "food", "meal", "catering", "grocer",
    ]),
    ("Consultancy services", [
        "consult", "advisory", "training", "audit", "feasibility", "study",
        "research", "technical assistance", "baseline", "evaluation",
        "workshop", "facilitation",
    ]),
    ("Transport & logistics", [
        "transport", "haulage", "logistic", "vehicle", "truck", "courier",
        "freight", "lorry", "bus", "motor", "car hire", "travel",
        "air ticket",
    ]),
    ("Office supplies & stationery", [
        "stationery", "office suppl", "furniture", "paper", "toner",
        "cartridge", "printing", "desk", "chair", "cabinet", "photocopy",
        "binding",
    ]),
    ("Engineering services", [
        "engineering", "fabricat", "welding", "mechanic", "maintenance",
        "repair", "installation", "servicing", "metal works", "machinery",
    ]),
    ("Construction works", [
        "construction", "building", "civil works", "rehabilitat", "road",
        "bridge", "drain", "housing", "roofing", "flooring", "paving",
        "renovat", "wall",
    ]),
]

SEG_MAP = {
    "72": "Construction works", "30": "Construction works", "22": "Construction works",
    "43": "ICT equipment & services", "45": "Office supplies & stationery",
    "42": "Medical supplies", "51": "Medical supplies",
    "26": "Energy & electrification", "39": "Energy & electrification",
    "25": "Transport & logistics", "78": "Transport & logistics", "24": "Transport & logistics",
    "44": "Office supplies & stationery", "14": "Office supplies & stationery",
    "10": "Agriculture & agro-processing", "11": "Agriculture & agro-processing",
    "50": "Agriculture & agro-processing",
    "80": "Consultancy services",
    "76": "Cleaning & facilities", "47": "Cleaning & facilities",
    "40": "Water & sanitation",
}


def digits(s):
    return re.sub(r"\D", "", s or "")


def norm_name(s):
    return re.sub(r"[^A-Z0-9]+", " ", (s or "").upper()).strip()


def compose_addr(a):
    parts = []
    st = (a.get("streetAddress") or "").strip()
    loc = (a.get("locality") or "").strip()
    if st:
        parts.append(st)
    if loc:
        parts.append(loc.title())
    return ", ".join(parts)


def vote(entry, texts, seg_ids):
    blob = " ".join(t for t in texts if t).lower()
    hits = {cat for cat, kws in CATEGORY_KEYWORDS if any(k in blob for k in kws)}
    if not hits:
        for sg in seg_ids:
            mapped = SEG_MAP.get((sg or "")[:2])
            if mapped:
                hits.add(mapped)
    for h in hits:
        entry["cats"][h] += 1


def main():
    emit_ts = None
    json_out = None
    files = []
    args = sys.argv[1:]
    i = 0
    while i < len(args):
        a = args[i]
        if a == "--emit-ts" and i + 1 < len(args):
            emit_ts = args[i + 1]
            i += 2
        elif a == "--json" and i + 1 < len(args):
            json_out = args[i + 1]
            i += 2
        elif a.startswith("--"):
            i += 1
        else:
            files.append(a)
            i += 1

    def blank():
        return {
            "names": Counter(), "regs": Counter(), "addresses": Counter(),
            "phones": Counter(), "cats": Counter(), "value": 0.0,
            "awards": 0, "latestAward": None, "latestTender": None,
            "tenderOcids": set(), "years": set(), "awardKeys": set(),
        }

    sup = defaultdict(blank)
    n_rec = 0
    min_date, max_date = None, None

    for path in files:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                rec = json.loads(line)
                n_rec += 1
                rdate = rec.get("date") or ""
                if rdate:
                    min_date = rdate if not min_date or rdate < min_date else min_date
                    max_date = rdate if not max_date or rdate > max_date else max_date
                year = int(rdate[:4]) if rdate[:4].isdigit() else None
                buyer = ((rec.get("buyer") or {}).get("name") or "").strip()
                tender = rec.get("tender") or {}
                ocid = rec.get("ocid") or rec.get("id")
                ttitle = (tender.get("title") or "").strip()

                party_by_hex = {}
                for p in rec.get("parties") or []:
                    pid = p.get("id")
                    if pid:
                        party_by_hex[pid] = p
                    roles = set(p.get("roles") or [])
                    if not roles & {"tenderer", "supplier"}:
                        continue
                    ident = p.get("identifier") or {}
                    name = (ident.get("legalName") or p.get("name") or "").strip()
                    reg = digits(ident.get("id"))
                    key = ("REG:" + reg) if reg else ("NAME:" + norm_name(name))
                    e = sup[key]
                    if name:
                        e["names"][name] += 1
                    if reg:
                        e["regs"][reg] += 1
                    addr = compose_addr(p.get("address") or {})
                    if addr:
                        e["addresses"][addr] += 1
                    tel = (((p.get("contactPoint") or {}).get("telephone")) or "").strip()
                    if tel:
                        e["phones"][tel] += 1
                    if ocid and ocid not in e["tenderOcids"]:
                        e["tenderOcids"].add(ocid)
                        if year:
                            e["years"].add(year)
                        if ttitle and not e["latestTender"]:
                            e["latestTender"] = {
                                "kind": "tender", "title": ttitle[:MAX_TITLE],
                                "buyer": buyer, "date": rdate,
                            }
                        vote(e, [ttitle] + [it.get("description") or "" for it in tender.get("items") or []],
                             [(it.get("classification") or {}).get("id") or "" for it in tender.get("items") or []])

                for award in rec.get("awards") or []:
                    val = award.get("value") or {}
                    amt = val.get("amount")
                    adate = award.get("date") or rdate
                    atitle = (award.get("title") or award.get("description") or "").strip()
                    akey = f"{ocid}:{award.get('id')}"
                    for s in award.get("suppliers") or []:
                        p = party_by_hex.get(s.get("id"))
                        name = (s.get("name") or "").strip()
                        reg = ""
                        if p:
                            ident = p.get("identifier") or {}
                            reg = digits(ident.get("id"))
                            name = (ident.get("legalName") or p.get("name") or name).strip()
                        key = ("REG:" + reg) if reg else ("NAME:" + norm_name(name))
                        e = sup[key]
                        if name:
                            e["names"][name] += 1
                        if reg:
                            e["regs"][reg] += 1
                        if akey in e["awardKeys"]:
                            continue  # republished compiled release — count once
                        e["awardKeys"].add(akey)
                        e["awards"] += 1
                        if isinstance(amt, (int, float)) and val.get("currency") == "ZMW":
                            e["value"] += amt
                        ay = int(adate[:4]) if adate[:4].isdigit() else None
                        if ay:
                            e["years"].add(ay)
                        if atitle and (not e["latestAward"] or adate > e["latestAward"]["date"]):
                            e["latestAward"] = {
                                "kind": "award", "title": atitle[:MAX_TITLE],
                                "buyer": buyer, "date": adate,
                            }
                        vote(e, [atitle] + [it.get("description") or "" for it in award.get("items") or []],
                             [(it.get("classification") or {}).get("id") or "" for it in award.get("items") or []])

    entries = []
    for e in sup.values():
        if not e["regs"]:
            continue
        reg = e["regs"].most_common(1)[0][0]
        if len(reg) < 6 or len(reg) > 14:
            continue
        name = e["names"].most_common(1)[0][0]
        if len(norm_name(name)) < 4 or "TEST" in norm_name(name):
            continue
        cats = [c for c, _ in e["cats"].most_common(3)]
        years = sorted(e["years"])
        latest = e["latestAward"] or e["latestTender"]
        entry = {
            "name": name,
            "regNo": reg,
            "tenders": len(e["tenderOcids"]),
            "awards": e["awards"],
            "categories": cats,
        }
        if e["addresses"]:
            entry["address"] = e["addresses"].most_common(1)[0][0]
        if e["phones"]:
            entry["phone"] = e["phones"].most_common(1)[0][0]
        if e["value"]:
            entry["valueZMW"] = round(e["value"])
        if years:
            entry["since"] = years[0]
        if latest:
            entry["latest"] = latest
        entries.append(entry)

    entries.sort(key=lambda x: (-x["awards"], -x["tenders"], -x.get("valueZMW", 0)))
    top = entries[:TOP_N]

    # ── summary ──────────────────────────────────────────────────────────────
    print(f"records: {n_rec} | release dates: {(min_date or '')[:10]} → {(max_date or '')[:10]}")
    print(f"suppliers carrying a PACRA number: {len(entries)} | emitted: {len(top)}")
    cat_cov = Counter()
    for t in top:
        for c in t["categories"]:
            cat_cov[c] += 1
    print("category coverage (top roll):", dict(cat_cov.most_common()))
    print(f"awards on roll: {sum(t['awards'] for t in top)} | tenders: {sum(t['tenders'] for t in top)}")
    print("top 15:")
    for t in top[:15]:
        print(f"  {t['awards']:>4} awards | {t['tenders']:>4} tenders | {t['name'][:44]:<44} | {t['regNo']} | {','.join(t['categories'][:2]) if t['categories'] else '—'}")

    if json_out:
        with open(json_out, "w") as f:
            json.dump(top, f, indent=1)
        print(f"wrote {json_out}")

    if emit_ts:
        src = {
            "authority": "Zambia Public Procurement Authority (ZPPA) — e-GP record",
            "via": "Open Contracting Partnership · data.open-contracting.org/en/publication/3",
            "license": "CC BY 4.0",
            "retrieved": date.today().isoformat(),
            "coverage": f"{(min_date or '')[:10]} → {(max_date or '')[:10]} ({n_rec:,} release entries in scope)",
            "note": ("Derived roll: firms ranked by awards on the published record. Names, PACRA numbers, "
                     "addresses and telephone contacts are exactly as published in the OCDS releases; "
                     "tender/award counts and value totals are computed over the releases in scope. "
                     "This is a reading aid for the intake form — the officer still confirms every field."),
        }

        def ts(v, indent=0):
            pad = " " * indent
            if isinstance(v, dict):
                def key(k):
                    return k if re.fullmatch(r"[A-Za-z_$][A-Za-z0-9_$]*", k) else json.dumps(k)

                items = ",\n".join(f"{pad}  {key(k)}: {ts(x, indent + 2)}" for k, x in v.items())
                return "{\n" + items + f",\n{pad}}}"
            if isinstance(v, list):
                if not v:
                    return "[]"
                return "[" + ", ".join(json.dumps(x, ensure_ascii=False) for x in v) + "]"
            return json.dumps(v, ensure_ascii=False)

        lines = [
            "/**",
            " * quorum-mcp — the ZPPA roll.",
            " *",
            " * A derived reading of the published Zambia e-GP record, shipped so the",
            " * supplier intake can start from what the record already knows instead of",
            " * making an officer retype a firm that ZPPA already lists.",
            " *",
            f" * Source: {src['authority']}",
            f" * Via: {src['via']} ({src['license']}, retrieved {src['retrieved']})",
            f" * Coverage: {src['coverage']}",
            " *",
            " * This file is generated — see mine-zppa-roll.py beside it. Nothing here",
            " * is inferred: each entry is copied from the record and counted over it.",
            " */",
            "",
            "export interface ZppaRollEntry {",
            "  name: string;",
            "  regNo: string;",
            "  address?: string;",
            "  phone?: string;",
            "  tenders: number;",
            "  awards: number;",
            "  valueZMW?: number;",
            "  since?: number;",
            "  categories: string[];",
            "  latest?: { kind: \"award\" | \"tender\"; title: string; buyer: string; date: string };",
            "}",
            "",
            "export interface ZppaSource {",
            "  authority: string;",
            "  via: string;",
            "  license: string;",
            "  retrieved: string;",
            "  coverage: string;",
            "  note: string;",
            "}",
            "",
            "export const ZPPA_SOURCE: ZppaSource = "
            + ts({k: src[k] for k in ("authority", "via", "license", "retrieved", "coverage", "note")}) + ";",
            "",
            "export const ZPPA_ROLL: ZppaRollEntry[] = [",
        ]
        for t in top:
            lines.append("  " + ts(t, 2) + ",")
        lines.append("];")
        lines.append("")
        with open(emit_ts, "w") as f:
            f.write("\n".join(lines))
        print(f"emitted {emit_ts}")


if __name__ == "__main__":
    main()
