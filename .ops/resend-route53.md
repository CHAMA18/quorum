# Resend ↔ Route 53 activation runbook (chungu-chama.com)

Domain registered with Resend on 2026-10-17: `chungu-chama.com`
id `79a72ba1-8f6a-4ed4-a8f6-f615e4755bbf`, status `not_started`.
Region: us-east-1 (AWS SES backing). Until these four records exist in DNS,
Resend cannot send from the domain.

## Records to create (hosted zone chungu-chama.com)

1. TXT — name: `resend._domainkey.chungu-chama.com` — TTL 300
   value (one string, quote-joined):
   "p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCjV/9vIKVW30PTdaJhWb+cYB+PT1QidKJ/LQylZ3g31a789yEjFoQhyUIt/errhqJIbqOoA0pjQTuFj2iLOxOsk7iXkfyr0PjVcqeJc94an+WrWSIKHXWCQHVPVVqn1y/2/NfViZtIyWqo3AVesTyPMchJ70YcRmUcTaGbc9T0TwIDAQAB"
2. TXT — name: `send.chungu-chama.com` — value: `10 feedback-smtp.us-east-1.amazonses.com`
3. TXT — name: `send.chungu-chama.com` — value: `v=spf1 include:amazonses.com ~all`
4. CNAME — name: `rsend.chungu-chama.com` — value: `send.forge.rmta.net`

(Records 2 and 3 go on the same name as two separate TXT values.)

## How to apply
Option A — console (2 min): Route 53 → Hosted zones → chungu-chama.com →
create the four records above → Resend dashboard → Domains → Verify.
Option B — I can do it for you: paste the IAM user **StackOne** *Secret Access
Key* (the 40-char one) and I will sign the Route 53 change-batch for all four
records and then trigger Resend's verify + report back the domain status.

## App hookup after verification
.env.local already carries RESEND_API_KEY / RESEND_DOMAIN_ID / RESEND_FROM.
The app has no server-side sender yet — next step after activation is wiring
invite/reset/report emails through Resend's REST send endpoint.
