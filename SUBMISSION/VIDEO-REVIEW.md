# Video review — is the demo award-winning?

**Reviewed:** 3 November 2026
**Reviewer's verdict:** **No — not yet.** The craft is close. The evidence is not.

The closest thing to a submission is `demo-video/quorum-hackathon/Quorum-Hackathon-Demo-Fullscreen-Lusaka.mp4` (3:00). It is a competent product tour with one genuinely excellent beat (the "not evidenced" review). It is not yet an award-winning demo, because it never shows the thing that makes Quorum different from every other procurement dashboard: **the gate refusing to let the agent finish.**

Everything below is fixable. Most of it is editing, not building.

---

## 1. Which file is actually the submission

| File | Length | Status |
| --- | --- | --- |
| `/Users/chunguchama/Downloads/Untitled video.mp4` | 7:01 | **Source material. Do not submit.** Over the 3:00 limit, mono, uncaptioned, 3.6 s of dead air at the top, garbled figures. |
| `Meta Hackathon.mp4` (repo root) | 7:01 | **Byte-identical to the file above** (`md5 35471e8a…`). The filename looks submittable. It is not. Delete or rename it before upload day. |
| `Quorum-Hackathon-Demo-3min.mp4` | 3:00 | Older designed cut. Better title cards, sparse 171-word narration, broken captions, opens on "The review service is not responding." |
| `Quorum-Hackathon-Demo-Fullscreen-Lusaka.mp4` | 3:00 | **Closest candidate.** Complete 429-word narration, no dead air, real UI throughout, SHA-256 seal on screen. Still has blocking defects. |

If a judge receives `Meta Hackathon.mp4`, the submission is disqualified on length before anyone watches it.

---

## 2. Scorecard

My read, not an official rubric.

| Criterion | Score | Why |
| --- | --- | --- |
| Problem clarity | 4/5 | "Procurement delays reach people" is a strong, concrete frame. |
| Product truth | 2/5 | The UI contradicts itself on dates, currency and bidder counts; the real public record is abandoned for a test fixture. |
| Technical depth | 3/5 | MCP, read-only tools, signed reports and SHA-256 are shown. The gate — the actual engineering — is only narrated. |
| Meta AI story | 2.5/5 | Muse Spark 1.3 *is* on screen at 0:33–0:45, and "META AI" heads the bid review at 1:32. But the chip is dim and unreadable at video scale, the model is never named in narration, and its role (tokens, redactions, fallback, attribution) is never shown. |
| Demo craft | 3/5 | Clean 3:00 cut, good pacing, readable captions. Undermined by a dev badge, low contrast and caption drift. |
| Memorability | 2/5 | It ends on a tagline, not on a moment. Nothing in it makes a judge lean forward. |

The gap between 3/5 and 5/5 is almost entirely one missing scene and one cleanup pass.

---

## 3. What is genuinely strong — protect these

1. **The boundary is stated like a product, not a disclaimer.** "It doesn't satisfy the document or decide whether the supplier qualifies" / "The AI doesn't write those scores, rank bidders or award the tender." That is rare and credible.
2. **"Not evidenced" is the best beat in the film.** The AI declines to fill the gap and hands the committee specific questions. That is a real refusal of a real failure mode.
3. **The integrity artifacts are real.** `Evaluation integrity` shows per-evaluator sheets, divergence spreads and a recorded consensus. The `Award recommendation report` shows a SHA-256 (`17e87eb0bc6d9ad0d6256e5b1d3e0ca8`) and "signed by E2E accountant one." Judges who care about auditability will notice.
4. **Citation coverage 100%** on the dashboard, with "all findings linked to sources." Good trust signal, shown early.
5. **The film is 3:00 exactly**, 1920×1080/30, −15.2 LUFS / −1.5 dBTP. Technically broadcast-clean.

---

## 4. Blocking defects — fix before any submission

### P0-1. The thesis is missing: the gate never refuses
The repo's own demo doc says the most interesting moment is a refusal:

> *"The most interesting moment is a refusal: the gate rejecting the operator until a named human signs."* — `SUBMISSION/DEMO.md`

The video never shows it. There is no 422 `"A named human is required"`, no 403 `"Mallory Intruder is not a PRESENT member"`, no 503 fail-closed roster read. The narration *claims* the AI cannot award the tender; the screen never proves it.

A judge scores what is on screen. Right now Quorum looks like a well-designed workflow app that says nice things about governance. The refusal is the only thing in this product that a competitor cannot copy in a weekend.

**Fix:** insert a 20-second terminal beat at ~1:55. Raw `curl`, two refusals, gate still `PENDING`, nothing filed. Do not dramatize it — let the status codes do the work.

### P0-2. A red "1 Issue" dev badge is on screen for two-thirds of the film
The Next.js dev-overlay badge appears at **~1:02** and stays through the closing card. On a projector it is the brightest red object in frame. It reads as "this build is broken," which is the opposite of the message.

**Fix:** record against a production build (`next build && next start`), or suppress the dev indicator. Re-capture the officer-workspace section. This alone changes how finished the film feels.

### P0-3. Personal data is exposed
- **0:00–0:05:** "Good evening, **Chungu**." Full first name, largest type on screen.
- **0:49 onward:** account chip reads "**Chungu Chipimo…**" and "**chungu42…**" in every officer-workspace shot.
- **0:33–0:40:** a real Zambia Revenue Authority TPIN certificate for **STACK ONE SOLUTIONS LIMITED**, TPIN **2001074037**, physical address **50 LUNSEMFWA ROAD / KALUNDU Lusaka**. This is a third party's tax record, not a prop.
- The raw 7:01 also shows `chungu424@gmail.com`.

This is a consent and professionalism problem before it is an aesthetic one. A judge who searches that TPIN finds a real company.

**Fix:** use a synthetic supplier — "Demo Supplier Ltd," a made-up TPIN, a made-up address — and rename the demo account "Procurement Officer." Never show a real taxpayer document in a public submission.

### P0-4. The tender screen contradicts itself
At **0:52–1:21**, one panel says all of the following at once:

| Field | Value |
| --- | --- |
| Stage | `01 / 07 — Tender Notice` (COMPLETE) |
| Closing | `16 Dec 2026 — in 43 d` |
| Bids opened | `2` |
| Responsive | `2/2` |
| Award review period | `Active — Ends 03 Nov 2026` |
| Contract | `KES 588,400,000 — Accepted · cycle closed` |

The tender has not closed yet, but bids are already opened, evaluated, awarded and the contract accepted. In a product whose entire pitch is "one connected, auditable file," a judge who reads the screen will conclude the data is staged. That is fatal in this category.

**Fix:** pick one moment in the lifecycle and make every field agree. Pre-award: closing in 43 days, no bids opened, no contract. Post-award: closed, evaluated, contract accepted, stage 07. Do not show both.

### P0-5. The real record is abandoned for a test fixture
The dashboard shows the strongest asset in the repo: **"Supply of health technologies (cotton gauze, cotton wool & tubes) — framework awards," 11 bidders, 5 issues** — the KEMSA/OCDS record. One second later the demo clicks into **"Essential medicines tracer list (48 items) — E2E walkthrough," 2 bidders.** The narration never says "KEMSA" or "Open Contracting."

So the film opens on a real public procurement record and then quietly swaps in a fixture. Judges from the sector will feel the drop even if they cannot name it.

**Fix:** either stay in the KEMSA record for the whole film and say its name, or cut it from the opening so there is nothing to abandon. The first option is much stronger: "Eleven published awards from KEMSA. Five sit far above the median. Each finding cites the OCDS path it came from."

### P0-6. Jurisdiction and currency are mixed
The same screen shows **KES 588,400,000**, **"17 Zambia legal methods,"** and **"Bank of Zambia."** Kenya shillings, Zambian procurement law. Pick one country and stay in it.

**Fix:** if the case is KEMSA, use Kenyan law and KES. If the entity is Zambian, switch the record and the currency. Either is fine; the mix is not.

---

## 5. High-value fixes — the difference between "good" and "award"

### 5.1 The first 15 seconds are a greeting, not a hook
"Hello, welcome to Quorum" over a dashboard with a notification bell is a product tour opening. Judges have seen forty of those.

Rewrite the cold open around the stakes, not the brand:

> "A hospital cannot use a tender that is still waiting for review. Quorum prepares the file in minutes — and then refuses to finish without a named human."

Then show the file, not the dashboard.

### 5.2 Captions drift and one line is ungrammatical
- At **~1:50** the burnt-in caption reads "treat it as a pass" while the voice has moved on to the committee questions. The 1:35–1:55 stretch reads lagged.
- At **~1:47** the line is "It doesn't fill in the gap **or are quietly treated as a pass**." That is not a sentence. It should be "or quietly treat it as a pass."
- At **~1:38** the break lands mid-phrase: "When the documents don't establish a required / reference contract…"
- The closing card carries a caption and a tagline at the same time. Pick one.
- "Meta-powered" is delivered as "Metapowered." Meta judges will hear it.

**Fix:** re-time captions against the final audio, not the script. Proofread the SRT. Cap at two lines.

### 5.3 The most important modal is the least legible
The `AI-assisted bid review` panel at **1:32–1:49** is dim grey text on near-black. In a bright room or on a projector it becomes a dark rectangle. This is the screen that proves the product's judgement.

**Fix:** raise body text to at least #C9C9CF on #141416, bump the panel's inner contrast, and consider a subtle spotlight/dim on the background so the modal reads as the focus.

### 5.4 The bitrate is too low for UI text
Video stream is **1.22 Mbps** at 1080p30. Fine for faces, poor for dense interface text — it softens small labels and macroblocks on cuts.

**Fix:** master at CRF 16–18 (or 10–12 Mbps), capture at 2× and downscale to 1080p so type stays crisp. Judges often watch a compressed upload, so give the encoder headroom.

### 5.5 The Meta model is on screen, but it's a whisper
I had this wrong on first pass, so the correction matters: **Muse Spark 1.3 is visible in the film.**

- **0:30–0:45**, in the document inspector's right rail: a `MUSE-SPARK-1.3` chip above `READABLE` / `MATCHES THIS ITEM`.
- **0:30**, the same rail: *"The file is sent inline to Meta for this request only. Meta does not retain it, and no eligibility decision is made from this check."*
- **1:32–1:49**, the bid review header: `META AI · ISSUED CRITERIA · ALL ADMITTED BID DOCUMENTS`.

So the claim "Meta is nowhere on screen" is false. The real problem is scale and argument:

1. The chip is small grey type at roughly 40% contrast, in a panel a judge is not looking at. In a compressed 1080p upload it is close to invisible.
2. The narration never says "Muse Spark." It says "Meta-powered" twice, and the second time it lands as "Metapowered."
3. The film never shows what the model *did*: tokens, latency, redaction count, the hosted → in-region fallback path, or the report's model-attribution table. `META_HACKATHON.md` says all of this exists — 2 model drafts, 4 redactions, 22.8 s — and none of it reaches the screen.
4. The inline-data note is the best sovereignty sentence in the film and it is the least legible text in frame.

**Fix:** keep the chip, but give it a 3-second close-up or a callout, say "Muse Spark 1.3 on Meta Model API" out loud once, and put the attribution row (model, source, tokens, redactions, latency) on screen beside the report. This is a scoring criterion, and right now it is present but unargued.

### 5.6 The ending has no ask
The film ends on "That's Quorum. The agent prepares the file. The committee awards the tender." Good line, no destination.

**Fix:** end card with repo URL, live demo URL, team names, and the model used. Three seconds. Judges who want to try it should not have to hunt.

### 5.7 No human anywhere
No face, no voice ownership, no team. For a hackathon, that reads as a generated film. A three-second lower-third with names at the end is enough.

---

## 6. The 3:00 award cut

This is the structure I would shoot. It keeps the existing footage where it works and adds one scene.

| Time | Shot | Line / purpose |
| --- | --- | --- |
| 0:00–0:12 | Cold open on the KEMSA record, no dashboard | "A hospital cannot use a tender still waiting for review." |
| 0:12–0:25 | Model chip + stack console | "Quorum is the agent that prepares the file — and a gate that stops it doing anything irreversible." |
| 0:25–0:50 | KEMSA/OCDS review, 11 awards, 5 outliers | Name KEMSA. Show one finding and its `ocds-…` citation path. |
| 0:50–1:15 | Document check, `NOT EVIDENCED` | "It doesn't fill the gap. It gives the committee the question to ask." |
| 1:15–1:40 | **Terminal: 422 → 403, gate PENDING** | "Not a prompt. Not a policy. The edge to filing does not exist." |
| 1:40–2:05 | Roster, quorum, named approver, signature | The human moment. Slow down. Let the signature land. |
| 2:05–2:25 | SHA-256 seal → receipt → `FILED` | "One append-only line you can replay." |
| 2:25–2:45 | Model attribution, redaction, fallback | The Meta story, on screen. |
| 2:45–3:00 | End card | "The agent prepares the file. The committee awards the tender." + repo / team |

Two rules for the edit: the refusal gets the longest uninterrupted hold in the film, and no caption ever covers the gate output.

---

## 7. Pre-render checklist

- [ ] Production build — no dev overlay, no "1 Issue" badge
- [ ] Synthetic supplier identity — no real name, email, TPIN or address
- [ ] One coherent lifecycle: dates, stage, bidder count and contract state agree
- [ ] One jurisdiction and currency
- [ ] KEMSA named, or removed from the opening
- [ ] 422 / 403 / 503 gate refusal on screen, gate still PENDING after
- [ ] SHA-256 seal and `FILED` receipt on screen
- [ ] Legible `MUSE-SPARK-1.3` chip + model-attribution row (model, tokens, redactions, latency)
- [ ] Captions re-timed to final audio, proofread, max two lines
- [ ] Modal body text contrast checked on a projector, not a laptop
- [ ] Video bitrate ≥ 8 Mbps, or CRF 16–18
- [ ] Loudness −16 to −14 LUFS, true peak ≤ −1.0 dBTP
- [ ] Exactly 3:00, 1920×1080, 30 fps, stereo
- [ ] End card: repo, live URL, team

---

## 8. Do not submit

- `Meta Hackathon.mp4` — it is the 7:01 raw file and will fail the length rule.
- Either 3:00 cut **as-is** — both assert the gate and never show it.
- Any frame containing the real TPIN certificate, the personal account chip, or the dev badge.

---

## 9. Bottom line

The product already has the hard part: a real refusal, a real signature, a real audit trail, and a sentence most startups cannot honestly say — *the AI does not decide.* The film currently spends its three minutes describing that product instead of showing the moment that proves it.

Add the gate refusal, clean the stage, and re-time the captions. That is a day of work, and it moves this from "nice demo" to "that one had a thesis."
