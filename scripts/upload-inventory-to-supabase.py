#!/usr/bin/env python3
"""Clean EastCord inventory CSV and upload to Supabase (EastCordTiresInv)."""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

try:
    import pandas as pd
except ImportError:
    print("pandas is required. Install with: pip install pandas", file=sys.stderr)
    sys.exit(1)

try:
    from supabase import create_client
except ImportError:
    print("supabase is required. Install with: pip install supabase", file=sys.stderr)
    sys.exit(1)

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

ROOT = Path(__file__).resolve().parent.parent
INPUT_CSV = ROOT / "inventory" / "EASTCORD PRICES LIST.xlsx - Sheet1.csv"
OUTPUT_CSV = ROOT / "inventory" / "EASTCORD_SUPABASE_FINAL.csv"
TABLE_NAME = "inventory"
BATCH_SIZE = 100
UPSERT_CONFLICT_COLUMNS = "tire_size,brand,rim_size,type"

COLUMN_RENAMES = {
    "Tire Size": "tire_size",
    "Rim size": "rim_size",
    "Type": "type",
    "Brand": "brand",
    "Opening Qty": "opening_qty",
    "+ Add": "add_qty",
    "- Remove": "remove_qty",
    "Current Stock": "current_stock",
    "SELLING PRICE/TIRE": "selling_price",
    "Column1": "drive_link",
}

OUTPUT_COLUMNS = [
    "tire_size",
    "rim_size",
    "type",
    "brand",
    "opening_qty",
    "add_qty",
    "remove_qty",
    "current_stock",
    "selling_price",
    "drive_link",
    "is_flotation",
]

CREATE_TABLE_SQL = """-- EastCord Tires: inventory table (EastCordTiresInv)
-- Run in Supabase SQL Editor before importing EASTCORD_SUPABASE_FINAL.csv

create table if not exists public.inventory (
  id uuid primary key default gen_random_uuid(),
  tire_size text not null,
  rim_size integer,
  type text,
  brand text not null,
  opening_qty integer not null default 0,
  add_qty integer not null default 0,
  remove_qty integer not null default 0,
  current_stock integer not null default 0,
  selling_price numeric(10, 2),
  drive_link text,
  is_flotation boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_unique_tire unique (tire_size, brand, rim_size, type)
);

create index if not exists inventory_brand_idx on public.inventory (brand);
create index if not exists inventory_tire_size_idx on public.inventory (tire_size);
create index if not exists inventory_stock_idx on public.inventory (current_stock);
create index if not exists inventory_flotation_idx on public.inventory (is_flotation);

alter table public.inventory enable row level security;
"""

FLOTATION_X_PATTERN = re.compile(r"\d+[xX]\d", re.IGNORECASE)
FLOTATION_DECIMAL_PATTERN = re.compile(r"^\d+\.\d+$")


def load_environment() -> None:
    if load_dotenv is not None:
        load_dotenv(ROOT / ".env")


def get_supabase_credentials() -> tuple[str, str]:
    url = (
        os.getenv("SUPABASE_URL")
        or os.getenv("VITE_SUPABASE_URL")
        or ""
    ).strip()
    key = (
        os.getenv("SUPABASE_KEY")
        or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        or os.getenv("VITE_SUPABASE_ANON_KEY")
        or ""
    ).strip()

    if not url or not key:
        raise RuntimeError(
            "Missing Supabase credentials. Set SUPABASE_URL and SUPABASE_KEY "
            "(or SUPABASE_SERVICE_ROLE_KEY) in your environment or .env file."
        )

    return url, key


def trim_text(value: object) -> str | None:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None

    text = str(value).strip()
    return text if text else None


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


def to_int_or_zero(value: object) -> int:
    parsed = to_int(value)
    return parsed if parsed is not None else 0


def is_flotation_tire(tire_size: object) -> bool:
    text = trim_text(tire_size)
    if not text:
        return False

    if FLOTATION_X_PATTERN.search(text):
        return True

    if FLOTATION_DECIMAL_PATTERN.match(text):
        return True

    return False


def clean_inventory_dataframe() -> pd.DataFrame:
    if not INPUT_CSV.exists():
        raise FileNotFoundError(f"Input file not found: {INPUT_CSV}")

    raw = pd.read_csv(INPUT_CSV, dtype=str, keep_default_na=False)
    original_rows = len(raw)

    for column in raw.columns:
        raw[column] = raw[column].map(trim_text)

    raw = raw.rename(columns=COLUMN_RENAMES)

    missing_columns = set(COLUMN_RENAMES.values()) - set(raw.columns)
    if missing_columns:
        raise ValueError(f"Missing expected columns after rename: {sorted(missing_columns)}")

    essential = raw["brand"].notna() & raw["tire_size"].notna()
    cleaned = raw.loc[essential].copy()

    cleaned["rim_size"] = cleaned["rim_size"].map(to_int)
    cleaned["opening_qty"] = cleaned["opening_qty"].map(to_int_or_zero)
    cleaned["add_qty"] = cleaned["add_qty"].map(to_int_or_zero)
    cleaned["remove_qty"] = cleaned["remove_qty"].map(to_int_or_zero)
    cleaned["current_stock"] = cleaned["current_stock"].map(to_int_or_zero)
    cleaned["selling_price"] = cleaned["selling_price"].map(clean_selling_price)
    cleaned["is_flotation"] = cleaned["tire_size"].map(is_flotation_tire)

    for column in ["tire_size", "type", "brand", "drive_link"]:
        cleaned[column] = cleaned[column].map(trim_text)

    cleaned = cleaned[OUTPUT_COLUMNS]
    cleaned.to_csv(OUTPUT_CSV, index=False)

    flotation_count = int(cleaned["is_flotation"].sum())
    print(f"Input rows:        {original_rows}")
    print(f"Output rows:       {len(cleaned)}")
    print(f"Rows removed:      {original_rows - len(cleaned)}")
    print(f"Flotation tires:   {flotation_count}")
    print(f"Saved CSV:         {OUTPUT_CSV}")
    print()
    print("Sample (first 3 rows):")
    print(cleaned.head(3).to_string(index=False))

    return cleaned


def dataframe_to_records(df: pd.DataFrame) -> list[dict]:
    records: list[dict] = []
    for row in df.to_dict(orient="records"):
        record = {}
        for key, value in row.items():
            if pd.isna(value):
                record[key] = None
            elif isinstance(value, (bool, int, float, str)):
                record[key] = value
            else:
                record[key] = str(value)
        records.append(record)
    return records


def upload_to_supabase(df: pd.DataFrame) -> int:
    url, key = get_supabase_credentials()
    supabase = create_client(url, key)
    records = dataframe_to_records(df)

    uploaded = 0
    for start in range(0, len(records), BATCH_SIZE):
        batch = records[start : start + BATCH_SIZE]
        response = (
            supabase.table(TABLE_NAME)
            .upsert(batch, on_conflict=UPSERT_CONFLICT_COLUMNS)
            .execute()
        )
        uploaded += len(response.data or batch)

    return uploaded


def main() -> None:
    load_environment()
    cleaned = clean_inventory_dataframe()

    print()
    print("=" * 72)
    print("PostgreSQL CREATE TABLE SQL")
    print("=" * 72)
    print(CREATE_TABLE_SQL)

    print("Uploading to Supabase...")
    print(f"Project table:     {TABLE_NAME}")
    print(f"Conflict columns:  {UPSERT_CONFLICT_COLUMNS}")

    uploaded_count = upload_to_supabase(cleaned)

    print()
    print("=" * 72)
    print(f"SUCCESS: Uploaded {uploaded_count} inventory rows to Supabase ({TABLE_NAME}).")
    print("=" * 72)


if __name__ == "__main__":
    main()
