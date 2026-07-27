# Legal-risk translation review

One CSV per language. Open in Google Sheets or Excel — the columns are already
side by side. Three reviewers can work at the same time without touching each
other's file.

## What these strings are

The site publishes 1984 translated strings per language, all produced by machine
translation and none reviewed by a person. These 150 are the ones where a wrong
translation could cause an injured worker to miss a deadline, forgo a benefit they
are owed, or give up a right. Everything else — button labels, marketing copy, page
descriptions — is out of scope on purpose. Reviewing all of it is a job nobody
finishes; reviewing this is a job that fits in a day.

## How to review

1. Read `english_source`, then `translation_<lang>` beside it.
2. Put `y` in **APPROVED** if the translation conveys the same legal meaning.
   It does not have to be elegant, or literal. It has to be *correct*.
3. If it does not, leave APPROVED blank and write the corrected text in
   **CORRECTION**. Write the full replacement string, not a description of the fix.
4. Use **reviewer_notes** for anything you are unsure about. "Unsure" is a useful
   answer and much better than a guess — flag it and move on.

## Things that are meant to look odd

- **Leave English terms in English.** Form numbers (`C-3`, `C-257`, `OC-400.1`),
  statute citations (`WCL §15(3)`), and agency names stay in Latin script even
  mid-sentence. A worker has to match them against paper forms. That is deliberate.
- **Do not invent terminology.** If a term of art has no settled equivalent in the
  language, keeping the English term with a plain-language gloss is the right answer.
- **Dollar amounts, dates and percentages are produced by code**, not copy. Leave
  their formatting alone.

## Order

- **es** — Spanish. Largest NY workers' compensation claimant population by a wide margin
- **zh-Hans** — Chinese (Simplified). zh-Hant is derived from this by OpenCC — correcting a string here corrects both
- **ru** — Russian

Ranked by claimant population, not by how many locales the site has.

## When a language is done

Return the CSV. Corrections are applied to `i18n/<code>.json`, then
`translationsReviewed.<code>` is set to `true` in `i18n/glossary.json`. That flag is
not documentation — it drives the notice at the top of every translated page, which
changes from "not yet reviewed by a person" to "reviewed by a person" for that
language. One edit records the review and tells every reader it happened.
