#!/usr/bin/env python3
"""
Build data/mtg/section-pages.json — a lookup that turns a treatment's §section
(from data/mtg/treatments.json) into a PAGE NUMBER in the corresponding
guideline PDF (data/mtg/pdfs/{slug}.pdf), so the MTG Browser tile can deep-link
straight to the cited section with `...pdf#page=N` instead of dumping the reader
on page 1 of a 949-page document.

    python3 scripts/build-mtg-section-pages.py        # requires poppler's pdftotext

Why a derived file: treatments.json is the upstream 2,199-row dataset (shared
with the app) and shouldn't be hand-patched. Safe to re-run any time either the
treatments dataset or the guideline PDFs change.

Where the page numbers come from, in priority order:
  1. A heading index scraped from the PDF itself — every line that starts with a
     section id ("B.4.a.i  Magnetic Resonance Imaging"). Table-of-contents lines
     are rejected (dot leaders / trailing page numbers), which matters: the TOC
     lists the same ids and would otherwise win by appearing first. This is the
     richest source — it reaches the deep sub-sections (C.7.c.i.a) that the
     extracted JSON never captured.
  2. The per-guideline JSON (data/mtg/{slug}.json), which carries reliable pages
     but only for TOP-LEVEL ids (A.1 … E.10), and with gaps.
  3. Longest-prefix match ("B.4.a.i" -> "B.4"), then the nearest PRECEDING
     section under the same top-level letter — so a treatment whose exact
     heading never appears still lands in the right neighborhood.
Anything still unresolved is omitted, and the tile links to the PDF with no page
anchor — a page-1 link is honest; a wrong-page link is not.

Sanity check: where sources 1 and 2 overlap they must AGREE. Disagreements are
printed and the JSON wins, since it's the source the old MTG search tile shipped.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MTG = ROOT / "data" / "mtg"

# treatments.json bodyPart -> guideline slug. Keep in sync with
# MTG_BODYPART_SLUG in js/workspace/tiles.js.
BODYPART_SLUG = {
    "Mid/Low Back": "low-back",
    "Neck": "neck",
    "Knee": "knee",
    "Shoulder": "shoulder",
    "Ankle/Foot": "ankle-foot",
    "Elbow": "elbow",
    "Hand/Wrist/Forearm": "hand-wrist-forearm",
    "Hip/Groin": "hip-groin",
    "PTSD": "ptsd",
    "TBI": "tbi",
    "Depression": "depression",
    "CRPS": "crps",
    "Non-Acute Pain": "non-acute-pain",
    "Eye Disorders": "eye-disorders",
    "Occ. Asthma": "asthma",
    "Occ. ILD": "lung-disease",
    # "Pre-Auth Rules (All)" cites 12 NYCRR 324.2 — no source guideline PDF.
}

ROMAN = {"i": 1, "ii": 2, "iii": 3, "iv": 4, "v": 5, "vi": 6, "vii": 7,
         "viii": 8, "ix": 9, "x": 10, "xi": 11, "xii": 12}

# "B.4.a.i   Magnetic Resonance Imaging" — id at line start, then a real title.
HEADING = re.compile(r'^([A-Z](?:\.(?:[0-9]+|[a-z]{1,4}|[ivx]{1,5}))+)\.?\s+(?=[A-Z"“(])')
TOC_LEADER = re.compile(r'\.{3,}')            # "Medical Care ......... 8"
TOC_TRAILING_PAGE = re.compile(r'\s\d{1,3}$')  # "...Medical Care     8"


def sort_key(section_id):
    """Natural document order for ids like A.10 / B.4.a.ii, so 'A.10' sorts
    after 'A.9' and roman/alpha sub-parts order sensibly."""
    key = []
    for part in section_id.split("."):
        p = part.strip().lower()
        if p.isdigit():
            key.append((1, int(p), ""))
        elif p in ROMAN:
            key.append((2, ROMAN[p], ""))
        elif len(p) == 1 and p.isalpha():
            key.append((0, ord(p), ""))
        else:
            key.append((3, 0, p))
    return key


def pdf_heading_index(slug, blacklist=()):
    """slug -> {section_id: first page the heading appears on (1-based)}.
    `blacklist` skips pages already proven to be contents-style listings."""
    pdf = MTG / "pdfs" / f"{slug}.pdf"
    if not pdf.exists():
        return {}
    text = subprocess.run(["pdftotext", "-layout", str(pdf), "-"],
                          capture_output=True, text=True, check=True).stdout
    index = {}
    for page_no, page in enumerate(text.split("\f"), start=1):
        if page_no in blacklist:
            continue
        lines = [ln.strip() for ln in page.split("\n") if ln.strip()]
        hits = []
        for line in lines:
            # Reject table-of-contents entries — they list the same ids and,
            # appearing first, would otherwise capture every heading.
            if TOC_LEADER.search(line):
                continue
            if TOC_TRAILING_PAGE.search(line) and len(line) < 90:
                continue
            m = HEADING.match(line)
            if m:
                hits.append(m.group(1))
        # Several guidelines carry a bare "Conditions: this guideline addresses
        # the following…" list page (ankle-foot p.19) — no dot leaders, no page
        # numbers, just id + title. It's a contents page in disguise, and taking
        # it would pin every C.* section to one page. Tell it apart from a real
        # body page (PTSD p.8 legitimately holds A.1…A.20 WITH prose) by asking
        # whether the page is mostly headings and nothing else.
        if len(hits) >= 5 and len(hits) / len(lines) > 0.55:
            continue
        for sid in hits:
            index.setdefault(sid, page_no)
    return index


def json_page_index(slug):
    """slug -> {section_id: page} from the extracted guideline JSON."""
    path = MTG / f"{slug}.json"
    if not path.exists():
        return {}
    data = json.loads(path.read_text())
    return {s["id"]: int(str(s["page"]))
            for s in data.get("sections", []) if s.get("id") and s.get("page")}


def resolve(section, pages, ordered):
    # Sections occasionally arrive as "A.12 / D.1.a" — take the first that hits.
    for candidate in [c.strip() for c in re.split(r"[/;]", section) if c.strip()]:
        parts = candidate.split(".")
        for i in range(len(parts), 0, -1):                 # exact, then prefix
            key = ".".join(parts[:i])
            if key in pages:
                return pages[key]
        letter = parts[0].strip().upper()                  # nearest preceding
        target, best = sort_key(candidate), None
        for known in ordered:
            if known.split(".")[0].upper() != letter:
                continue
            if sort_key(known) <= target:
                best = known
            else:
                break
        if best:
            return pages[best]
    return None


def build_index(slug, disagreements):
    """Merge the PDF heading index with the guideline JSON, using the JSON as a
    truth oracle to catch contents-style pages the line heuristics missed.

    A page that lists many sections at once is poison: it pins every deep
    sub-section under it to a single wrong page. So: index the PDF, ask where it
    disagrees with the JSON, and blacklist any page responsible for 2+ of those
    disagreements — one guideline's "Conditions addressed" page can't also be
    where a dozen sections actually start. Then re-index without it.
    """
    json_idx = json_page_index(slug)
    pdf_idx = pdf_heading_index(slug)

    offenders = {}
    for sid, page in json_idx.items():
        if sid in pdf_idx and pdf_idx[sid] != page:
            offenders[pdf_idx[sid]] = offenders.get(pdf_idx[sid], 0) + 1
    blacklist = {page for page, n in offenders.items() if n >= 2}
    if blacklist:
        pdf_idx = pdf_heading_index(slug, blacklist)

    for sid, page in json_idx.items():
        if sid in pdf_idx and pdf_idx[sid] != page:
            disagreements.append(f"{slug} §{sid}: pdf p.{pdf_idx[sid]} vs json p.{page} (using json)")
    merged = {**pdf_idx, **json_idx}   # json wins on overlap
    return merged, sorted(merged, key=sort_key)


def main():
    treatments = json.loads((MTG / "treatments.json").read_text())["treatments"]
    out, caches, disagreements = {}, {}, []
    resolved = unresolved = skipped = 0
    unresolved_ids = []

    for t in treatments:
        slug = BODYPART_SLUG.get(t.get("bodyPart"))
        section = (t.get("section") or "").strip()
        if not slug or not section:
            skipped += 1
            continue
        if slug not in caches:
            print(f"  indexing {slug}…", file=sys.stderr)
            caches[slug] = build_index(slug, disagreements)
        pages, ordered = caches[slug]
        bucket = out.setdefault(slug, {})
        if section in bucket:
            resolved += 1
            continue
        page = resolve(section, pages, ordered)
        if page:
            bucket[section] = page
            resolved += 1
        else:
            unresolved += 1
            unresolved_ids.append(f"{slug} §{section}")

    dest = MTG / "section-pages.json"
    dest.write_text(json.dumps(
        {"note": "Generated by scripts/build-mtg-section-pages.py — do not hand-edit.",
         "pages": out}, indent=0, sort_keys=True) + "\n")

    total = sum(len(v) for v in out.values())
    print(f"\nWrote {dest.relative_to(ROOT)} — {total} section→page entries across {len(out)} guidelines")
    print(f"treatments: {resolved} resolved, {unresolved} unresolved, {skipped} with no source guideline")
    if disagreements:
        print(f"\n{len(disagreements)} pdf/json page disagreements (json used):")
        for d in disagreements[:20]:
            print("  " + d)
    if unresolved_ids:
        print(f"\nunresolved (link will open the PDF with no page anchor):")
        for u in unresolved_ids[:20]:
            print("  " + u)


if __name__ == "__main__":
    main()
