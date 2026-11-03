import json
import os
import re
from datetime import datetime

import boto3
import pymysql

_secrets_client = boto3.client("secretsmanager")
_cached_secret = None

RDS_HOST = os.environ["RDS_HOST"]
RDS_PORT = int(os.environ.get("RDS_PORT", "3306"))
RDS_DB = os.environ["RDS_DB"]
RDS_SECRET_ARN = os.environ["RDS_SECRET_ARN"]

TOPIC_RE = re.compile(r"^r2d2/(?P<machine>[^/]+)/oee/(?P<event_kind>[^/]+)$")


def _get_credentials():
    global _cached_secret
    if _cached_secret is None:
        value = _secrets_client.get_secret_value(SecretId=RDS_SECRET_ARN)
        _cached_secret = json.loads(value["SecretString"])
    return _cached_secret["username"], _cached_secret["password"]


def _connect():
    username, password = _get_credentials()
    return pymysql.connect(
        host=RDS_HOST,
        port=RDS_PORT,
        user=username,
        password=password,
        database=RDS_DB,
        autocommit=True,
        connect_timeout=5,
    )


def _parse_ts(raw_ts):
    return datetime.strptime(raw_ts, "%Y-%m-%dT%H:%M:%S.%fZ")


def handler(event, context):
    state = event.get("state", {})

    row = (
        event.get("v"),
        _parse_ts(event["ts"]),
        event.get("run_id"),
        event.get("machine"),
        event.get("event"),
        json.dumps(event.get("detail")) if event.get("detail") is not None else None,
        state.get("gear"),
        state.get("conveyor"),
        state.get("output"),
    )

    conn = _connect()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO machine_events
                    (v, ts, run_id, machine, event, detail, gear, conveyor, output)
                VALUES
                    (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                row,
            )
    finally:
        conn.close()

    return {"status": "ok"}
