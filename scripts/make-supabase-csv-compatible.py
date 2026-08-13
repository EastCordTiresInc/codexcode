#!/usr/bin/env python3
"""Normalize an inventory CSV for Supabase Table Editor / COPY import."""

from __future__ import annotations

import csv
import sys
from pathlib import Path

try:
    import pandas as pd
except ImportError:
    print("pandas is required. Install with: pip install pandas", file=sys.stderr)
    sys.exit(1)

DEFAULT_CSV = (
    Path(__file__).resolve().parent.parent / "inventory" / "EASTCORD_SUPABASE_FINAL.csv"
)

INTEGER_COLUMNS = [
    "rim_size",
    "opening_qty",
    "add_qty",
    "remove_qty",
    "current_stock",
]

TEXT_COLUMNS = [
    "tire_size",
    "type",
    "brand",
    "drive_link",
]


def parse_boolean(value: object) -> bool:
    text = str(value).strip().lower()
    return text in {"true", "t", "1", "yes", "y"}


def normalize_tire_size(value: object) -> str:
    text = str(value).strip()
    if not text:
        return ""

    if "." in text:
        numeric = float(text)
        if numeric.is_integer():
            return str(int(numeric))
        return format(numeric, "f").rstrip("0").rstrip(".")

    return text


def make_supabase_compatible(input_path: Path, output_path: Path | None = None) -> pd.DataFrame:
    output_path = output_path or input_path

    df = pd.read_csv(input_path, dtype=str, keep_default_na=False)

    for column in TEXT_COLUMNS:
        if column in df.columns:
            df[column] = df[column].map(lambda value: str(value).strip())

    if "tire_size" in df.columns:
        df["tire_size"] = df["tire_size"].map(normalize_tire_size)

    for column in INTEGER_COLUMNS:
        if column in df.columns:
            df[column] = pd.to_numeric(df[column], errors="coerce").fillna(0).astype(int)

    if "selling_price" in df.columns:
        df["selling_price"] = pd.to_numeric(df["selling_price"], errors="coerce").round(2)
        df["selling_price"] = df["selling_price"].map(
            lambda value: "" if pd.isna(value) else f"{value:.2f}"
        )

    if "is_flotation" in df.columns:
        df["is_flotation"] = df["is_flotation"].map(
            lambda value: "true" if parse_boolean(value) else "false"
        )

    df.to_csv(
        output_path,
        index=False,
        encoding="utf-8",
        quoting=csv.QUOTE_MINIMAL,
        lineterminator="\n",
    )

    return df


def main() -> None:
    input_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_CSV
    output_path = Path(sys.argv[2]) if len(sys.argv) > 2 else input_path

    if not input_path.exists():
        print(f"File not found: {input_path}", file=sys.stderr)
        sys.exit(1)

    df = make_supabase_compatible(input_path, output_path)

    print(f"Normalized CSV:  {output_path}")
    print(f"Rows:            {len(df)}")
    print(f"Columns:         {', '.join(df.columns)}")
    print()
    print("Sample (first 3 rows):")
    print(df.head(3).to_string(index=False))


if __name__ == "__main__":
    main()
