# chamasearch.co — email domain activation (state as of 2026-10-17)

## Done (this session)

1. **Slot freed:** failed Resend domain `thestackone.com` (id `d2dcd2be-…`)
   deleted → plan slot released.
2. **Resend registration:** `chamasearch.co` added to Resend
   (id `25b7fcab-629b-4fd4-b2d3-86125c04a92c`, status `not_started`,
   region us-east-1). Verification records generated:
   - TXT `resend._domainkey.chamasearch.co` — DKIM (full value held in
     `/tmp/resend-cs.json`; Regenerate in the Resend dashboard if lost)
   - TXT `send.chamasearch.co` — `10 feedback-smtp.us-east-1.amazonses.com`
   - TXT `send.chamasearch.co` — `v=spf1 include:amazonses.com ~all`
   - CNAME `rsend.chamasearch.co` — `send.forge.rmta.net`
3. **AWS identity verified** via `sts get-caller-identity`:
   account `103658463143`, user `StackOne`.
4. **Route 53 hosted zone created:** `chamasearch.co`
   (id `Z0353752ZZRCJ3DDH7WH`) with AWS nameservers:
   `ns-1692.awsdns-19.co.uk`, `ns-773.awsdns-32.net`,
   `ns-482.awsdns-60.com`, `ns-1500.awsdns-59.org`.

## Blocked by the account's permissions boundary

The zone's records were **not** wriable: `route53:ChangeResourceRecordSets`
is explicitly denied for user `StackOne` by
`StackOneEmailConfigPermissionsBoundary` ("DenyEmailInfrastructureModification").
The deny's condition exempts only the
`StackOneEmailConfigApprover*` principal, and its trust policy grants the
assume-role only with **MFA** (`aws:MultiFrameAuthPresent: true`) — the
key-based session has no MFA context, so `sts assume-role` is AccessDenied.
The change-batch is prepared and sits ready: `/tmp/change-batch.json`
(3 UPSERT sets covering all 4 records).

Also noted: `chamasearch.co` is **not** registered through AWS's registrar
(`route53domains` has no record of it); its registrar is external, and the
domain currently has **no nameserver delegation at all** (NXDOMAIN), so
nothing serves the records even if they existed.

## What must happen (human, in order)

1. **Nameserver delegation** — at whatever registrar holds `chamasearch.co`,
   set its nameservers to the four `awsdns-*` hosts above. Without this,
   the DNS zone is unreachable and verification cannot succeed.
2. **Write the records** — either
   a. with the registrar's own DNS instead of Route 53 (add the four
      records there directly), or
   b. from the AWS console as an MFA-authenticated admin (or an
      `StackOneEmailConfigApprover` session): apply the change batch to
      zone `Z0353752ZZRCJ3DDH7WH`.
3. **Verify in Resend** — dashboard → Domains → chamasearch.co → Verify
   (or tell me; I will poll `GET /domains/25b7fcab-…` until status flips
   to `verified` and then confirm `send@chamasearch.co` is sendable).

## Reference state (other domains on the Resend key)

- `chungu-chama.com` id `79a72ba1-…` — `not_started` (records parked in
  the earlier runbook; chungu-chama.com **is** registered on this AWS
  account, so its Route 53 path can finish the moment its records are
  allowed through the same boundary).
- `notification.casper-dental.com` id `205b3f61-…` — already `verified`.
