# Current demonstration

Use the revised 180-second edition in `demo-video/quorum-recordings/`. It uses 122 seconds of actual supplier, bid-review and committee recordings. Earlier illustrative records are labelled separately from the current fictional Zambia production integration.

1. Install dependencies with Bun and configure an approved Meta endpoint.
2. Run `bun run build`; TypeScript errors fail this build.
3. Run `bash scripts/judge-demo.sh --production`. It refuses occupied ports 3100/3131, creates temporary data and signing keys, and starts the built app.
4. Inspect `SUBMISSION/evidence/current-run/proof.json`: unsigned 401, missing-step-up 403, pending/no receipt, and finally the verified simulated receipt.
5. For a model-free run, add `--template`; the advisory is skipped and the drafts must be labelled as templates.

The automated approval uses fictional authorised accounts. It is not a real committee signing a government tender. No national portal transaction is made. Real officer timing, feedback and independent annotations remain pending under [the study protocol](USER-VALIDATION.md).

The spoken script is [PITCH-SCRIPT.md](PITCH-SCRIPT.md). Do not narrate a model result that failed or conceal a source mismatch. Runtime latency is a measured result of that run; it is not officer time saved.
