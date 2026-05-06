#!/usr/bin/env python3
"""
WealthGuard PDF Invoice Ingest.

Reads PDF invoices from a folder, extracts structured data via Gemini 2.5 Flash,
and inserts one transaction per invoice into the "External Invoices (paid)"
account, tagged to a project.

Idempotent: uses sha256(filename + date + amount) as import_id.

Usage:
    python invoice_ingest.py --folder /path/to/invoices [--project-id 2] [--dry-run]
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import sqlite3
import sys
import time
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / '.env')

DB = Path(__file__).parent / 'wealthguard.db'
EXTERNAL_INVOICES_ACCOUNT_ID = 14  # "External Invoices (paid)"

EXTRACTION_PROMPT = """You are extracting data from an Australian renovation / trades invoice.

Return ONLY valid JSON matching this exact schema (no prose, no markdown):
{
  "vendor": "<Business name — e.g. 'Bill Beresford Electrical' or 'Beaumont Tiles'>",
  "date": "<YYYY-MM-DD invoice date OR payment date, whichever is on the doc>",
  "amount_aud": <number, the total amount invoiced in AUD, positive number>,
  "description": "<One-line summary of what the invoice is for. E.g. 'Electrical fit-out — 18 Acacia Dr'>",
  "line_items": ["<line 1>", "<line 2>", ...],
  "invoice_number": "<invoice number if printed, else null>",
  "abn": "<ABN if printed, else null>"
}

Conventions:
- All amounts in AUD, GST-inclusive total if GST is shown
- Prefer the date labelled 'Invoice Date' or 'Date'; if only a due/paid date is present, use that
- If you cannot identify the vendor confidently, use the filename stem
- If the total is ambiguous (multiple totals shown), use the final 'Amount Due' / 'Total Inc GST'
- Never invent data — if a field is truly missing, use null"""


def extract_invoice(pdf_path: Path) -> Optional[dict]:
    """Send a PDF to Gemini 2.5 Flash and parse the JSON response."""
    import google.generativeai as genai
    api_key = os.getenv('GEMINI_API_KEY')
    if not api_key:
        raise SystemExit('GEMINI_API_KEY not set')
    genai.configure(api_key=api_key)

    uploaded = genai.upload_file(path=str(pdf_path), mime_type='application/pdf')
    # Wait for processing if needed
    deadline = time.time() + 180
    while uploaded.state.name == 'PROCESSING':
        if time.time() > deadline:
            genai.delete_file(uploaded.name)
            raise TimeoutError(f'upload processing timed out for {pdf_path.name}')
        time.sleep(1.5)
        uploaded = genai.get_file(uploaded.name)
    if uploaded.state.name != 'ACTIVE':
        genai.delete_file(uploaded.name)
        return None

    model = genai.GenerativeModel(
        'gemini-2.5-flash',
        generation_config={'response_mime_type': 'application/json'},
    )
    try:
        resp = model.generate_content([EXTRACTION_PROMPT, uploaded])
        raw = resp.text or ''
        data = json.loads(raw)
        return data
    except Exception as e:
        print(f'  ! Gemini extraction failed for {pdf_path.name}: {e}', file=sys.stderr)
        return None
    finally:
        try:
            genai.delete_file(uploaded.name)
        except Exception:
            pass


def _import_id(filename: str, date: str, amount: float) -> str:
    key = f'{filename}|{date}|{amount:.2f}'
    return hashlib.sha256(key.encode('utf-8')).hexdigest()[:32]


def insert_invoice(conn, parsed: dict, pdf_path: Path, project_id: int) -> str:
    if not parsed or not parsed.get('amount_aud') or not parsed.get('date'):
        return 'skipped (incomplete data)'
    imp_id = _import_id(pdf_path.name, parsed['date'], float(parsed['amount_aud']))
    existing = conn.execute(
        "SELECT id FROM transactions WHERE import_source='invoice_pdf' AND import_id=?",
        (imp_id,),
    ).fetchone()
    if existing:
        return f'skipped (already imported: txn_id={existing[0]})'

    vendor = parsed.get('vendor') or pdf_path.stem
    description = parsed.get('description') or f'Invoice from {vendor}'
    # Prepend invoice number + file path for traceability
    full_desc = f"[invoice {parsed.get('invoice_number') or '–'}] {description} · source: {pdf_path.name}"

    cur = conn.execute(
        """INSERT INTO transactions
           (account_id, transaction_date, payee, amount, currency, category,
            description, transaction_type, import_source, import_id, project_id)
           VALUES (?, ?, ?, ?, 'AUD', 'Invoice', ?, 'debit', 'invoice_pdf', ?, ?)""",
        (
            EXTERNAL_INVOICES_ACCOUNT_ID,
            parsed['date'],
            vendor,
            -float(parsed['amount_aud']),  # negative = spend
            full_desc,
            imp_id,
            project_id,
        ),
    )
    return f'inserted (txn_id={cur.lastrowid}, ${float(parsed["amount_aud"]):,.0f})'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--folder', required=True, type=Path)
    ap.add_argument('--project-id', type=int, default=2, help='Default 2 = 18 Acacia Dr reno')
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    if not args.folder.is_dir():
        raise SystemExit(f'Not a directory: {args.folder}')

    pdfs = sorted([p for p in args.folder.iterdir() if p.suffix.lower() == '.pdf'])
    if not pdfs:
        print(f'No PDFs found in {args.folder}')
        return 0

    print(f'Processing {len(pdfs)} PDFs → project_id={args.project_id}')
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row

    results = []
    for pdf in pdfs:
        print(f'  → {pdf.name}')
        parsed = extract_invoice(pdf)
        if not parsed:
            print(f'    ! extraction failed, skipping')
            results.append({'file': pdf.name, 'status': 'extraction failed'})
            continue
        print(f'    vendor: {parsed.get("vendor")}')
        print(f'    date: {parsed.get("date")}  amount: ${parsed.get("amount_aud"):,.0f}')
        if args.dry_run:
            results.append({'file': pdf.name, 'status': 'dry-run', 'parsed': parsed})
            continue
        status = insert_invoice(conn, parsed, pdf, args.project_id)
        conn.commit()
        print(f'    {status}')
        results.append({'file': pdf.name, 'status': status})

    conn.close()
    print(f'\n{len(results)} processed.')
    print(json.dumps(results, indent=2, default=str))
    return 0


if __name__ == '__main__':
    sys.exit(main())
