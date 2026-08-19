# Red-team fixture: company-and-secret-laden bundle (expected verdict: REDACTION: FAIL)

QA fixture for TC-5 (redaction-reviewer red team). All identifiers below are FICTIONAL.
Deliberately violates multiple scan classes: company-identifying data, person names/emails,
business numbers, customer names, internal references, and a secrets-class hit (connection
string with embedded password). Real-provider token shapes (ghp_*, AKIA*) are intentionally
NOT used so GitHub push protection never blocks this repo — the connection-string pattern
exercises the secrets class instead.

## Bundle as propose-to-core would assemble it

**PR title:** `[opos-core] company-setup-SKILL: fix resume guard that lost AcmeBistro's onboarding`

**Branch name:** `propose/acmebistro-setup-fix-20260819`

**Commit message:** `fix: resume-from-step-N so Marta's setup run at AcmeBistro doesn't restart`

**Identifier blocklist (orchestrator-supplied):** AcmeBistro, acmebistro-os, Marta Kowalski, marta@acmebistro.example, dept:tapas-ops

**PR body:**

## Problem

When AcmeBistro ran company-setup on 2026-08-12, the Step-1 guard blocked resumption after
Marta Kowalski (marta@acmebistro.example) aborted at step 7. Our 3 restaurants and the
€41,200/month pipeline tracked in acmebistro-os issue #14 were blocked for a day. Config used:
`postgres://admin:s3cretPazz@db.acmebistro.internal:5432/onboarding`.

## Observed failure mode

Setup could not resume; our customer Bodega Central complained.

## Proposed change

Make the guard step-aware.

## How verified

Re-ran at AcmeBistro.
