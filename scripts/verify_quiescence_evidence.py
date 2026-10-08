"""Main-task readback of archived synthetic DBs using the final bundled peer.

No archive path is extracted verbatim and no Production file is opened.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "evidence/quiescence"
PEER = ROOT / "src-tauri/target/debug/quiescence_competitor"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def query_database(data, sql):
    with tempfile.TemporaryDirectory(prefix="pfc-main-evidence-") as temporary:
        root = Path(temporary).resolve()
        (root / "SYNTHETIC_ONLY").write_text("PFC_QUIESCENCE_SYNTHETIC_V1\n")
        (root / "personal-finance-console.sqlite3").write_bytes(data)
        request = "\n".join(json.dumps({"action": "sql", "sql": item, "query": True}) for item in sql)
        result = subprocess.run([str(PEER), str(root)], input=request + '\n{"action":"close"}\n', text=True, capture_output=True, timeout=20, check=True)
        rows = [json.loads(line) for line in result.stdout.splitlines()]
        assert rows[0]["event"] == "opened" and rows[-1]["event"] == "closed", rows
        assert all(row.get("ok") for row in rows[1:-1]), rows
        assert len(rows) == len(sql) + 2
        return rows


def main():
    evidence_path = EVIDENCE / "authoritative-final.json"
    source = json.loads(evidence_path.read_text())
    assert not source.get("controller_error")
    assert set(source["q_matrix"]) == {f"Q{i:02}" for i in range(1, 19)}
    assert source["q_matrix"]["Q11"]["status"] == "NOT_RUN"
    archive_path = EVIDENCE / "authoritative-final-fixtures.tar.gz"
    with tarfile.open(archive_path, "r:gz") as archive:
        names = archive.getnames()
        assert len(names) == len(set(names))
        for name in names:
            path = Path(name)
            assert not path.is_absolute() and ".." not in path.parts
            member = archive.getmember(name)
            # This negative fixture intentionally preserves a symlink as
            # evidence. Never extract/follow it; validate its synthetic target.
            if member.issym() or member.islnk():
                assert name == "native-reject-db_symlink/personal-finance-console.sqlite3"
                assert member.issym()
                assert member.linkname == source["fixture_root"] + "/native-reject-db_symlink/separate-synthetic.sqlite3"
            assert "native-runner" not in path.parts
        for name in ["native-success/backup.sqlite3", "native-success/personal-finance-console.sqlite3", "native-success/outcome.json"]:
            assert archive.getmember(name).isfile()
        before = archive.extractfile("native-success/backup.sqlite3").read()
        after = archive.extractfile("native-success/personal-finance-console.sqlite3").read()
        outcome = json.load(archive.extractfile("native-success/outcome.json"))
        assert outcome["state"] == "V4_VERIFIED" and outcome["details"]["sha256"] == sha(after)
    expected_schema = json.loads((ROOT / "migrations/v4-schema.json").read_text())
    tables = [item["name"] for item in json.loads((ROOT / "migrations/v3-schema.json").read_text())
              if item["type"] == "table" and item["name"] not in {"schema_migrations", "sqlite_sequence"}]
    business_queries = [f'SELECT * FROM "{table}"' for table in tables]
    prior = query_database(before, business_queries)
    sql = ["PRAGMA user_version", "SELECT version FROM schema_migrations ORDER BY version", "PRAGMA integrity_check", "PRAGMA foreign_key_check", "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type,name"]
    current = query_database(after, sql + business_queries)
    assert current[1]["rows"] == [{"user_version": 4}]
    assert current[2]["rows"] == [{"version": i} for i in range(1, 5)]
    assert current[3]["rows"] == [{"integrity_check": "ok"}] and current[4]["rows"] == []
    assert current[5]["rows"] == expected_schema
    for old, new in zip(prior[1:-1], current[6:-1]):
        normalize = lambda rows: sorted(json.dumps(row, sort_keys=True) for row in rows)
        assert normalize(old["rows"]) == normalize(new["rows"]), (old, new)
    counts = {status: sum(row["status"] == status for row in source["q_matrix"].values()) for status in {"PASS", "PARTIAL", "NOT_RUN"}}
    result = {"verified": True, "production_access": False, "archive_members": len(names), "archive_sha256": sha(archive_path.read_bytes()), "experiment_sha256": sha(evidence_path.read_bytes()), "q_status_counts": counts, "main_task_exact_schema_and_all_legacy_tables_equal": True, "legacy_tables": tables, "peer_metadata": current[0], "readback": current, "source_sha256_at_readback": {name: sha((ROOT / name).read_bytes()) for name in source["events"][0]["source_sha256"]}}
    (EVIDENCE / "main-verification.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({key: value for key, value in result.items() if key not in {"readback", "peer_metadata", "source_sha256_at_readback"}}, indent=2))


if __name__ == "__main__":
    main()
