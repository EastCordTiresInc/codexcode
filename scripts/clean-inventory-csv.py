#!/usr/bin/env python3
"""Clean EastCord price-list CSV for Supabase import."""

from __future__ import annotations

import re
import sys
from pathlib import Path

try:
    import pandas as pd
except ImportError:
    print("pandas is required. Install with: pip install pandas", file=sys.stderr)
    sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
INPUT_CSV = ROOT / "inventory" / "EASTCORD PRICES LIST.xlsx - Sheet1.csv"
OUTPUT_CSV = ROOT / "inventory" / "EASTCORD_SUPABASE_INVENTORY.csv"

COLUMN_RENAMES = {
    "Tire Size": "tire_size",
    "Rim size": "rim_size",
    "Type": "type",
    "Brand": "brand",
    "Opening Qty": "opening_qty",
    "Current Stock": "current_stock",
    "SELLING PRICE/TIRE": "selling_price",
    "Column1": "drive_link",
}

DROP_COLUMNS = ["+ Add", "- Remove"]

CREATE_TABLE_SQL = """-- EastCord Tires: inventory import table (from EASTCORD_SUPABASE_INVENTORY.csv)
-- Run in Supabase SQL Editor, then import the CSV via Table Editor or COPY.

create table if not exists public.eastcord_inventory (
  id uuid primary key default gen_random_uuid(),
  tire_size text not null,
  rim_size integer,
  type text,
  brand text not null,
  opening_qty integer not null default 0,
  current_stock integer not null default 0,
  selling_price numeric(10, 2),
  drive_link text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists eastcord_inventory_brand_idx
  on public.eastcord_inventory (brand);

create index if not exists eastcord_inventory_tire_size_idx
  on public.eastcord_inventory (tire_size);

create index if not exists eastcord_inventory_stock_idx
  on public.eastcord_inventory (current_stock);

alter table public.eastcord_inventory enable row level security;
"""


def clean_selling_price(value: object) -> float | None:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None

    text = str(value).strip()
    if not text:
        return None

    cleaned = re.sub(r"[^\d.]", "", text.replace(",", ""))
    if not cleaned:
        return None

    return round(float(cleaned), 2)


def to_int(value: object) -> int | None:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None

    text = str(value).strip()
    if not text:
        return None

    return int(float(text))


def trim_text(value: object) -> str | None:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None

    text = str(value).strip()
    return text if text else None


def main() -> None:
    if not INPUT_CSV.exists():
        print(f"Input file not found: {INPUT_CSV}", file=sys.stderr)
        sys.exit(1)

    raw = pd.read_csv(INPUT_CSV, dtype=str, keep_default_na=False)
    original_rows = len(raw)

    for column in raw.columns:
        raw[column] = raw[column].map(trim_text)

    raw = raw.drop(columns=[col for col in DROP_COLUMNS if col in raw.columns], errors="ignore")
    raw = raw.rename(columns=COLUMN_RENAMES)

    missing_columns = set(COLUMN_RENAMES.values()) - set(raw.columns)
    if missing_columns:
        print(f"Missing expected columns after rename: {sorted(missing_columns)}", file=sys.stderr)
        sys.exit(1)

    essential = raw["brand"].notna() & raw["tire_size"].notna()
    cleaned = raw.loc[essential].copy()

    cleaned["rim_size"] = cleaned["rim_size"].map(to_int)
    cleaned["opening_qty"] = cleaned["opening_qty"].map(to_int)
    cleaned["current_stock"] = cleaned["current_stock"].map(to_int)
    cleaned["selling_price"] = cleaned["selling_price"].map(clean_selling_price)

    for column in ["tire_size", "type", "brand", "drive_link"]:
        cleaned[column] = cleaned[column].map(trim_text)

    cleaned = cleaned[
        [
            "tire_size",
            "rim_size",
            "type",
            "brand",
            "opening_qty",
            "current_stock",
            "selling_price",
            "drive_link",
        ]
    ]

    cleaned.to_csv(OUTPUT_CSV, index=False)

    print(f"Input rows:        {original_rows}")
    print(f"Output rows:       {len(cleaned)}")
    print(f"Rows removed:      {original_rows - len(cleaned)}")
    print(f"Output file:       {OUTPUT_CSV}")
    print()
    print("Sample (first 3 rows):")
    print(cleaned.head(3).to_string(index=False))
    print()
    print("=" * 72)
    print("PostgreSQL CREATE TABLE SQL")
    print("=" * 72)
    print(CREATE_TABLE_SQL)


if __name__ == "__main__":
    main()
