# Live e-GP / registry — concrete blocker (recorded 2026-11-11)

## What is wired
- `src/lib/connectors.ts`: `HttpEgpAdapter` posts to `$EGP_API_URL/submissions`
  with `$EGP_API_TOKEN`, and fails closed on missing URL, non-2xx, or a reply
  with no `reference`. `createEgpAdapter()` picks it only when `EGP_API_URL` is set.
- `src/lib/persisted-features.ts`: `submitEgpPersisted()` stores every receipt
  in the web store (`egp-receipt:<tenderRef>:<action>`); `checkSupplierInStore()`
  screens against the live organization register (`listOrganizations()`).
- `src/app/api/oversight/metrics/route.ts` surfaces adapter name, simulated
  flag, this blocker text, receipt count, and registry size in the dashboard.

## Blocker
No live national e-GP endpoint or credential exists in this deployment:
- `EGP_API_URL` / `EGP_API_TOKEN` are absent from `.env.example` (now documented
  there) and from `.env.local` (0 matches, checked 2026-11-11).
- The sidecar agrees: `createEgpAdapter()` in
  `mini-services/quorum-mcp/egp-adapter.ts` throws for any non-`simulated`
  adapter — "No live e-GP adapter is installed".

## To go live
1. Obtain the portal's submission endpoint + service token from the national
   e-GP operator (ZPPA e-GP for Zambia).
2. Set `EGP_API_URL` and `EGP_API_TOKEN` in the web server environment.
3. Re-run the gate-filing flow; receipts will persist with `simulated: false`.
   Until then every receipt is labelled simulated and never claims filing.
