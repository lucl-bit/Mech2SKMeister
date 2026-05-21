"""Extract frame / Tragwerk problems from old exam PDFs.

(The module name keeps "truss" only for backward-compat; the actual
target is *Rahmen / geschweisste Tragwerke* with bending — these are
what the Mechanik-II exams in ``schnittkraft_trainer/exams/`` contain.)

For each PDF:
  1. Open it with PyMuPDF and split it into "task chunks" using
     ``Aufgabe N`` or ``Frage XN`` headings.
  2. Drop chunks whose text does not mention Rahmen/Tragwerk keywords
     (unless ``--no-keyword-filter`` is given).
  3. For every remaining chunk, render its first page as a PNG and ask
     a Claude vision model for a single, compact JSON description of
     the structure.
  4. Validate the JSON locally (schema sanity, node/member references).
  5. Append to ``data/tasks/tragwerke_from_exams.json`` and re-render
     ``data/tasks/tragwerke_from_exams_preview.html``.

Idempotent: re-running skips ``task_id``s already present in the JSON.

Usage:
    python3 -m schnittkraft_trainer.tools.exam_truss_extractor \\
        [--limit N] [--only "FS 2023"] [--dry-run]
        [--no-keyword-filter] [--model MODEL_ID]
"""

from __future__ import annotations

import argparse
import base64
import dataclasses
import json
import re
import sys
from pathlib import Path
from typing import Any, Iterator

import fitz  # PyMuPDF

REPO_ROOT = Path(__file__).resolve().parents[1]
EXAMS_DIR = REPO_ROOT / "exams"
OUTPUT_JSON = REPO_ROOT / "data" / "tasks" / "tragwerke_from_exams.json"
OUTPUT_HTML = REPO_ROOT / "data" / "tasks" / "tragwerke_from_exams_preview.html"

# Keywords that suggest a frame / Tragwerk problem with internal forces.
KEYWORDS = (
    "tragwerk",
    "rahmen",
    "biegemoment",
    "biegesteif",
    "schnittkraft",
    "schnittkräfte",
    "schnittkraefte",
    "querkraft",
    "normalkraft",
    "balken",
    "kragträger",
    "kragtraeger",
    "einspann",
)

DEFAULT_MODEL = "claude-haiku-4-5-20251001"

EXTRACTION_PROMPT = """You inspect a single problem from a German civil-
engineering exam.

Decide if the problem shows a 2D **frame / Tragwerk** (welded structure
with bending-stiff joints, beams, supports, loads — the kind of
structure where students compute N, Q, M).
If it is NOT such a structure, reply with exactly: {"is_structure": false}

If it IS, reply with exactly one JSON object (no prose, no fences):
{
  "is_structure": true,
  "structure_type": "frame" | "beam" | "truss",
  "title": "<short German title, <=70 chars>",
  "nodes": [
    {"node_id": "A", "x": 0.0, "y": 0.0}
  ],
  "members": [
    {"member_id": 1, "start_node": "A", "end_node": "B",
     "EI": "EI" | <number> | null,
     "EA": "EA" | <number> | null}
  ],
  "supports": [
    {"node_id": "B", "support_type": "fixed" | "pin" | "roller_x" | "roller_y"}
  ],
  "loads": [
    {"type": "point_force", "node_id": "A",
     "fx": <number or symbol string>, "fy": <number or symbol string>,
     "label": "F"},
    {"type": "distributed", "member_id": 2,
     "q": <number or symbol>, "direction": "perpendicular" | "global_y" | "global_x",
     "label": "q0"},
    {"type": "moment", "node_id": "C",
     "M": <number or symbol>, "label": "M0"}
  ],
  "notes": "<one short German sentence describing what is special>"
}

Conventions (MUST follow):
- x increases to the right, y increases DOWNWARD (positive y is below).
- Use meters for coordinates. Pick small integer coordinates that match
  the drawing (e.g. 0,1,2,3,4 m). Lengths labelled "L" — use L=1.
- node_id may be a letter (A,B,C,...) or an integer; use exactly the
  letters drawn on the figure when they exist.
- "fixed" = clamped/Einspannung (3 reactions). "pin" = Festlager (2).
  "roller_x" = Rollenlager das sich in x bewegt (vertical reaction).
  "roller_y" = Rollenlager das sich in y bewegt (horizontal reaction).
- For loads you may keep the original *symbolic* magnitude as a string
  (e.g. "F", "q0", "M0", "2F"). Use a number only if the figure gives
  one.
- Omit `loads` entries that are not actually drawn. Never invent loads.
- Return ONLY the JSON object. No backticks, no commentary."""


# ----------------------------- data model ---------------------------------


@dataclasses.dataclass
class ExamChunk:
    pdf_name: str
    task_label: str
    pages: list[int]
    text: str


# --------------------------- PDF segmentation -----------------------------

TASK_RE = re.compile(
    r"\b(Aufgabe|Frage)\s+([A-Z]?\d+)",
    re.IGNORECASE,
)


def split_into_chunks(pdf_path: Path) -> Iterator[ExamChunk]:
    """Group pages of a PDF into chunks delimited by task headings.

    Recognised headings: ``Aufgabe N`` or ``Frage XN``. Falls back to
    one-chunk-per-page when the PDF has essentially no extractable text
    (likely a scanned exam).
    """
    doc = fitz.open(pdf_path)
    try:
        chunks: list[tuple[str, list[int], list[str]]] = []
        current_label = "Vorwort"
        current_pages: list[int] = []
        current_texts: list[str] = []
        total_text_len = 0

        for index in range(doc.page_count):
            page = doc.load_page(index)
            text = page.get_text("text") or ""
            total_text_len += len(text.strip())
            match = TASK_RE.search(text)
            if match:
                if current_pages:
                    chunks.append((current_label, current_pages, current_texts))
                kw = match.group(1).capitalize()
                current_label = f"{kw} {match.group(2)}"
                current_pages = [index + 1]
                current_texts = [text]
            else:
                current_pages.append(index + 1)
                current_texts.append(text)
        if current_pages:
            chunks.append((current_label, current_pages, current_texts))

        if total_text_len < 200:
            for index in range(doc.page_count):
                yield ExamChunk(
                    pdf_name=pdf_path.name,
                    task_label=f"Seite {index + 1}",
                    pages=[index + 1],
                    text="",
                )
            return

        for label, pages, texts in chunks:
            if label == "Vorwort":
                continue
            yield ExamChunk(
                pdf_name=pdf_path.name,
                task_label=label,
                pages=pages,
                text="\n".join(texts),
            )
    finally:
        doc.close()


def chunk_is_candidate(chunk: ExamChunk) -> bool:
    haystack = chunk.text.lower()
    if not haystack:  # scanned page — let the LLM judge
        return True
    return any(kw in haystack for kw in KEYWORDS)


def render_chunk_image(pdf_path: Path, chunk: ExamChunk, dpi: int = 150) -> bytes:
    doc = fitz.open(pdf_path)
    try:
        page = doc.load_page(chunk.pages[0] - 1)
        matrix = fitz.Matrix(dpi / 72.0, dpi / 72.0)
        pix = page.get_pixmap(matrix=matrix, alpha=False)
        return pix.tobytes("png")
    finally:
        doc.close()


# ----------------------------- LLM call -----------------------------------


def call_extractor(image_bytes: bytes, model: str) -> dict[str, Any]:
    import anthropic

    client = anthropic.Anthropic()
    image_b64 = base64.b64encode(image_bytes).decode("ascii")

    response = client.messages.create(
        model=model,
        max_tokens=2000,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/png",
                            "data": image_b64,
                        },
                    },
                    {"type": "text", "text": EXTRACTION_PROMPT},
                ],
            }
        ],
    )

    text_parts = [block.text for block in response.content if block.type == "text"]
    raw = "".join(text_parts).strip()
    return _parse_json_loose(raw)


def _parse_json_loose(raw: str) -> dict[str, Any]:
    s = raw.strip()
    if s.startswith("```"):
        s = s.split("```", 2)[1]
        if s.lower().startswith("json"):
            s = s[4:]
        s = s.strip("` \n")
    start = s.find("{")
    end = s.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError(f"No JSON object in response: {raw!r}")
    return json.loads(s[start : end + 1])


# --------------------------- Validation -----------------------------------

VALID_SUPPORTS = {"fixed", "pin", "roller_x", "roller_y", "free"}
VALID_STRUCTURE_TYPES = {"frame", "beam", "truss"}


def validate_structure(model: dict[str, Any]) -> tuple[str, str]:
    """Return (review_status, review_note).

    Lightweight schema check — we cannot solve frames with the existing
    solver, so we only verify references and shapes.
    """
    try:
        nodes = model["nodes"]
        members = model["members"]
        supports = model.get("supports", [])
        loads = model.get("loads", [])
    except KeyError as exc:
        return "rejected", f"Fehlendes Feld {exc}"

    if not nodes:
        return "rejected", "Keine Knoten."
    if not members:
        return "rejected", "Keine Stäbe."

    node_ids = {n["node_id"] for n in nodes}
    if len(node_ids) != len(nodes):
        return "rejected", "Node-IDs nicht eindeutig."

    member_ids = {m["member_id"] for m in members}
    if len(member_ids) != len(members):
        return "rejected", "Member-IDs nicht eindeutig."

    for m in members:
        if m["start_node"] not in node_ids or m["end_node"] not in node_ids:
            return "rejected", f"Stab {m['member_id']} referenziert unbekannten Knoten."

    for s in supports:
        if s["support_type"] not in VALID_SUPPORTS:
            return "rejected", f"Ungültiger Auflagertyp {s['support_type']!r}."
        if s["node_id"] not in node_ids:
            return "rejected", f"Auflager auf unbekanntem Knoten {s['node_id']!r}."

    for ld in loads:
        kind = ld.get("type")
        if kind == "point_force" or kind == "moment":
            if ld.get("node_id") not in node_ids:
                return "rejected", f"Last auf unbekanntem Knoten {ld.get('node_id')!r}."
        elif kind == "distributed":
            if ld.get("member_id") not in member_ids:
                return "rejected", f"Streckenlast auf unbekanntem Stab {ld.get('member_id')!r}."
        else:
            return "rejected", f"Unbekannter Lasttyp {kind!r}."

    stype = model.get("structure_type", "frame")
    if stype not in VALID_STRUCTURE_TYPES:
        return "rejected", f"Unbekannter structure_type {stype!r}."

    return "pending", ""


# ---------------------------- I/O helpers ---------------------------------


def load_existing() -> list[dict[str, Any]]:
    if not OUTPUT_JSON.exists():
        return []
    return json.loads(OUTPUT_JSON.read_text(encoding="utf-8"))


def save_json(entries: list[dict[str, Any]]) -> None:
    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_JSON.write_text(
        json.dumps(entries, indent=2, ensure_ascii=False), encoding="utf-8"
    )


def make_task_id(pdf_name: str, task_label: str) -> str:
    stem = Path(pdf_name).stem.lower().replace(" ", "")
    label = task_label.lower().replace(" ", "")
    return f"{stem}_{label}"


# ---------------------------- HTML preview --------------------------------

SVG_W = 380
SVG_H = 280
SVG_PAD = 34


def _is_zero(v: Any) -> bool:
    try:
        return abs(float(v)) < 1e-9
    except (TypeError, ValueError):
        return False


def render_svg(entry: dict[str, Any]) -> str:
    nodes = entry["nodes"]
    members = entry["members"]
    supports = {s["node_id"]: s["support_type"] for s in entry.get("supports", [])}
    loads = entry.get("loads", [])

    if not nodes:
        return "<svg></svg>"

    xs = [float(n["x"]) for n in nodes]
    ys = [float(n["y"]) for n in nodes]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    span_x = max(max_x - min_x, 1.0)
    span_y = max(max_y - min_y, 1.0)
    scale = min(
        (SVG_W - 2 * SVG_PAD) / span_x,
        (SVG_H - 2 * SVG_PAD) / span_y,
    )

    def project(x: float, y: float) -> tuple[float, float]:
        px = SVG_PAD + (float(x) - min_x) * scale
        py = SVG_PAD + (float(y) - min_y) * scale
        return px, py

    pts = {n["node_id"]: project(n["x"], n["y"]) for n in nodes}
    member_centroids = {}
    for m in members:
        ax, ay = pts[m["start_node"]]
        bx, by = pts[m["end_node"]]
        member_centroids[m["member_id"]] = ((ax + bx) / 2, (ay + by) / 2)

    out: list[str] = [
        f'<svg width="{SVG_W}" height="{SVG_H}" viewBox="0 0 {SVG_W} {SVG_H}" '
        f'xmlns="http://www.w3.org/2000/svg">',
        '<rect width="100%" height="100%" fill="#fafafa" stroke="#ddd"/>',
        '<defs>'
        '<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" '
        'markerWidth="6" markerHeight="6" orient="auto-start-reverse">'
        '<path d="M0,0 L10,5 L0,10 z" fill="#e65100"/></marker>'
        '</defs>',
    ]

    for m in members:
        x1, y1 = pts[m["start_node"]]
        x2, y2 = pts[m["end_node"]]
        out.append(
            f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" '
            f'stroke="#222" stroke-width="3"/>'
        )

    for nid, (px, py) in pts.items():
        out.append(f'<circle cx="{px:.1f}" cy="{py:.1f}" r="4" fill="#1976d2"/>')
        out.append(
            f'<text x="{px + 6:.1f}" y="{py - 6:.1f}" font-size="12" '
            f'fill="#333">{nid}</text>'
        )
        kind = supports.get(nid)
        if kind:
            color = {
                "fixed": "#6a1b9a",
                "pin": "#d32f2f",
                "roller_x": "#388e3c",
                "roller_y": "#0288d1",
                "free": "#999",
            }.get(kind, "#999")
            if kind == "fixed":
                out.append(
                    f'<rect x="{px - 10:.1f}" y="{py + 4:.1f}" width="20" height="6" '
                    f'fill="{color}" opacity="0.85"/>'
                )
            else:
                out.append(
                    f'<polygon points="{px:.1f},{py + 4:.1f} '
                    f'{px - 8:.1f},{py + 18:.1f} {px + 8:.1f},{py + 18:.1f}" '
                    f'fill="{color}" opacity="0.85"/>'
                )
            out.append(
                f'<text x="{px:.1f}" y="{py + 30:.1f}" font-size="9" '
                f'text-anchor="middle" fill="{color}">{kind}</text>'
            )

    for ld in loads:
        kind = ld.get("type")
        if kind == "point_force":
            anchor = pts.get(ld.get("node_id"))
            if not anchor:
                continue
            px, py = anchor
            label = ld.get("label", "F")
            fy = ld.get("fy", 0.0)
            fx = ld.get("fx", 0.0)
            # Direction: numeric → use components; symbolic → assume fy > 0.
            try:
                nx = float(fx)
                ny = float(fy)
                mag = (nx * nx + ny * ny) ** 0.5
                if mag < 1e-9:
                    nx, ny = 0.0, 1.0
                else:
                    nx, ny = nx / mag, ny / mag
            except (TypeError, ValueError):
                nx, ny = 0.0, 1.0
            length = 32.0
            ex, ey = px + nx * length, py + ny * length
            out.append(
                f'<line x1="{ex:.1f}" y1="{ey:.1f}" x2="{px:.1f}" y2="{py:.1f}" '
                f'stroke="#e65100" stroke-width="2" marker-end="url(#arrow)"/>'
            )
            out.append(
                f'<text x="{ex + 4:.1f}" y="{ey + 4:.1f}" font-size="11" '
                f'fill="#e65100">{label}</text>'
            )
        elif kind == "distributed":
            centroid = member_centroids.get(ld.get("member_id"))
            if not centroid:
                continue
            cx, cy = centroid
            label = ld.get("label", "q")
            out.append(
                f'<text x="{cx:.1f}" y="{cy - 8:.1f}" font-size="11" '
                f'text-anchor="middle" fill="#1565c0">▼▼▼ {label}</text>'
            )
        elif kind == "moment":
            anchor = pts.get(ld.get("node_id"))
            if not anchor:
                continue
            px, py = anchor
            label = ld.get("label", "M")
            out.append(
                f'<circle cx="{px:.1f}" cy="{py:.1f}" r="12" fill="none" '
                f'stroke="#7b1fa2" stroke-width="2"/>'
            )
            out.append(
                f'<text x="{px + 14:.1f}" y="{py + 4:.1f}" font-size="11" '
                f'fill="#7b1fa2">{label}</text>'
            )

    out.append("</svg>")
    return "".join(out)


def render_preview_html(entries: list[dict[str, Any]]) -> str:
    cards: list[str] = []
    for entry in entries:
        status = entry.get("review_status", "pending")
        status_color = "#388e3c" if status == "pending" else "#d32f2f"
        nodes_html = ", ".join(
            f'{n["node_id"]}({n["x"]},{n["y"]})' for n in entry["nodes"]
        )
        members_html = ", ".join(
            f'{m["member_id"]}:{m["start_node"]}-{m["end_node"]}'
            for m in entry["members"]
        )
        supports_html = ", ".join(
            f'{s["node_id"]}/{s["support_type"]}' for s in entry.get("supports", [])
        ) or "—"
        loads_html = (
            ", ".join(_format_load(ld) for ld in entry.get("loads", [])) or "—"
        )
        svg = render_svg(entry)
        note = entry.get("review_note", "")
        notes_field = entry.get("notes", "")
        cards.append(
            f"""
<article class="card">
  <header>
    <h3>{_html_escape(entry.get("title", entry["task_id"]))}</h3>
    <small>{entry["source_pdf"]} · {entry["source_task_label"]} · Seite {entry["source_page"]} · <code>{entry.get("structure_type", "frame")}</code></small>
  </header>
  <div class="body">
    <div class="figure">{svg}</div>
    <dl>
      <dt>task_id</dt><dd><code>{entry["task_id"]}</code></dd>
      <dt>Knoten</dt><dd>{_html_escape(nodes_html)}</dd>
      <dt>Stäbe</dt><dd>{_html_escape(members_html)}</dd>
      <dt>Auflager</dt><dd>{_html_escape(supports_html)}</dd>
      <dt>Lasten</dt><dd>{_html_escape(loads_html)}</dd>
      <dt>Notizen</dt><dd>{_html_escape(notes_field)}</dd>
      <dt>Status</dt><dd style="color:{status_color}"><b>{status}</b> {_html_escape(note)}</dd>
    </dl>
  </div>
</article>"""
        )

    style = """
body { font-family: -apple-system, sans-serif; margin: 20px; background: #f4f5f7; }
h1 { margin-bottom: 8px; }
.summary { color: #555; margin-bottom: 20px; }
.card { background: #fff; border: 1px solid #ddd; border-radius: 8px; margin-bottom: 16px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
.card header { padding: 10px 14px; border-bottom: 1px solid #eee; }
.card header h3 { margin: 0; }
.card header small { color: #888; }
.card .body { display: flex; gap: 20px; padding: 12px 14px; flex-wrap: wrap; align-items: flex-start; }
.card .figure { flex: 0 0 auto; }
.card dl { display: grid; grid-template-columns: 90px 1fr; gap: 4px 12px; margin: 0; font-size: 13px; min-width: 320px; }
.card dt { color: #666; }
.card dd { margin: 0; word-break: break-word; }
code { background: #f0f0f0; padding: 1px 4px; border-radius: 3px; font-size: 12px; }
"""
    rejected = sum(1 for e in entries if e.get("review_status") == "rejected")
    pending = len(entries) - rejected
    body = "".join(cards) or "<p><em>Noch keine Tragwerke extrahiert.</em></p>"
    return f"""<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8"/>
<title>Extrahierte Tragwerke aus Altprüfungen</title>
<style>{style}</style>
</head>
<body>
<h1>Extrahierte Tragwerke aus Altprüfungen</h1>
<p class="summary">{len(entries)} Aufgaben &middot; {pending} OK &middot; {rejected} verworfen.</p>
{body}
</body>
</html>"""


def _format_load(ld: dict[str, Any]) -> str:
    kind = ld.get("type")
    label = ld.get("label", "")
    if kind == "point_force":
        return f"F@{ld.get('node_id')}({ld.get('fx', 0)},{ld.get('fy', 0)}) {label}".strip()
    if kind == "distributed":
        return f"q on m{ld.get('member_id')}={ld.get('q')} {ld.get('direction', '')} {label}".strip()
    if kind == "moment":
        return f"M@{ld.get('node_id')}={ld.get('M')} {label}".strip()
    return str(ld)


def _html_escape(s: Any) -> str:
    return (
        str(s)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def save_preview(entries: list[dict[str, Any]]) -> None:
    OUTPUT_HTML.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_HTML.write_text(render_preview_html(entries), encoding="utf-8")


# ----------------------------- CLI / main ---------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--limit", type=int, default=None,
                        help="Maximum number of LLM calls in this run.")
    parser.add_argument("--only", type=str, default=None,
                        help="Substring filter on PDF filename.")
    parser.add_argument("--dry-run", action="store_true",
                        help="List candidates but do not call the LLM and do not write JSON.")
    parser.add_argument("--no-keyword-filter", action="store_true",
                        help="Send every task chunk to the LLM (use sparingly).")
    parser.add_argument("--model", type=str, default=DEFAULT_MODEL)
    parser.add_argument("--rerender-only", action="store_true",
                        help="Only re-render the HTML preview from the existing JSON.")
    args = parser.parse_args(argv)

    if args.rerender_only:
        entries = load_existing()
        save_preview(entries)
        print(f"Preview neu gerendert: {OUTPUT_HTML}")
        return 0

    if not EXAMS_DIR.exists():
        print(f"Exams-Ordner fehlt: {EXAMS_DIR}", file=sys.stderr)
        return 1

    pdfs = sorted(EXAMS_DIR.glob("*.pdf"))
    if args.only:
        needle = args.only.lower()
        pdfs = [p for p in pdfs if needle in p.name.lower()]
    if not pdfs:
        print("Keine PDFs gefunden (Filter zu eng?).", file=sys.stderr)
        return 1

    entries = load_existing()
    seen_ids = {e["task_id"] for e in entries}
    llm_calls = 0

    for pdf_path in pdfs:
        print(f"=== {pdf_path.name} ===")
        for chunk in split_into_chunks(pdf_path):
            if not args.no_keyword_filter and not chunk_is_candidate(chunk):
                continue
            task_id = make_task_id(chunk.pdf_name, chunk.task_label)
            if task_id in seen_ids:
                print(f"  [skip] {task_id} bereits extrahiert.")
                continue
            if args.limit is not None and llm_calls >= args.limit:
                print(f"  [limit] {args.limit} LLM-Aufrufe erreicht, Abbruch.")
                _flush(entries)
                return 0

            print(f"  [candidate] {task_id} (Seiten {chunk.pages})")
            if args.dry_run:
                continue

            try:
                image_bytes = render_chunk_image(pdf_path, chunk)
                result = call_extractor(image_bytes, model=args.model)
                llm_calls += 1
            except Exception as exc:  # noqa: BLE001
                print(f"    !! Extraktion fehlgeschlagen: {exc}")
                continue

            if not result.get("is_structure"):
                print("    -> kein Tragwerk laut Modell, übersprungen.")
                continue

            status, note = validate_structure(result)
            entry = {
                "task_id": task_id,
                "source_pdf": chunk.pdf_name,
                "source_task_label": chunk.task_label,
                "source_page": chunk.pages[0],
                "title": result.get("title", chunk.task_label),
                "structure_type": result.get("structure_type", "frame"),
                "nodes": result.get("nodes", []),
                "members": result.get("members", []),
                "supports": result.get("supports", []),
                "loads": result.get("loads", []),
                "notes": result.get("notes", ""),
                "review_status": status,
                "review_note": note,
            }
            entries.append(entry)
            seen_ids.add(task_id)
            print(f"    -> {status} {('('+note+')') if note else ''}")
            _flush(entries)

    _flush(entries)
    print(f"\nFertig. {len(entries)} Tragwerke gespeichert in {OUTPUT_JSON}")
    print(f"Preview: {OUTPUT_HTML}")
    return 0


def _flush(entries: list[dict[str, Any]]) -> None:
    save_json(entries)
    save_preview(entries)


if __name__ == "__main__":
    raise SystemExit(main())
