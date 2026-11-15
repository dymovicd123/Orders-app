#!/usr/bin/env python3
"""Strict, read-only guard for manually staged Branch2 D1 backup/migrations.

This file NEVER executes a database mutation. All Cloudflare API calls below
are database metadata GET or a SELECT of SQLite schema-capability counters.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import urllib.error
import urllib.request

EXPECTED_WORKER = "orders-app-branch2"
EXPECTED_DB = "orders_db_branch2_mirror_20261027"
EXPECTED_DB_ID = "0904a573-21ff-44d8-93b0-c9200f771702"
EXPECTED_MAIN_WORKER = "orders-app"
EXPECTED_MAIN_DB = "orders_db_prod"
EXPECTED_MAIN_DB_ID = "17e68a41-1d58-4a36-8a63-47c3e32443c4"
WORKFLOW_NAME = "Cloudflare Branch2 - Backup and Prepare Return V2"
TABLES = (
    "return_v2_prepared_operations",
    "return_v2_prepared_items",
    "return_v2_postings",
    "return_v2_cancellations",
    "return_v2_unified_postings",
    "return_v2_unified_lines",
    "return_v2_unified_cancellations",
    "return_v2_metadata_edits",
    "return_v2_resumed_dispatches",
)
COLUMNS = (
    ("return_items", "contract_quantity_applied"),
    ("return_v2_prepared_operations", "baseline_order_updated_at"),
    ("return_v2_prepared_items", "baseline_order_item_quantity"),
    ("return_v2_unified_postings", "intent_fingerprint"),
    ("return_v2_unified_lines", "receipt_intent"),
    ("return_v2_unified_lines", "reservation_release"),
    ("return_v2_unified_lines", "stock_quantity_change"),
    ("return_v2_unified_cancellations", "refund_recovered_at"),
    ("return_v2_metadata_edits", "intent_json"),
    ("return_v2_resumed_dispatches", "expected_order_version"),
)
MIGRATIONS = (
    "0124_return_v2_prepared_journal.sql",
    "0125_return_v2_contract_quantity_marker.sql",
    "0126_return_v2_posting_prototype.sql",
    "0127_return_v2_cancellation_prototype.sql",
    "0128_return_v2_unified_posting_prototype.sql",
    "0129_return_v2_unified_receipt_intent.sql",
    "0130_return_v2_unified_cancel_prototype.sql",
    "0131_return_v2_metadata_edits.sql",
    "0132_return_v2_resumed_dispatch_prototype.sql",
)
# Approved immutable Git blob digests for the exact ADDITIVE migration bytes.
# If Branch2 changes these SQL files, stop and request a new source review.
MIGRATION_BLOBS = (
    "7e1c0e671c06665c46e28f27810c4aee73a9e948",
    "4f42fac3c7b13ff3a0e9d48cba530ff87535ca1a",
    "3395090a24f7a82f6d149a6f43ede4e8d7b8d5f6",
    "8257c815c90e1611b91e31ca8f387fcf5d45220f",
    "dd2cc5e2cb6a4c9d202d5528b8982ad52a12b7c8",
    "e8cacf2eedb89344582e214a90175c13b96f0e42",
    "6d8c8282efe6a3205dd3041083e42bf4006b94af",
    "ff804aabdcf3087cfff06045e38f7130a9f032e4",
    "9f7c75d56df907f448c6c1a64d5e0ae8482cc5f0",
)
# Expected cumulatively, using the *exact* migration source definitions.
CHECKPOINTS = (
    (0, 0),
    (2, 0),
    (2, 1),
    (3, 3),
    (4, 3),
    (6, 6),
    (6, 7),
    (7, 8),
    (8, 9),
    (9, 10),
)


def fail(message):
    print("STOP:", message, file=sys.stderr)
    raise SystemExit(2)


def http_json(url, token, body=None):
    headers = {"Accept": "application/json", "Authorization": "Bearer " + token}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, headers=headers, data=data,
                                 method="POST" if data is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=35) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as exc:
        try:
            response = json.loads(exc.read().decode())
        except ValueError:
            response = {}
        return exc.code, response


def check_local_target(stage):
    # Validate both tracked environment identities *before* any mutating CLI.
    # This code is checked out from main but runs Wrangler exclusively with
    # the separately checked-out Branch2 configuration and exact D1 ID.
    main_config_path = Path(__file__).resolve().parents[2] / "wrangler.jsonc"
    if not main_config_path.is_file():
        fail("Production identity file unavailable; cannot prove D1 separation.")
    main_config = main_config_path.read_text(encoding="utf-8")
    def main_value(field):
        found = re.findall(r'"' + re.escape(field) + r'"\s*:\s*"([^"]+)"', main_config)
        if len(found) != 1:
            fail("Could not unambiguously read Main " + field + ".")
        return found[0]
    if (main_value("name") != EXPECTED_MAIN_WORKER
            or main_value("database_name") != EXPECTED_MAIN_DB
            or main_value("database_id") != EXPECTED_MAIN_DB_ID):
        fail("Main environment identity unexpectedly changed; aborting safely.")
    if EXPECTED_DB_ID == EXPECTED_MAIN_DB_ID or EXPECTED_DB == EXPECTED_MAIN_DB:
        fail("Branch2 and Main databases are not distinct.")

    config_file = stage / "wrangler.jsonc"
    if not config_file.is_file():
        fail("Expected branch2 wrangler.jsonc is missing.")
    config = json.loads(config_file.read_text(encoding="utf-8"))
    if config.get("name") != EXPECTED_WORKER:
        fail("Worker target is not Branch2.")
    dbs = config.get("d1_databases", [])
    if len(dbs) != 1 or dbs[0].get("binding") != "DB":
        fail("Expected exactly one Branch2 DB binding.")
    if dbs[0].get("database_name") != EXPECTED_DB or dbs[0].get("database_id") != EXPECTED_DB_ID:
        fail("Unexpected D1 database name/ID; refusing any remote operations.")
    if str(config.get("vars", {}).get("RETURN_V2_ENABLED", "")).lower() == "true":
        fail("Return V2 is already ON in Wrangler config. STOP and investigate.")
    for migration, approved_blob in zip(MIGRATIONS, MIGRATION_BLOBS):
        path = stage / "migrations" / migration
        if not path.is_file():
            fail("Missing migration: " + migration)
        content = path.read_bytes()
        blob = hashlib.sha1(
            b"blob " + str(len(content)).encode("ascii") + b"\0" + content
        ).hexdigest()
        if blob != approved_blob:
            fail("Migration SQL differs from approved Branch2 bytes: " + migration)
    print("PASS: separate Main/Branch2 identities and 9 approved SQL files.")
    return True


def sql_counters():
    names = ",".join("'" + table + "'" for table in TABLES)
    columns = " + ".join(
        "(SELECT COUNT(*) FROM pragma_table_info('%s') WHERE name='%s')" % (table, column)
        for table, column in COLUMNS
    )
    return (
        "SELECT (SELECT COUNT(*) FROM sqlite_master WHERE type='table' "
        "AND name IN (%s)) AS table_count, (%s) AS column_count"
    ) % (names, columns)


def check_remote_db(account, token, expected_index):
    base = "https://api.cloudflare.com/client/v4/accounts/" + account + "/d1/database/" + EXPECTED_DB_ID
    code, metadata = http_json(base, token)
    if code != 200 or not metadata.get("success"):
        fail("Cloudflare cannot read Branch2 D1 metadata (HTTP %s). Check secrets and permissions." % code)
    if metadata.get("result", {}).get("name") != EXPECTED_DB:
        fail("D1 ID has an unexpected name; no migration is safe.")
    code, result = http_json(base + "/query", token,
                             {"sql": sql_counters(), "params": []})
    if code != 200 or not result.get("success"):
        fail("Cloudflare D1 schema SELECT failed (HTTP %s)." % code)
    statements = result.get("result", [])
    try:
        rows = statements[0]["results"]
        actual = (int(rows[0]["table_count"]), int(rows[0]["column_count"]))
    except (ValueError, IndexError, KeyError, TypeError):
        fail("Cloudflare returned an unexpected D1 query result.")
    if statements[0].get("meta", {}).get("changes", 0):
        fail("Read-only schema SELECT unexpectedly reported changes.")
    print("Branch2 D1 schema:", actual[0], "/9 tables;", actual[1], "/10 key columns.")
    if actual != CHECKPOINTS[expected_index]:
        fail("Schema is not at the expected checkpoint %s. Do NOT retry an ALTER blindly." %
             expected_index)
    print("PASS: matching Branch2 D1, migration checkpoint", expected_index)
    return actual


def backup_evidence(repo, github_token, run_id):
    if not run_id.isdigit() or int(run_id) <= 0:
        fail("A numeric, completed backup workflow run ID is required.")
    if not github_token:
        fail("GitHub token with actions:read is unavailable.")
    root = "https://api.github.com/repos/" + repo + "/actions"
    def gh(url):
        req = urllib.request.Request(
            url, headers={"Accept": "application/vnd.github+json",
                          "Authorization": "Bearer " + github_token,
                          "X-GitHub-Api-Version": "2022-11-28"})
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            fail("Cannot verify the backup artifact through GitHub API (HTTP %s)." % exc.code)
    run = gh(root + "/runs/" + run_id)
    if (run.get("name") != WORKFLOW_NAME or run.get("head_branch") != "main"
            or run.get("event") != "workflow_dispatch"
            or run.get("conclusion") != "success"):
        fail("Backup run is not a successful manual main workflow of the expected name.")
    created = datetime.datetime.fromisoformat(run["created_at"].replace("Z", "+00:00"))
    age = datetime.datetime.now(datetime.timezone.utc) - created
    if age.total_seconds() < 0 or age.total_seconds() > 12 * 3600:
        fail("Backup is older than 12 hours; make a fresh Branch2 backup.")
    response = gh(root + "/runs/" + run_id + "/artifacts")
    wanted = "branch2-d1-before-return-v2-" + run_id
    artifacts = [a for a in response.get("artifacts", [])
                 if a.get("name") == wanted and not a.get("expired")]
    if len(artifacts) != 1 or int(artifacts[0].get("size_in_bytes", 0)) < 1024:
        fail("Cannot find one fresh, nonempty Branch2 D1 backup artifact.")
    print("PASS: recent successful backup artifact exists (run ID", run_id + ").")
    print("IMPORTANT: operator must download this archive before starting migrations.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--stage", default="stage")
    parser.add_argument("--expected-index", type=int, required=True)
    parser.add_argument("--backup-run-id", default="")
    args = parser.parse_args()
    if args.expected_index < 0 or args.expected_index >= len(CHECKPOINTS):
        fail("Invalid migration checkpoint.")
    stage = Path(args.stage)
    check_local_target(stage)
    token = os.environ.get("CLOUDFLARE_API_TOKEN", "").strip()
    account = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "").strip()
    if not token or len(account) != 32 or not all(c in "abcdefABCDEF0123456789" for c in account):
        fail("Cloudflare API token or Account ID repository secrets are missing/invalid.")
    if args.backup_run_id:
        backup_evidence(os.environ.get("GITHUB_REPOSITORY", ""),
                        os.environ.get("GH_TOKEN", ""), args.backup_run_id)
    check_remote_db(account, token, args.expected_index)


if __name__ == "__main__":
    main()
