# 11 — Pilot outreach: the conversations, ready to be held

*The pilot in `09-fit.md` is pre-registered but has not been run: no officer has
been timed, and no office has yet reviewed a pack with Quorum. This page contains
the actual outreach texts so the conversations can start — and so a judge can
check six months from now whether they started.*

**Status: drafted, not yet sent.** When an office responds, the response date and
the pilot result are added to this page; until then the fit claim stays qualified.

---

## Send 1 — Ministry of Health, Procurement Department (Kenya)

> **Subject: One pilot tender pack — your evaluation desk, our agent, timed**
>
> Dear Procurement Team,
>
> We are trialling an evaluation-desk assistant that reads a published tender
> pack as ordinary documents, pins every SHALL clause, flags compliance findings
> (each one cited to the exact bid document and line that triggered it), and
> drafts the clarifying redlines — then stops and waits for a named officer to
> sign before anything can be filed.
>
> We are not asking you to adopt anything. We are asking for one exercise:
> pick one recent, closed tender pack; send it to us; we run the review and
> return (a) the findings file with citations and (b) our measured machine
> time. An officer of your choosing then re-does the same first pass at their
> normal desk pace on a stopwatch, and we publish both numbers side by side —
> including if the pilot shows the comparison cannot be run fairly.
>
> The agent side is open-source and reads documents over a sandboxed
> filesystem interface; only the named sign-off is human. If it is useful we
> can start with a pack that has already been evaluated, so nothing rests on
> the outcome.
>
> — CHAMA18, Quorum pilot team

## Send 2 — KEMSA (framework / repeat supply tenders)

> Same as Send 1, with the closing paragraph replaced by:
>
> We are specifically interested in a high-volume compliance pack where the
> reading desk, not the award, is the bottleneck. If a framework round is due
> for re-publication, running our first-pass review on the previous round's
> pack gives a like-for-like timing comparison with zero novelty risk to this
> round.

## Send 3 — PPRA (oversight / audit consumers)

> **Subject: An audit-ready trail for evaluation-desk tooling**
>
> Dear Authority,
>
> We have built an evaluation-desk assistant for public tenders whose entire
> operating log is append-only JSON-Lines — every tool call, input, output,
> status, and duration — with sha-256 sealed receipts behind a named human
> sign-off and an LLM-cost figure reproducible from that log.
>
> We would like 30 minutes with a review officer to answer one question: is
> this trail sufficient for your audit needs, and if not, what is missing? We
> will bring the log, the receipts, and the citations-first report; nothing
> about the meeting changes our deployment.

## Attachments prepared for all three

1. `SOURCED REPORT` sample — real findings with citations, generated from the
   sample packs in this repo (downloadable from any completed run).
2. `10-cost-and-audit.md` — the measured cost/latency table (both paths).
3. `09-fit.md` §3 — the pre-registered baseline protocol (officer stopwatch +
   screen recording, both numbers published or the pilot says so).
4. `09-fit.md` §3.5 — the public evidence base (evaluation-day caps, volume
   statistics, KEMSA/UMUCYO citations) so recipients can check the framing
   themselves before engaging.

## How to run the pilot once an office replies

The pilot path is the same code path as the samples: the office's documents are
dropped into the dossier, mirrored to storage, read over the sandboxed MCP
server, and the run parks at the human gate — nothing about the pilot is a
second code path. Labels for the office's pack are written by the office's own
reviewer before the agent runs, per the protocol.
