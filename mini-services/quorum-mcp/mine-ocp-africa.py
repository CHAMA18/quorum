#!/usr/bin/env python3
"""
Read the OCP Data Registry (https://data.open-contracting.org/en/search/)
and emit the quorum-mcp registry snapshots:

  ocp-africa.ts   — every African dataset the registry lists
  ocp-global.ts   — every non-African dataset the registry lists
  data/ocp-registry.json — the same rows, read by the live sidecar

Input:  the registry's search page (all datasets, server-rendered), each
        dataset's publication page — both its dt/dd record and its
        schema.org JSON-LD block (exact coverage dates, retrieval date,
        licence, download formats and sizes).
Output: the two TypeScript snapshots beside this script, plus the JSON
        snapshot consumed at runtime (so an automatic refresh needs no
        rebuild).

Every field is copied from the registry's own pages; nothing is inferred.
Counts are the registry's own "Count of …" figures. A dataset the publisher
has stopped updating is flagged exactly as the registry flags it.
"""
import argparse
import json
import os
import re
import sys
import tempfile
import time
import urllib.request
from html import unescape

REGISTRY = "https://data.open-contracting.org"
SEARCH = f"{REGISTRY}/en/search/"
RETRIEVED = time.strftime("%Y-%m-%d")
SERVICE_DIR = os.path.dirname(os.path.abspath(__file__))
AFRICA_TS = os.path.join(SERVICE_DIR, "ocp-africa.ts")
GLOBAL_TS = os.path.join(SERVICE_DIR, "ocp-global.ts")
DEFAULT_JSON = os.path.join(SERVICE_DIR, "data", "ocp-registry.json")
CACHE = os.path.join(tempfile.gettempdir(), "quorum-ocp-cache")

# African sovereign states, matched against the registry's country names.
AFRICA = {
    "Algeria", "Angola", "Benin", "Botswana", "Burkina Faso", "Burundi",
    "Cabo Verde", "Cameroon", "Central African Republic", "Chad", "Comoros",
    "Congo", "Democratic Republic of the Congo", "Djibouti", "Egypt",
    "Equatorial Guinea", "Eritrea", "Eswatini", "Ethiopia", "Gabon",
    "Gambia", "Ghana", "Guinea", "Guinea-Bissau", "Ivory Coast", "Kenya",
    "Lesotho", "Liberia", "Libya", "Madagascar", "Malawi", "Mali",
    "Mauritania", "Mauritius", "Morocco", "Mozambique", "Namibia", "Niger",
    "Nigeria", "Rwanda", "Sao Tome and Principe", "Senegal", "Seychelles",
    "Sierra Leone", "Somalia", "South Africa", "South Sudan", "Sudan",
    "Tanzania", "Togo", "Tunisia", "Uganda", "Zambia", "Zimbabwe",
}

DOWNLOAD_LABELS = {
    "text/csv": "CSV",
    "application/jsonlines": "JSONL",
    "application/json": "JSON",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
}

MONTH_NO = {m: i + 1 for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"])}

NOTE = (
    "Coverage dates, retrieval dates, formats and sizes are taken from the "
    "registry's own record; counts are its published \"Count of …\" figures. "
    "A dataset the publisher stopped updating is flagged, never hidden."
)
LICENSE_NOTE = (
    "Each dataset keeps the licence its publisher states on the registry; "
    "where none is stated the registry shows ‘—’."
)


def strip(s: str) -> str:
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", " ", s))).strip()


def get(url: str) -> str:
    """Fetch with an on-disk cache so reruns do not hammer the registry."""
    os.makedirs(CACHE, exist_ok=True)
    name = re.sub(r"[^a-z0-9]+", "_", url.lower()).strip("_")[:120] + ".html"
    path = os.path.join(CACHE, name)
    if os.path.exists(path) and time.time() - os.path.getmtime(path) < 6 * 3600:
        return open(path, encoding="utf-8").read()
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (quorum registry sync)"})
    with urllib.request.urlopen(req, timeout=45) as r:
        html = r.read().decode("utf-8", "replace")
    open(path, "w", encoding="utf-8").write(html)
    return html


def parse_search(html: str) -> list[dict]:
    """One row per dataset on the registry's search page."""
    cards = re.split(r"<article\b", html)[1:]
    rows = []
    for c in cards:
        m = re.search(r'<h3 class="h2">(.*?)</h3>', c, re.S)
        if not m:
            continue
        title = strip(m.group(1))
        country, _, publisher = title.partition(":")
        country, publisher = country.strip(), publisher.strip()

        m = re.search(r"/static/img/flags/([a-z]{2})\.", c)
        iso = m.group(1).upper() if m else ""

        m = re.search(r'href="/en/publication/(\d+)"', c)
        pub_id = int(m.group(1)) if m else None

        m = re.search(r"Data date range:.*?<dd>\s*(.*?)\s*</dd>", c, re.S)
        range_text = strip(m.group(1)) if m else ""
        stale = "no longer updated" in range_text.lower()
        range_text = re.sub(r"\s*\(This dataset is no longer updated by the publisher\)", "", range_text).strip()

        m = re.search(r"Update frequency:\s*</dt>\s*<dd>(.*?)</dd>", c, re.S)
        freq = strip(m.group(1)) if m else ""
        freq = None if freq in ("", "-", "Unknown") else freq

        m = re.search(r"Last retrieved:\s*</dt>\s*<dd>\s*(.*?)\s*</dd>", c, re.S)
        retrieved = strip(m.group(1)) if m else ""
        retrieved_month = retrieved.split("(")[0].strip()
        note = re.search(r"\(([^)]+)\)", retrieved)
        retrieved_note = note.group(1).strip() if note else None

        formats = [strip(x) for x in re.findall(r'<dd class="d-inline-block[^"]*">(.*?)</dd>', c, re.S)]
        formats = [f for f in formats if f]

        rows.append({
            "country": country, "iso": iso, "publisher": publisher,
            "publicationId": pub_id,
            "listingRange": range_text, "stale": stale,
            "updateFrequency": freq,
            "listingRetrieved": retrieved_month,
            "retrievedNote": retrieved_note,
            "formats": formats,
        })
    return rows


def month_of(iso: str) -> str:
    """\"2026-05-29\" → \"May 2026\" — to cross-check against the listing."""
    m = re.match(r"(\d{4})-(\d{2})", iso or "")
    months = list(MONTH_NO)
    return f"{months[int(m.group(2)) - 1]} {m.group(1)}" if m else ""


def enrich(row: dict, warnings: list[str]) -> dict:
    """Add the publication page's own facts: its dt/dd record and JSON-LD."""
    url = f"{REGISTRY}/en/publication/{row['publicationId']}"
    html = get(url)
    d = {**row, "registryUrl": url}

    # ── the schema.org record — exact dates, licence, downloads ─────────────
    m = re.search(r'<script type="application/ld\+json">\s*(\{.*?\})\s*</script>', html, re.S)
    ld = json.loads(m.group(1)) if m else {}
    span = (ld.get("temporalCoverage") or "").split("/")
    d["coverageFrom"] = span[0] if span and span[0] else ""
    d["coverageTo"] = span[1] if len(span) > 1 else ""
    # dateModified is when the registry last touched its record — NOT when it
    # last pulled data from the publisher. Both are kept, clearly named.
    d["recordModified"] = (ld.get("dateModified") or "")[:10] or None
    d["language"] = ld.get("inLanguage")
    # The licence as the registry displays it on its record row — a name, or a
    # URL where the publisher points at its own terms — plus the link target.
    m = re.search(r"<dt>License:</dt>\s*<dd[^>]*>(.*?)</dd>", html, re.S)
    lic_html = m.group(1) if m else ""
    # The dd can nest an expandable "permissions and conditions" block — the
    # licence line itself is what precedes it.
    lic_text = strip(lic_html.split("<div", 1)[0])
    d["license"] = None if lic_text in ("", "-") else lic_text
    lic_ld = (ld.get("license") or "").strip()
    d["licenseUrl"] = lic_ld if lic_ld.startswith("http") else (lic_text if lic_text.startswith("http") else None)
    d["downloads"] = [
        {
            "format": DOWNLOAD_LABELS.get(x.get("encodingFormat", ""), x.get("encodingFormat", "")),
            "size": (x.get("contentSize") or "").replace("\u00a0", " ").strip(),
            "url": x.get("contentUrl", ""),
        }
        for x in ld.get("distribution", [])
    ]

    # ── the dt/dd record — retrieval, source URL, policy, prefix, counts ────
    # "Last retrieved: Feb 9, 2026 (retrieved monthly)" → day-precise ISO date.
    m = re.search(r"<dt>Last retrieved:</dt>\s*<dd[^>]*>(.*?)</dd>", html, re.S)
    retr = strip(m.group(1)) if m else ""
    dm = re.match(r"([A-Z][a-z]{2}) (\d{1,2}), (\d{4})", retr)
    d["lastRetrieved"] = f"{dm.group(3)}-{MONTH_NO[dm.group(1)]:02d}-{int(dm.group(2)):02d}" if dm else ""
    note = re.search(r"\(([^)]+)\)", retr)
    d["retrievedNote"] = note.group(1).strip() if note else None

    m = re.search(r'<dt>Publication policy:</dt>\s*<dd[^>]*>\s*<a href="([^"]+)"', html, re.S)
    d["policyUrl"] = m.group(1) if m else None
    m = re.search(r'<dt>OCID prefix:</dt>\s*<dd[^>]*>([^<]+)', html)
    d["ocidPrefix"] = strip(m.group(1)) if m else None

    # The publisher's own source page — the linked value on the row above License.
    m = re.search(r'<dd[^>]*>\s*<a href="(http[^"]+)"[^>]*>[^<]*</a>\s*</dd>\s*<dt>License:</dt>', html, re.S)
    d["portalUrl"] = m.group(1) if m else None

    counts = {}
    for cm in re.finditer(r"Count of ([a-z ]+?):\s*([\d,]+)", strip(html)):
        key = cm.group(1).strip().replace(" ", "_")
        counts[key] = counts.get(key, 0) + int(cm.group(2).replace(",", ""))
    d["counts"] = counts

    # ── cross-checks: the listing and the machine record must agree ─────────
    if d["coverageFrom"] and month_of(d["coverageFrom"]) != d["listingRange"].split(" - ")[0]:
        warnings.append(f"{d['publisher']}: coverage start {d['coverageFrom']} vs listing '{d['listingRange']}'")
    if d["coverageTo"] and month_of(d["coverageTo"]) != d["listingRange"].split(" - ")[-1]:
        warnings.append(f"{d['publisher']}: coverage end {d['coverageTo']} vs listing '{d['listingRange']}'")
    if d["lastRetrieved"] and month_of(d["lastRetrieved"]) != d["listingRetrieved"]:
        warnings.append(f"{d['publisher']}: retrieved {d['lastRetrieved']} vs listing '{d['listingRetrieved']}'")
    return d


def write_atomic(path: str, text: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(text)
    os.replace(tmp, path)


def source_for(scope: str) -> dict:
    return {
        "registry": "OCP Data Registry — Open Contracting Partnership",
        "via": SEARCH,
        "retrieved": RETRIEVED,
        "scope": scope,
        "licenseNote": LICENSE_NOTE,
        "note": NOTE,
    }


ORDER = [
    "country", "iso", "publisher", "publicationId", "registryUrl", "portalUrl",
    "policyUrl", "coverageFrom", "coverageTo", "stale", "updateFrequency",
    "lastRetrieved", "recordModified", "retrievedNote", "downloads", "license",
    "licenseUrl", "language", "ocidPrefix", "counts",
]


def rows_ts(rows: list[dict]) -> str:
    lines = []
    for r in sorted(rows, key=lambda x: (x["country"], x["publisher"])):
        payload = {k: r.get(k) for k in ORDER}
        lines.append("  " + json.dumps(payload, ensure_ascii=False) + ",")
    return "\n".join(lines)


def emit_africa_ts(rows: list[dict], total: int) -> None:
    countries = sorted({r["country"] for r in rows})
    source = source_for(f"{total} datasets listed registry-wide; {len(rows)} African datasets across {len(countries)} countries")
    header = f"""/**
 * quorum-mcp — the OCP Data Registry, read for Africa.
 *
 * Every African dataset the Open Contracting Partnership's Data Registry
 * lists — the registries, portals and treasuries an officer can actually
 * check a bidder, a price or a record against.
 *
 * Source: OCP Data Registry — {SEARCH}
 * Retrieved: {RETRIEVED} · {total} datasets listed registry-wide;
 * {len(rows)} are African, across {len(countries)} countries ({", ".join(countries)}).
 *
 * This file is generated — see mine-ocp-africa.py beside it. Every field is
 * copied from the registry's own pages: coverage spans, licence, language,
 * download formats and sizes come from each dataset's schema.org record;
 * the last-retrieved date, counts and OCID prefix come from the registry's
 * record rows. A dataset the publisher stopped updating keeps the registry's
 * own flag (`stale`), never a silent pass.
 */

export interface OcpAfricaDownload {{
  format: string;
  size: string;
  url: string;
}}

export interface OcpAfricaDataset {{
  country: string;
  iso: string;
  publisher: string;
  publicationId: number;
  registryUrl: string;
  portalUrl: string | null;
  policyUrl: string | null;
  coverageFrom: string;
  coverageTo: string;
  stale: boolean;
  updateFrequency: string | null;
  lastRetrieved: string;
  recordModified: string | null;
  retrievedNote: string | null;
  downloads: OcpAfricaDownload[];
  license: string | null;
  licenseUrl: string | null;
  language: string | null;
  ocidPrefix: string | null;
  counts: Record<string, number>;
}}

export interface OcpAfricaSource {{
  registry: string;
  via: string;
  retrieved: string;
  scope: string;
  licenseNote: string;
  note: string;
}}

export const OCP_AFRICA_SOURCE: OcpAfricaSource = {json.dumps(source, ensure_ascii=False, indent=2)};

export const OCP_AFRICA: OcpAfricaDataset[] = [
{rows_ts(rows)}
];
"""
    write_atomic(AFRICA_TS, header)
    print(f"emitted {AFRICA_TS} — {len(rows)} datasets across {len(countries)} countries")


def emit_global_ts(rows: list[dict], total: int) -> None:
    countries = sorted({r["country"] for r in rows})
    source = source_for(f"{total} datasets listed registry-wide; {len(rows)} non-African datasets across {len(countries)} countries")
    header = f"""/**
 * quorum-mcp — the OCP Data Registry beyond Africa.
 *
 * Every non-African dataset the Open Contracting Partnership's Data Registry
 * lists — the international and cross-border jurisdictions a supplier can be
 * checked against, kept separate from the African desk.
 *
 * Source: OCP Data Registry — {SEARCH}
 * Retrieved: {RETRIEVED} · {total} datasets listed registry-wide;
 * {len(rows)} are non-African, across {len(countries)} countries and regions.
 *
 * This file is generated — see mine-ocp-africa.py beside it. It shares the
 * exact record shape and provenance rules as ocp-africa.ts: every field is
 * copied from the registry's own pages, and a dataset the publisher stopped
 * updating keeps the registry's own `stale` flag.
 */

import type {{ OcpAfricaDataset, OcpAfricaSource }} from "./ocp-africa";

export const OCP_GLOBAL_SOURCE: OcpAfricaSource = {json.dumps(source, ensure_ascii=False, indent=2)};

export const OCP_GLOBAL: OcpAfricaDataset[] = [
{rows_ts(rows)}
];
"""
    write_atomic(GLOBAL_TS, header)
    print(f"emitted {GLOBAL_TS} — {len(rows)} datasets across {len(countries)} countries")


def main() -> None:
    parser = argparse.ArgumentParser(description="Refresh the OCP Data Registry snapshots")
    parser.add_argument("--json-out", default=DEFAULT_JSON, help="path for the runtime JSON snapshot")
    parser.add_argument("--skip-ts", action="store_true", help="write only the JSON snapshot")
    args = parser.parse_args()

    search_html = get(SEARCH)
    all_rows = parse_search(search_html)
    total = len(all_rows)
    africa_rows = [r for r in all_rows if r["country"] in AFRICA]
    global_rows = [r for r in all_rows if r["country"] not in AFRICA]
    print(f"registry lists {total} datasets; {len(africa_rows)} African, {len(global_rows)} non-African", file=sys.stderr)
    if not africa_rows or not global_rows:
        sys.exit("registry markup changed — expected both African and non-African datasets")

    warnings: list[str] = []
    enriched_africa = []
    enriched_global = []
    for i, r in enumerate(africa_rows + global_rows):
        d = enrich(r, warnings)
        (enriched_africa if r["country"] in AFRICA else enriched_global).append(d)
        c = d["counts"]
        print(f"[{i + 1:3}/{total}] {d['country']:14} {d['publisher'][:42]:42} "
              f"{d['coverageFrom']}→{d['coverageTo']} retr={d['lastRetrieved']} "
              f"tenders={c.get('tenders', 0):>8} awards={c.get('awards', 0):>8} stale={d['stale']}", file=sys.stderr)

    for w in warnings:
        print(f"WARN (listing vs record): {w}", file=sys.stderr)

    africa_countries = sorted({r["country"] for r in enriched_africa})
    global_countries = sorted({r["country"] for r in enriched_global})
    payload = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "retrieved": RETRIEVED,
        "registryTotal": total,
        "africa": {
            "source": source_for(f"{total} datasets listed registry-wide; {len(enriched_africa)} African datasets across {len(africa_countries)} countries"),
            "datasets": sorted(enriched_africa, key=lambda x: (x["country"], x["publisher"])),
        },
        "global": {
            "source": source_for(f"{total} datasets listed registry-wide; {len(enriched_global)} non-African datasets across {len(global_countries)} countries"),
            "datasets": sorted(enriched_global, key=lambda x: (x["country"], x["publisher"])),
        },
    }
    write_atomic(args.json_out, json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    print(f"emitted {args.json_out} — {len(enriched_africa)} African + {len(enriched_global)} non-African datasets")

    if not args.skip_ts:
        emit_africa_ts(enriched_africa, total)
        emit_global_ts(enriched_global, total)


if __name__ == "__main__":
    main()
