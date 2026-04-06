# Silent Owner Policy

**Status:** Active. Hard compliance requirement, not a stylistic choice.

## The rule

The Comp Desk LLC is operated by a silent owner who also maintains an active New York Workers' Compensation law practice. To eliminate any conflict-of-interest exposure between the product and that practice, **no public-facing surface of The Comp Desk may identify, describe, or allude to the owner personally, or to the owner's law firm**, except inside the narrow carve-outs listed below.

This applies to every artifact a user, regulator, journalist, search engine, or AI crawler could see — including but not limited to:

- Website copy, page titles, meta descriptions, OpenGraph and Twitter cards
- Structured data (JSON-LD): use `Organization` schema only — never `Person`
- Sitemaps, robots.txt, and any other deploy artifacts
- README files, repository descriptions, public commit messages
- Email "from" names, signatures, support footers, and transactional templates
- App store listings, privacy policies, terms of service
- Marketing assets (images, video, audio, decks, PDFs, social posts)
- Press releases and media kits
- Any "About," "Team," "Founder," "Meet the…," or signature block
- Domain WHOIS, ad accounts, payment processor display names where avoidable

## Substitutions

When a human-attributable name would normally appear, use one of:

- **The Comp Desk LLC** — for legal, corporate, copyright, and operational references
- **The Comp Desk Team** — for general product voice
- **The Comp Desk Editorial Team** — for bylined editorial / blog content
- **Comp Buddy** — for in-app and marketing voice where the mascot persona fits

For contact, use role-based brand addresses (`support@thecompdesk.com`, `privacy@thecompdesk.com`) — never a personal name in the local-part.

## Specifically prohibited

- The owner's first or last name, initials, or nicknames
- The owner's photograph, voice, signature image, or likeness in any form
- The owner's personal phone number or any phone number traceable to them
- The name, domain, address, or branding of the owner's law firm
- Any phrase that implies a single human founder ("founded by," "created by," "I built this," "as an attorney I…")
- First-person singular voice in copy that could be attributed to a specific person
- Bar number, attorney registration number, or any licensure identifier

## Permitted (carve-outs)

The "zero hits outside `back-burner/`" rule has the following deliberate exceptions. These are the **only** places in the repo where the owner's name or firm name may appear. Any new occurrence outside this list is a violation.

1. **`find-attorney-how-it-works.html`** — the sole permitted *public* disclosure point. This page exists specifically to disclose the conflict of interest, name the operator and the operator's firm, and explain that both are permanently excluded from the Find an Attorney directory. The disclosure is the load-bearing feature of the page; do not scrub it. Any change to this page that *removes* the disclosure must be rejected.

2. **`tests/directory-exclusion.test.js`** — privacy safeguard. The forbidden-string list in this CI test must contain the literal owner-name and firm-name variants in order to do its job: failing the build if any of those strings ever appear in `data/attorneys.json`. Removing the strings would defeat the test. Do not weaken this file. If the project's CI grep needs to ignore it, add the path to the grep allowlist — do not edit the test.

3. **`SILENT_OWNER_POLICY.md`** (this file) — the policy itself names the prohibited tokens in its grep example so contributors can run the check. Self-referential and unavoidable.

Everything else must stay clean.

## Permitted product-origin language

- Generic descriptions of the product's origin ("born in hearings," "built for the hearing room")
- Statements that the product was built by people with NYS Workers' Compensation experience, **without naming them**
- Mascot-led voice (Comp Buddy + the Comp Desk calculator character)
- Anonymized or opt-in user testimonials
- The corporate parent name where legally required (currently `NJJ Document Services, Inc. d/b/a The Comp Desk`)

## For contributors

Before opening a PR, run:

```
grep -riE "Joel|Mays|Shulman|786-?815-?4612" \
  --exclude-dir=.git --exclude-dir=back-burner --exclude-dir=node_modules \
  --exclude=SILENT_OWNER_POLICY.md \
  --exclude=find-attorney-how-it-works.html \
  --exclude=directory-exclusion.test.js \
  .
```

This must return zero hits. If it returns anything, the PR is blocked until it returns clean.

If your change introduces any human-attributable content outside the three carve-outs above, it will be rejected. If you are unsure whether something crosses the line, assume it does and ask.

Anything shelved under this policy lives in `back-burner/` — do not delete it, and do not deploy it.
