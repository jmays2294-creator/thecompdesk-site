# MTG JSON Schema

One file per Medical Treatment Guideline PDF. Filename = body-region slug (e.g. `shoulder.json`, `low-back.json`, `knee.json`).

```json
{
  "schema_version": 1,
  "guideline": "Shoulder Injury",
  "pdf_filename": "ShoulderInjuryMTG2021.pdf",
  "effective_date": "2022-05-02",
  "body_regions": ["left_shoulder", "right_shoulder"],
  "page_count": 77,
  "sections": [
    {
      "id": "D.1",
      "title": "Acromioclavicular (AC) Joint Sprains / Dislocations",
      "page": 17,
      "body_text": "An acute acromioclavicular (AC) joint injury is frequently referred to as a shoulder separation...",
      "citation": "ShoulderInjuryMTG2021.pdf §D.1 p.17"
    }
  ]
}
```

## Fields

- **schema_version** — bump when structure changes.
- **guideline** — human-readable name. Pulled from PDF `/Title` metadata, hand-corrected for the WCB typo in "Mid and Low Back Injuriy" (file title says "Injuriy"; we use "Mid and Low Back Injury").
- **pdf_filename** — exact basename, used for citation strings and deep-link to the source PDF.
- **effective_date** — ISO date pulled from the cover page ("Effective May 2, 2022" → `2022-05-02`).
- **body_regions** — array of region IDs from the canonical region list (see `tools/mtg/regions.py`). Maps the guideline to one or more highlight-able meshes in the 3D anatomy picker. A guideline can map to multiple regions (Hand/Wrist/Forearm covers three; Shoulder covers both left and right).
- **page_count** — total PDF pages, for the "open PDF at page N" deep link.
- **sections** — extracted Section D subsections only. Sections A (general principles), B (intro), C (history/exam), and E (therapy modalities reference) are out of scope for v1 because they don't describe specific diagnoses or treatments.

## Section objects

- **id** — section number as printed in the PDF (`D.1`, `D.2`, ..., `D.11`).
- **title** — section heading, cleaned of trailing whitespace and PDF artifacts.
- **page** — 1-indexed PDF page where the section begins. Used for the "open PDF at p.X" link.
- **body_text** — the section's full narrative text, with page headers/footers stripped and line breaks normalized. **This is the canonical source for keyword search.**
- **citation** — pre-built citation string in the form `{pdf} §{id} p.{page}` for display in results.

## What we deliberately do NOT extract

- Structured `max_quantity` or `surgery_prerequisites` fields. The PDFs do not present these in a consistent extractable form — quantity caps are buried in narrative ("up to eight sessions, with re-evaluation"). A naive parser would produce wrong numbers in legal records.
- Instead, the **full section text** is searchable and visible, so the attorney reads the actual guideline language. Trust is non-negotiable.

## Region ID conventions

Lowercase, snake_case, anatomical-side-first when paired. Must match mesh names in the 3D figure exactly:

```
head, neck, chest, upper_back, lower_back, abdomen, pelvis,
left_shoulder, right_shoulder,
left_upper_arm, right_upper_arm, left_elbow, right_elbow,
left_forearm, right_forearm, left_wrist, right_wrist, left_hand, right_hand,
left_hip, right_hip, left_thigh, right_thigh, left_knee, right_knee,
left_shin, right_shin, left_ankle, right_ankle, left_foot, right_foot
```

The canonical list lives in `tools/mtg/regions.py` and is duplicated in `www/js/mtg-anatomy.js`.
