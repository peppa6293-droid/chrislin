#!/usr/bin/env python3
"""R9-03 schema diff driver. READ-ONLY; reads the captured .schema dump only.

Compares the captured real V3 schema (33-schema.log) against:
  - migrations/003-bootstrap.sql executed into an in-memory SQLite database
  - migrations/v3-schema.json (accepted V3 sqlite_master snapshot)

Never opens the real database. Emits one JSON object with every structural
difference; an empty "differences" list means byte-level DDL agreement after
IF NOT EXISTS / whitespace normalization.
"""

from __future__ import annotations

import json
import re
import sqlite3
import sys
from pathlib import Path

SKIP_TABLE = "sqlite_sequence"


def norm_sql(sql: str) -> str:
    value = re.sub(r"\bIF\s+NOT\s+EXISTS\b", "", sql, flags=re.IGNORECASE)
    value = re.sub(r"\s+", " ", value).strip()
    return value.rstrip(";")


def split_statements(text: str) -> list[str]:
    statements: list[str] = []
    buffer: list[str] = []
    for line in text.splitlines():
        if line.strip() == "" and not buffer:
            continue
        buffer.append(line)
        if sqlite3.complete_statement("\n".join(buffer)):
            statements.append("\n".join(buffer).strip())
            buffer = []
    if buffer and "\n".join(buffer).strip():
        statements.append("\n".join(buffer).strip())
    return statements


def snapshot(connection: sqlite3.Connection) -> dict:
    tables = [
        row[0]
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY 1"
        )
    ]
    result: dict = {"tables": {}, "migrationsTableSql": None}
    for table in tables:
        columns = [
            {
                "cid": row[0], "name": row[1], "type": row[2], "notnull": row[3],
                "default": row[4], "pk": row[5],
            }
            for row in connection.execute(f'PRAGMA table_info("{table}")')
        ]
        fks = [
            {
                "id": row[0], "seq": row[1], "table": row[2], "from": row[3],
                "to": row[4], "on_update": row[5], "on_delete": row[6],
            }
            for row in connection.execute(f'PRAGMA foreign_key_list("{table}")')
        ]
        indexes = []
        for row in connection.execute(f'PRAGMA index_list("{table}")'):
            name = row[1]
            columns_in_index = [item[2] for item in connection.execute(f'PRAGMA index_info("{name}")')]
            indexes.append({"name": name, "unique": row[2], "origin": row[3], "columns": columns_in_index})
        create_sql = connection.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table,)
        ).fetchone()
        result["tables"][table] = {
            "columns": columns,
            "foreign_keys": fks,
            "indexes": sorted(indexes, key=lambda item: item["name"]),
            "createSql": norm_sql(create_sql[0]) if create_sql and create_sql[0] else None,
        }
    indexes = {}
    for row in connection.execute(
        "SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' ORDER BY name"
    ):
        if row[0].startswith("sqlite_autoindex"):
            continue
        indexes[row[0]] = {"table": row[1], "createSql": norm_sql(row[2]) if row[2] else None}
    result["indexes"] = indexes
    return result


def build_from_statements(statements: list[str]) -> sqlite3.Connection:
    connection = sqlite3.connect(":memory:")
    usable = [
        statement for statement in statements
        if not norm_sql(statement).startswith("CREATE TABLE sqlite_sequence")
        and not norm_sql(statement).startswith("ALTER TABLE")
    ]
    ordered = [s for s in usable if norm_sql(s).upper().startswith("CREATE TABLE")] + [
        s for s in usable if not norm_sql(s).upper().startswith("CREATE TABLE")
    ]
    for statement in ordered:
        connection.executescript(statement)
    return connection


def compare(left: dict, right: dict, left_label: str, right_label: str) -> list[dict]:
    differences: list[dict] = []
    left_tables = left["tables"]
    right_tables = right["tables"]
    for table in sorted(set(left_tables) | set(right_tables)):
        if table not in right_tables:
            differences.append({"kind": "table_missing_in_" + right_label, "table": table})
            continue
        if table not in left_tables:
            differences.append({"kind": "table_missing_in_" + left_label, "table": table})
            continue
        a, b = left_tables[table], right_tables[table]
        if a["createSql"] != b["createSql"]:
            differences.append({
                "kind": "table_sql_mismatch", "table": table,
                "left": a["createSql"], "right": b["createSql"],
            })
        if a["columns"] != b["columns"]:
            differences.append({"kind": "columns_mismatch", "table": table, "left": a["columns"], "right": b["columns"]})
        if a["foreign_keys"] != b["foreign_keys"]:
            differences.append({"kind": "foreign_keys_mismatch", "table": table, "left": a["foreign_keys"], "right": b["foreign_keys"]})
        if a["indexes"] != b["indexes"]:
            differences.append({"kind": "table_indexes_mismatch", "table": table, "left": a["indexes"], "right": b["indexes"]})
    for name in sorted(set(left["indexes"]) | set(right["indexes"])):
        if name not in right["indexes"]:
            differences.append({"kind": "index_missing_in_" + right_label, "index": name})
        elif name not in left["indexes"]:
            differences.append({"kind": "index_missing_in_" + left_label, "index": name})
        elif left["indexes"][name] != right["indexes"][name]:
            differences.append({"kind": "index_sql_mismatch", "index": name, "left": left["indexes"][name], "right": right["indexes"][name]})
    return differences


def main() -> int:
    if len(sys.argv) != 4:
        print("usage: driver <repo-root> <schema-log> <output-json>")
        return 1
    repo = Path(sys.argv[1]).resolve(strict=True)
    schema_log = Path(sys.argv[2]).resolve(strict=True)
    output = Path(sys.argv[3])

    real_sql = schema_log.read_text(encoding="utf-8")
    real_statements = split_statements(real_sql)
    real = snapshot(build_from_statements(real_statements))

    bootstrap = (repo / "migrations/003-bootstrap.sql").read_text(encoding="utf-8")
    bootstrap_connection = sqlite3.connect(":memory:")
    bootstrap_connection.executescript(bootstrap)
    bootstrap_snapshot = snapshot(bootstrap_connection)

    accepted = json.loads((repo / "migrations/v3-schema.json").read_text(encoding="utf-8"))
    accepted_statements = [row["sql"] for row in accepted if row.get("sql")]
    accepted_snapshot = snapshot(build_from_statements(accepted_statements))

    report = {
        "syntheticOnly": False,
        "scope": "schema structure only; no row data read into this driver",
        "realTableCount": len(real["tables"]),
        "realIndexCount": len(real["indexes"]),
        "bootstrapTableCount": len(bootstrap_snapshot["tables"]),
        "acceptedTableCount": len(accepted_snapshot["tables"]),
        "differencesVs003": compare(real, bootstrap_snapshot, "real", "003"),
        "differencesVsV3SchemaJson": compare(real, accepted_snapshot, "real", "v3json"),
    }
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: report[key] for key in (
        "realTableCount", "realIndexCount", "bootstrapTableCount", "acceptedTableCount",
    )}, ensure_ascii=False))
    print(f"differencesVs003={len(report['differencesVs003'])}")
    print(f"differencesVsV3SchemaJson={len(report['differencesVsV3SchemaJson'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
