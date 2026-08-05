# Silent Owner Policy

**Status:** Active, as amended 2026-08-05 (twice — see both amendment notes below).

> **Amendment note — 2026-08-05.** This policy was originally written as a blanket
> anonymity rule: the owner's name, likeness, and firm were prohibited on every public
> surface. That rule has not described this project's actual practice for some time.
> `webinars.html` shipped in July 2026 with the owner named in the meta description, a
> `Person` node in its JSON-LD, two headshots, and a personal bio. The contributor grep
> this file used to prescribe returned 91 files, not zero.
>
> Rather than leave a compliance document the project knowingly does not meet — which is
> worse than having none, because it is written evidence of an unmet standard — the policy
> is narrowed here to the interest it was actually protecting: **the neutrality of the free
> round-robin attorney connection service.** Founder anonymity is no longer claimed and is
> no longer required. Everything that protects connection-service neutrality is retained
> and, in the case of the public conflict disclosure, strengthened.
>
> Superseded in this amendment: the blanket prohibitions on the owner's name, photograph,
> and personal bio; the `Organization`-schema-only rule; the "no single human founder"
> phrasing rule; and the contributor grep in the former "For contributors" section.

> **Second amendment — 2026-08-05.** Carve-outs 7–9 added after a sweep of every served
> page against this list. All three were already live and already correct; the list was
> incomplete, not the pages. Two are disclosure or contractual necessity (`legal/terms.html`,
> `contributor-agreement.html`) and one is a non-rendered source comment
> (`calculators/radiculopathy.html`).
>
> **`/attorneys` resolved — carve-out 10, same day.** It was the substantive one: a
> first-person attorney bio naming the firm, with no Attorney Advertising label and no
> disclaimer of any kind. Both were added and the page carved out on the directory's terms.
>
> **Still unresolved.** Two live surfaces name the operator outside any carve-out:
> **`/worker`** and its nine mirrors (founder signature naming the firm) and **`/`** and its
> nine mirrors (a "Founder" credit line). Both are lighter than `/attorneys` — a signature
> and a credit, not a bio or a credential claim — but under this policy they are still
> unlisted, and an unlisted surface is not an approved one. Neither carries a disclaimer.
>
> Also still open: **`/webinars` carries no "Attorney Advertising" label**, though it names
> a presenting attorney. It is carved out (4) for the naming, but that carve-out predates
> the label condition and does not impose one.

## The protected interest

The Comp Desk LLC is operated by a person who also maintains an active New York Workers'
Compensation law practice at Shulman & Hill PLLC. The conflict this creates is specific and
narrow: **The Comp Desk operates a free attorney connection service that assigns injured
workers to attorneys by neutral rotation.** If the operator's own firm could receive
assignments from that service, the service would not be neutral, and every public claim of
neutrality would be false.

The rule that follows exists to protect that one thing. It is not a general anonymity rule.

## The rule

**The operator and the operator's firm are permanently excluded from the free attorney
connection service** (`/connect-with-attorney`, `/find-attorney`, and the
`participating_attorneys` data path that feeds them). This exclusion is:

- absolute — no assignment, no listing, no rotation slot, under any circumstance;
- enforced in code, not merely in policy, by `tests/directory-exclusion.test.js`, which runs
  on every push and pull request to `main` via `.github/workflows/directory-neutrality.yml`;
- publicly disclosed on `/connect-with-attorney` in both body copy and FAQ JSON-LD.

No paid placement, referral fee, bidding, or ranking may influence connection-service
assignment for any attorney, excluded or not.

## Permitted: disclosed attorney advertising

The Comp Desk also operates a **paid Attorney Directory** at `/directory`. The directory is
a different product from the connection service and is governed by different rules.

On `/directory` and its listing pages, the following are **permitted**:

- The operator's name, photograph, likeness, credentials, and personal biography
- `Person` and `Attorney` JSON-LD, including `worksFor` naming Shulman & Hill PLLC
- First-person and founder-attributable voice ("founded by," "built by")
- The operator's own paid listing, on the same terms available to any other listing

Subject to these conditions, each of which is load-bearing:

1. Every directory page carries a visible **"Attorney Advertising"** label in the header
   region (NY RPC 7.1(f)) and the full non-law-firm / no-endorsement / no-attorney-client
   disclaimer in the footer.
2. Directory listings are disclosed as **paid advertising** wherever a reasonable reader
   might otherwise mistake them for a neutral recommendation.
3. The directory and the connection service are **described as independent** wherever
   either is described, so that no reader concludes a paid listing affects neutral
   assignment. It does not, and must not be permitted to.
4. Nothing on a directory page may claim, imply, or be styled to suggest that The Comp Desk
   recommends, endorses, ranks, or vouches for any listed attorney — including the operator.

Attorney advertising is permitted here because it is **disclosed**. The prohibition this
policy replaced was never protecting readers from knowing who built the product; it was
protecting them from an undisclosed thumb on a neutral scale. Disclosure, not silence, is
what discharges that duty.

## Permitted (carve-outs) — surfaces that may name the operator or the firm

1. **`connect-with-attorney.html`** and its nine locale mirrors — the primary public
   conflict-disclosure point. This page names the operator and the operator's firm and
   explains that the firm is permanently excluded from the neutral connection service.

   **The disclosure is load-bearing. Do not scrub it.** Any change that *removes* the
   disclosure must be rejected. Any change that *narrows its scope* must be rejected unless
   it simultaneously discloses at least as much — as the 2026-08-05 amendment did, which
   re-scoped the exclusion to the connection service while newly disclosing the operator's
   paid participation in the directory. **Disclosure may be made more specific. It may never
   be made smaller.**

2. **`find-attorney.html`** — the connection-service lead page. Shulman & Hill PLLC may be
   named here only as an *excluded* firm in disclosure copy. It may **not** appear as a
   participating firm, in a firm card, or in `data/attorneys.json`. (This reverses the
   former carve-out, which permitted the firm to be listed as a participant. That
   permission was never exercised, and it contradicted the public exclusion claim.)
   Map sort order is distance-based only — unit-tested in `tests/find-attorney-map-sort.test.js`.
   The page must display the required disclaimer block: *"The Comp Desk is an information
   service. Submitting this form is a request to be contacted by a participating New York
   workers' compensation attorney. It is not legal advice and does not create an
   attorney-client relationship until a participating attorney accepts your matter in
   writing."*

3. **`/directory` and `/directory/<slug>`** — disclosed paid attorney advertising, per the
   section above.

4. **`webinars.html`** — free educational sessions for union members, presented by a named
   attorney. Naming the presenter is inherent to the format.

5. **`tests/directory-exclusion.test.js`** — the automated guard. The forbidden-string list
   in this file must contain the literal owner-name and firm-name variants in order to do
   its job. **Add to that list, never remove from it. Do not weaken this file.** If a check
   needs to ignore it, add the path to an allowlist — do not edit the test.

6. **`SILENT_OWNER_POLICY.md`** (this file) — self-referential and unavoidable.

7. **`legal/terms.html`** and its nine locale mirrors — §1.3 "Relationship to Shulman &
   Hill, PLLC (founder disclosure)" and §2.4 "Founder-firm exclusion". This is the same
   disclosure obligation as carve-out 1, stated in the governing terms rather than on the
   lead page, and it carries the same protection: **it may be made more specific; it may
   never be made smaller.** A change that removes either section must be rejected.

8. **`contributor-agreement.html`** — §8.2 names the operator and the firm in order to
   establish that a contributor at the same firm is making a software contribution outside
   the practice of law, and that no compensation derives from any firm, client, matter,
   settlement, or recovery. The naming is what makes the clause operative; removing it
   would defeat the conflict disclosure the clause exists to make.

9. **`calculators/radiculopathy.html`** and its nine locale mirrors — a source comment
   recording who verified the impairment table against the 2012 NYS Impairment Guidelines,
   and on what date. **Not rendered** — no user-facing surface on these pages names anyone.
   Provenance for a medical-guideline table belongs with the table.

10. **`attorneys.html`** (`/attorneys`) — the professional landing page. It carries a
    first-person bio naming the operator and Shulman & Hill, PLLC, and an FAQ statement
    that the calculators are built and maintained by a practising NYS WC attorney. That is
    attorney advertising, and it is permitted here on the **same terms as the directory**,
    because the terms are what discharge the duty — not silence:

    a. A visible **"Attorney Advertising"** label in the header region (NY RPC 7.1(f)),
       above the nav so it is seen without scrolling. **Do not move it below the fold** —
       a label nobody reaches is not a label.
    b. The full non-law-firm / no-endorsement / no-attorney-client disclaimer in the
       footer, which must also state that the free connection service assigns by neutral
       rotation and that the operator's firm is permanently excluded from it.
    c. Nothing on the page may claim or imply that The Comp Desk endorses, recommends, or
       ranks any attorney — including the operator.

    Both (a) and (b) were absent until 2026-08-05; the page carried the advertising
    without either. Admission status ("a practising NYS WC attorney") is permitted
    context here; a bar or registration number as a marketing credential is not.

## Still prohibited, everywhere

- Any listing, assignment, or appearance of the operator or the operator's firm **in the
  connection service** or its data path, in any form.
- Any claim that the connection service is neutral that is not, at the time it is published,
  literally true.
- Any representation that the paid directory is neutral, curated on merit, endorsed, or
  ranked by The Comp Desk.
- Bar number, attorney registration number, or licensure identifier used as a marketing
  credential. (Factual admission status — "admitted in New York" — is permitted and is
  required context on an attorney-advertising surface.)
- The operator's personal mobile number or any personal contact routed outside published
  business channels.

## Substitutions

Where the product speaks in its own voice rather than an attorney's, continue to use:

- **The Comp Desk LLC** — legal, corporate, copyright, operational references
- **The Comp Desk Team** — general product voice
- **The Comp Desk Editorial Team** — bylined editorial / blog content
- **Comp Buddy** — in-app and marketing voice where the mascot persona fits
- Role-based contact addresses (`support@`, `privacy@`) for platform contact

The corporate parent name where legally required is
`NJJ Document Services, Inc. d/b/a The Comp Desk`.

## For contributors

The former blanket grep is retired — it returned 91 files and could not pass, which made it
useless as a gate. The meaningful check is automated and narrow:

```bash
node tests/directory-exclusion.test.js
```

This must exit 0. It fails the build if the operator or the operator's firm appears in the
connection-service data path, or if a directory listing is added without a dated,
policy-referenced exemption. It runs on every push and PR to `main`.

If you are adding a surface that names the operator or the firm, it must fall inside a
carve-out above. If it does not, either it belongs in a carve-out — amend this file in the
same commit, with a date — or it does not belong on the site.

Anything shelved under this policy lives in `back-burner/` — do not delete it, and do not
deploy it.
