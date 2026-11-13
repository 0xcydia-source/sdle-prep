#!/usr/bin/env python3
"""Honest-evidence demotion pass (phase P0 of docs/REVIEW_2026-11-13_CONTINUATION.md).

Demotes bank records whose stored book evidence cannot support the student-facing
"book-verified" claim. Mirrors `evidenceTier()` in js/app.js so the data flag and the
UI badge cannot disagree.

Rules (all conservative — a record is kept when ANY textbook label OR a clean
publication-style citation exists):

  A. `book_support` is machine junk: carries `Keyword:` / `...` debris, is under 12
     characters, or repeats an option/stem fragment.      -> demote `junk_support`
  B. No evidence paragraph at all (`_context`/`_quote`/`_passage`/`book_passage`).
                                                        -> demote `no_book_evidence`
  C. Evidence is a factpack / Appendix-C / community / derived "principle" with no
     publication-style citation (no quoted page, no "Book: Author, chapter") and no
     raw passage.                                       -> demote `secondary_evidence`

Demoted records: `usable:false`, `book_verified:false`, `exclude_reason`, and a
`_demotion_2026_11_14` marker. Original fields are untouched (red line: no answer
changes). Reports overlap with the app's label logic, so a record can be shown as
`secondary` in the UI and still usable — that is intentional (labels, not deletions).

CLI: `python3 scripts/apply_evidence_demotions.py [--dry-run] [--only junk|noev|secondary]`
"""
from __future__ import annotations

import argparse
import collections
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BANK = ROOT / "data" / "questions.js"
OUT_DIR = ROOT / "data" / "generated" / "evidence_demotions"

SECONDARY_LABEL = re.compile(
    r"(factpack|appendix c|community|rafi|abtal|golden|talkhees|saud|dept |"
    r"sdle textbook corpus|book/factpack|textbook/clinical|clinical principle/|"
    r"prosthodontics clinical|standard (?:oms|perio|ortho|restorative|endo|pedo|ethics))",
    re.I,
)
TEXTBOOK_LABEL = re.compile(
    r"(sturdevant|cohen|hargreaves|carranza|lindhe|newman|hupp|neville|"
    r"white\s*(?:&|and)\s*pharoah|pharoah|mccracken|shillingburg|rosenstiel|proffit|"
    r"mcdonald|malamed|littlewood|complete dentures|periodontics|oral radiology|"
    r"operative dentistry|endodontics principles)",
    re.I,
)
EVIDENCE_KEYS = ("_context", "_quote", "_passage", "book_passage", "_context_quote")
JUNK_SUPPORT = re.compile(r"Keyword:|\.\.\.|[|]{2}|\.{3,}|\u2026")


def load_bank(path: Path) -> list[dict]:
    text = path.read_text(encoding="utf-8")
    start = text.index("QUESTION_BANK = ") + len("QUESTION_BANK = ")
    return json.loads(text[start: text.rindex("]") + 1])


def label_of(q: dict) -> str:
    exp = q.get("explanation") or ""
    m = re.search(r"\[Book:\s*(.*?)\]\s*$", exp, re.S)
    if not m:
        return ""
    return re.split(r"[:\u2014]", m.group(1))[0].strip()


def has_raw_passage(q: dict) -> bool:
    return any(isinstance(q.get(k), str) and len(q[k].strip()) >= 80 for k in EVIDENCE_KEYS)


def has_publication_citation(q: dict, label: str) -> bool:
    exp = q.get("explanation") or ""
    # Quoted page ("p. 412"), edition ("5e"/"13th"), or "Book: Author, chapter/n" form.
    if re.search(r"\bp\.?\s?\d{2,}\b", exp):
        return True
    if re.search(r"\d+\s?(?:th|nd|rd|st)\s?(?:ed\b|edition)", label, re.I):
        return True
    return bool(re.search(r"[A-Z][A-Za-z]{2,}\s*[,/]\s*(?:Ch|ch|chapter|\d)", label))


def junk_support(q: dict) -> bool:
    sup = (q.get("book_support") or "").strip()
    if not sup:
        return True
    if len(sup) < 12:
        return True
    if JUNK_SUPPORT.search(sup):
        return True
    stem = (q.get("q") or "").strip().lower()
    return bool(stem) and sup.lower() in stem


def classify(q: dict) -> tuple[str, str] | None:
    if q.get("usable") is False:
        return None
    if junk_support(q):
        return "junk_support", "book_support is machine debris or a stem/option fragment, not a citation"
    label = label_of(q)
    raw = has_raw_passage(q)
    if not raw and not label:
        return "no_book_evidence", "no stored evidence paragraph or citation label"
    if SECONDARY_LABEL.search(label) and not TEXTBOOK_LABEL.search(label):
        if not raw and not has_publication_citation(q, label):
            return "secondary_evidence", "label is a factpack/Appendix-C/derived note with no page or publication citation"
    return None


def render_bank(records: list[dict]) -> str:
    return "QUESTION_BANK = " + json.dumps(records, ensure_ascii=False, indent=1) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--only", choices=["junk", "noev", "secondary"], action="append")
    ap.add_argument("--bank", default=str(BANK))
    args = ap.parse_args()
    only = {"junk": "junk_support", "noev": "no_book_evidence", "secondary": "secondary_evidence"}
    wanted = {only[o] for o in (args.only or [])} or None

    bank_path = Path(args.bank)
    records = load_bank(bank_path)
    usable_before = sum(1 for q in records if q.get("usable") is not False)
    demoted = collections.Counter()
    report = []
    for q in records:
        verdict = classify(q)
        if not verdict or (wanted and verdict[0] not in wanted):
            continue
        kind, why = verdict
        demoted[kind] += 1
        report.append({"id": q.get("id"), "topic": q.get("topic"), "kind": kind,
                       "support": (q.get("book_support") or "")[:160]})
        if not args.dry_run:
            q["usable"] = False
            q["book_verified"] = False
            q["exclude_reason"] = f"{why} — demoted by evidence gate (2026-11-14)"
            q["_demotion_2026_11_14"] = kind
    usable_after = sum(1 for q in records if q.get("usable") is not False)
    summary = {
        "bank": str(bank_path),
        "dry_run": bool(args.dry_run),
        "records": len(records),
        "usable_before": usable_before,
        "usable_after": usable_after,
        "demoted": dict(demoted),
        "demoted_total": sum(demoted.values()),
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "demotions.jsonl").write_text(
        "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in report), encoding="utf-8")
    (OUT_DIR / "summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    if not args.dry_run and sum(demoted.values()):
        bank_path.write_text(render_bank(records), encoding="utf-8")
    print(json.dumps(summary, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
