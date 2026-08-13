#!/usr/bin/env python3
"""Generate SQL INSERT script for public.usedtireinventory."""

from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
CSV_PATH = ROOT / "inventory" / "EASTCORD_SUPABASE_FINAL.csv"
SQL_PATH = ROOT / "inventory" / "import-usedtireinventory.sql"


def sql_str(value: object) -> str:
    if value is None or str(value).strip() == "":
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"


def sql_num(value: object) -> str:
    if value is None or str(value).strip() == "":
        return "NULL"
    return str(value)


def sql_bool(value: object) -> str:
    return "true" if str(value).strip().lower() == "true" else "false"


def main() -> None:
    df = pd.read_csv(CSV_PATH, dtype=str, keep_default_na=False)

    lines = [
        "-- Paste into Supabase SQL Editor and run",
        "-- Upserts rows into public.usedtireinventory (safe to re-run)",
        "",
        "insert into public.usedtireinventory (",
        "  id, tire_size, rim_size, type, brand, opening_qty, add_qty, remove_qty, current_stock, selling_price, drive_link, is_flotation",
        ") values",
    ]

    values = []
    for _, row in df.iterrows():
        values.append(
            "  ({id}, {tire_size}, {rim_size}, {type}, {brand}, {opening_qty}, {add_qty}, {remove_qty}, {current_stock}, {selling_price}, {drive_link}, {is_flotation})".format(
                id=sql_num(row["id"]),
                tire_size=sql_num(row["tire_size"]),
                rim_size=sql_num(row["rim_size"]),
                type=sql_str(row["type"]),
                brand=sql_str(row["brand"]),
                opening_qty=sql_num(row["opening_qty"]),
                add_qty=sql_num(row["add_qty"]),
                remove_qty=sql_num(row["remove_qty"]),
                current_stock=sql_num(row["current_stock"]),
                selling_price=sql_num(row["selling_price"]),
                drive_link=sql_str(row["drive_link"]),
                is_flotation=sql_bool(row["is_flotation"]),
            )
        )

    lines.append(",\n".join(values))
    lines.append("on conflict (id) do update set")
    lines.append("  tire_size = excluded.tire_size,")
    lines.append("  rim_size = excluded.rim_size,")
    lines.append("  type = excluded.type,")
    lines.append("  brand = excluded.brand,")
    lines.append("  opening_qty = excluded.opening_qty,")
    lines.append("  add_qty = excluded.add_qty,")
    lines.append("  remove_qty = excluded.remove_qty,")
    lines.append("  current_stock = excluded.current_stock,")
    lines.append("  selling_price = excluded.selling_price,")
    lines.append("  drive_link = excluded.drive_link,")
    lines.append("  is_flotation = excluded.is_flotation;")
    SQL_PATH.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {SQL_PATH}")
    print(f"Rows: {len(df)}")


if __name__ == "__main__":
    main()
