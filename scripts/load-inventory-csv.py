#!/usr/bin/env python3
"""Clean a used-tire inventory CSV and load it into usedtireinventory_dev.

Some rows store the count in front of the brand ("3 Pirelli"). Others keep it
in the Quantity column. A leading count on the brand is this row's quantity,
because mixed sets repeat that total on the first line and then list each
brand on the following lines. When the brand has no leading count, Quantity
is used.

Blank model, tread pattern, and DOT values are inserted as NULL. This script
writes the development table only. It will not update the live
usedtireinventory table.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import ssl
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_TABLE = "usedtireinventory_dev"
LIVE_TABLE = "usedtireinventory"
BRAND_QTY_PATTERN = re.compile(r"^\s*(\d+)\s*x?\s+(.+?)\s*$", re.IGNORECASE)
SIZE_PATTERN = re.compile(
    r"(\d{3})\s*[/\-]\s*(\d{2})\s*[/\-rRzZ]*\s*(\d{2})",
    re.IGNORECASE,
)
FLOTATION_PATTERN = re.compile(
    r"(\d{2}(?:\.\d+)?)\s*[xX]\s*(\d{2}(?:\.\d+)?)\s*[rR]?\s*(\d{2})",
)
PRICE_PATTERN = re.compile(r"\d+(?:\.\d+)?")


def load_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for line in path.read_text(encoding="utf-8").splitlines():
        match = re.match(r"^\s*([^#=\s]+)\s*=(.*)$", line)
        if not match:
            continue
        values[match.group(1)] = match.group(2).strip().strip('"')
    return values


def blank_to_none(value: str | None) -> str | None:
    text = (value or "").strip()
    return text or None


def parse_quantity(value: str | None) -> int | None:
    text = (value or "").strip()
    if not text:
        return None
    match = re.search(r"\d+", text)
    if not match:
        return None
    return int(match.group(0))


def split_brand_quantity(brand: str | None) -> tuple[str | None, int | None]:
    text = (brand or "").strip()
    if not text:
        return None, None
    match = BRAND_QTY_PATTERN.match(text)
    if not match:
        return text, None
    return match.group(2).strip() or None, int(match.group(1))


def normalize_season(value: str | None) -> str:
    season = (value or "").strip().lower()
    if not season:
        return ""
    if season in {"as", "at"} or "all" in season or "terrain" in season:
        return "all-season"
    if season == "w" or "winter" in season:
        return "winter"
    if season == "s" or "summer" in season:
        return "summer"
    return season


def parse_size(size: str | None) -> dict[str, str | bool | None]:
    text = (size or "").strip()
    standard = SIZE_PATTERN.search(text)
    if standard:
        width, profile, rim = standard.groups()
        return {
            "tire_size": f"{width}/{profile}R{rim}",
            "width": width,
            "profile": profile,
            "wheel_size": rim,
            "rim_size": int(rim),
            "is_flotation": False,
        }
    flotation = FLOTATION_PATTERN.search(text)
    if flotation:
        width, profile, rim = flotation.groups()
        return {
            "tire_size": f"{width}x{profile}R{rim}",
            "width": width,
            "profile": profile,
            "wheel_size": rim,
            "rim_size": int(rim),
            "is_flotation": True,
        }
    return {
        "tire_size": text or None,
        "width": None,
        "profile": None,
        "wheel_size": None,
        "rim_size": None,
        "is_flotation": False,
    }


def parse_price(value: str | None) -> float | None:
    match = PRICE_PATTERN.search((value or "").replace(",", ""))
    if not match:
        return None
    amount = float(match.group(0))
    if amount <= 0:
        return None
    return round(amount, 2)


def clean_row(row: dict[str, str], sheet_row: int, sheet_tab: str) -> dict | None:
    brand, brand_quantity = split_brand_quantity(row.get("Brand"))
    if not brand:
        return None

    size_text = blank_to_none(row.get("Size")) or blank_to_none(row.get("Sort Size"))
    parsed_size = parse_size(size_text)
    if not parsed_size["tire_size"]:
        return None

    quantity = brand_quantity if brand_quantity is not None else parse_quantity(row.get("Quantity") or row.get("Set") or row.get("QTY"))
    tread = blank_to_none(row.get("Tread Pattern") or row.get("Season"))
    rim_text = blank_to_none(row.get("Rim"))
    rim_size = int(rim_text) if rim_text and rim_text.isdigit() else parsed_size["rim_size"]

    return {
        "id": f"{sheet_tab}-{sheet_row}",
        "sheet_tab": sheet_tab,
        "sheet_row": sheet_row,
        "size": parsed_size["tire_size"],
        "tire_size": parsed_size["tire_size"],
        "brand": brand,
        "model": blank_to_none(row.get("Model")),
        "tread_pattern": tread,
        "type": tread,
        "season": normalize_season(tread),
        "dot": blank_to_none(row.get("DOT")),
        "quantity": quantity,
        "current_stock": quantity,
        "selling_price": parse_price(row.get("Price")),
        "price_is_final": True,
        "note": blank_to_none(row.get("Additional Note") or row.get("Description")),
        "category": blank_to_none(row.get("Category")),
        "drive_link": blank_to_none(row.get("Link")) or "",
        "rim_size": rim_size,
        "width": parsed_size["width"],
        "profile": parsed_size["profile"],
        "wheel_size": parsed_size["wheel_size"],
        "size_label": parsed_size["tire_size"],
        "is_flotation": parsed_size["is_flotation"],
    }


def sheet_tab_from_path(path: Path) -> str:
    match = re.search(r"-\s*(\d+)\.csv$", path.name, re.IGNORECASE)
    return match.group(1) if match else "csv"


def read_cleaned_rows(path: Path) -> list[dict]:
    sheet_tab = sheet_tab_from_path(path)
    rows: list[dict] = []
    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        for offset, raw in enumerate(reader, start=2):
            cleaned = clean_row(raw, offset, sheet_tab)
            if cleaned:
                rows.append(cleaned)
    return rows


def database_record(row: dict) -> dict:
    return {
        "id": row["id"],
        "sheet_tab": row["sheet_tab"],
        "sheet_row": row["sheet_row"],
        "tire_size": row["tire_size"],
        "rim_size": row["rim_size"],
        "brand": row["brand"],
        "model": row["model"],
        "type": row["type"],
        "season": row["season"],
        "dot": row["dot"],
        "current_stock": row["current_stock"],
        "selling_price": row["selling_price"],
        "price_is_final": row["price_is_final"],
        "note": row["note"] or "",
        "category": row["category"] or "",
        "drive_link": row["drive_link"],
        "width": row["width"],
        "profile": row["profile"],
        "wheel_size": row["wheel_size"],
        "size_label": row["size_label"],
        "is_flotation": row["is_flotation"],
    }


def supabase_request(url: str, key: str, method: str, path: str, body: object | None = None, headers: dict | None = None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    target = f"{url.rstrip('/')}{path}"
    request_headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        **(headers or {}),
    }

    def send(context):
        request = urllib.request.Request(target, data=data, method=method, headers=request_headers)
        with urllib.request.urlopen(request, context=context, timeout=60) as response:
            return response.status, response.read().decode("utf-8")

    try:
        return send(ssl.create_default_context())
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Supabase returned {error.code}: {detail[:500]}") from error
    except urllib.error.URLError as error:
        if isinstance(getattr(error, "reason", None), ssl.SSLCertVerificationError):
            return send(ssl._create_unverified_context())
        raise


def insert_rows(url: str, key: str, table: str, rows: list[dict]) -> None:
    records = [database_record(row) for row in rows]
    for start in range(0, len(records), 100):
        supabase_request(
            url,
            key,
            "POST",
            f"/rest/v1/{table}?on_conflict=id",
            records[start:start + 100],
            {"Prefer": "resolution=merge-duplicates,return=minimal"},
        )


def print_summary(rows: list[dict]) -> None:
    from_brand = sum(1 for row in rows if row["quantity"] is not None)
    missing_model = sum(1 for row in rows if row["model"] is None)
    missing_tread = sum(1 for row in rows if row["tread_pattern"] is None)
    print(json.dumps({
        "rows": len(rows),
        "withQuantity": from_brand,
        "nullModel": missing_model,
        "nullTread": missing_tread,
        "sample": [
            {
                "size": row["size"],
                "brand": row["brand"],
                "model": row["model"],
                "tread_pattern": row["tread_pattern"],
                "dot": row["dot"],
                "quantity": row["quantity"],
            }
            for row in rows[:8]
        ],
    }, indent=2))


def main() -> int:
    parser = argparse.ArgumentParser(description="Clean an inventory CSV and load the development table.")
    parser.add_argument("csv", type=Path, help="CSV export from the inventory sheet.")
    parser.add_argument("--table", default=DEFAULT_TABLE, help="Destination table. Defaults to the development inventory table.")
    parser.add_argument("--dry-run", action="store_true", help="Print the cleaned rows without writing to the database.")
    parser.add_argument("--allow-live", action="store_true", help="Allow writing the live usedtireinventory table.")
    args = parser.parse_args()

    if args.table == LIVE_TABLE and not args.allow_live:
        print("Refusing to write the live inventory table. The development table is usedtireinventory_dev.", file=sys.stderr)
        return 2
    if not args.csv.exists():
        print(f"CSV not found: {args.csv}", file=sys.stderr)
        return 2

    rows = read_cleaned_rows(args.csv)
    print_summary(rows)
    if args.dry_run:
        return 0

    env = load_env_file(ROOT / ".netlify" / ".env")
    url = env.get("SUPABASE_URL") or env.get("VITE_SUPABASE_URL") or ""
    key = env.get("SUPABASE_SERVICE_ROLE_KEY") or ""
    if not url or not key:
        print("Supabase credentials are missing from .netlify/.env.", file=sys.stderr)
        return 2

    try:
        insert_rows(url, key, args.table, rows)
    except RuntimeError as error:
        print(error, file=sys.stderr)
        return 1
    print(json.dumps({"inserted": len(rows), "table": args.table}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
