"""Rotate the astra_app MySQL password held in AWS Secrets Manager, with no
downtime ("alternating users").

There are two MySQL accounts with identical rights, astra_app and
astra_app_clone, and only one of them is in the secret at a time. Each rotation
sets a NEW password on the account that is not in use, then switches the secret
to it. The account that was in use keeps its old password untouched, so pods
that have not yet picked up the new secret can still connect. Nothing breaks
while External Secrets and the pods catch up.

Secrets Manager calls this four times per rotation:

  createSecret  pick the other account and generate a password for it (AWSPENDING)
  setSecret     with the master login: create that account if needed, copy the
                current account's rights onto it, and set the new password
  testSecret    log in as the other account with the new password
  finishSecret  make it AWSCURRENT

Each step can be retried, so each one checks what has already been done.

Environment (never read from the secret, so a secret cannot redirect this
function to another host or another login):
  DB_HOST             the RDS endpoint
  DB_PORT             3306
  MASTER_SECRET_ARN   the RDS-managed master secret, used only in setSecret
"""

import json
import logging
import os
import re
import ssl

import boto3
import pymysql

logger = logging.getLogger()
logger.setLevel(logging.INFO)

sm = boto3.client("secretsmanager")

PASSWORD_LENGTH = 40
CLONE_SUFFIX = "_clone"
# Names go into SQL text (a user name cannot be a bound parameter in GRANT), so
# only plain characters are accepted.
USER_RE = re.compile(r"^[A-Za-z0-9_]{1,32}$")
HOST_RE = re.compile(r"^[0-9A-Za-z.%_-]{1,60}$")


def handler(event, _context):
    arn = event["SecretId"]
    token = event["ClientRequestToken"]
    step = event["Step"]

    metadata = sm.describe_secret(SecretId=arn)
    if not metadata.get("RotationEnabled"):
        raise ValueError(f"Rotation is not enabled for secret {arn}")
    versions = metadata["VersionIdsToStages"]
    if token not in versions:
        raise ValueError(f"Version {token} has no stage for rotation of {arn}")
    if "AWSCURRENT" in versions[token]:
        logger.info("Version %s is already AWSCURRENT; nothing to do", token)
        return
    if "AWSPENDING" not in versions[token]:
        raise ValueError(f"Version {token} is not AWSPENDING for rotation of {arn}")

    steps = {
        "createSecret": create_secret,
        "setSecret": set_secret,
        "testSecret": test_secret,
        "finishSecret": finish_secret,
    }
    if step not in steps:
        raise ValueError(f"Unknown step {step}")
    steps[step](arn, token)


def _get(arn, stage, token=None):
    kwargs = {"SecretId": arn, "VersionStage": stage}
    if token:
        kwargs["VersionId"] = token
    return json.loads(sm.get_secret_value(**kwargs)["SecretString"])


def _master():
    return json.loads(sm.get_secret_value(SecretId=os.environ["MASTER_SECRET_ARN"])["SecretString"])


def _connect(login):
    """Open a connection as the user in `login`. Encrypted, not verified: the
    traffic stays inside the VPC, and this keeps passwords off the wire in
    clear when they are set."""
    context = ssl.create_default_context()
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    return pymysql.connect(
        host=os.environ["DB_HOST"],
        port=int(os.environ.get("DB_PORT", "3306")),
        user=login["username"],
        password=login["password"],
        connect_timeout=5,
        read_timeout=10,
        write_timeout=10,
        ssl=context,
    )


def _can_login(login):
    try:
        _connect(login).close()
        return True
    except pymysql.err.OperationalError:
        return False


def _other(username):
    """astra_app <-> astra_app_clone."""
    if username.endswith(CLONE_SUFFIX):
        other = username[: -len(CLONE_SUFFIX)]
    else:
        other = username + CLONE_SUFFIX
    if not USER_RE.match(other):
        raise ValueError(f"Cannot alternate the user name {username!r}")
    return other


def create_secret(arn, token):
    current = _get(arn, "AWSCURRENT")
    try:
        _get(arn, "AWSPENDING", token)
        logger.info("createSecret: a pending version already exists")
        return
    except sm.exceptions.ResourceNotFoundException:
        pass

    if not USER_RE.match(current["username"]):
        raise ValueError("The secret's user name has unexpected characters")
    # Letters and digits only, so the password never needs escaping in a URL.
    new_password = sm.get_random_password(
        PasswordLength=PASSWORD_LENGTH, ExcludePunctuation=True
    )["RandomPassword"]
    pending = dict(current)
    pending["username"] = _other(current["username"])
    pending["password"] = new_password
    sm.put_secret_value(
        SecretId=arn,
        ClientRequestToken=token,
        SecretString=json.dumps(pending),
        VersionStages=["AWSPENDING"],
    )
    logger.info("createSecret: stored a pending login for %s", pending["username"])


def set_secret(arn, token):
    pending = _get(arn, "AWSPENDING", token)
    current = _get(arn, "AWSCURRENT")
    if _can_login(pending):
        logger.info("setSecret: the pending login already works")
        return
    if pending["username"] != _other(current["username"]):
        raise ValueError("The pending user is not the alternate of the current user")
    source, target = current["username"], pending["username"]

    connection = _connect(_master())
    try:
        with connection.cursor() as cursor:
            # Where the account in use may connect from (for example 172.20.%).
            cursor.execute("SELECT Host FROM mysql.user WHERE User = %s", (source,))
            hosts = [row[0] for row in cursor.fetchall()]
            if len(hosts) != 1 or not HOST_RE.match(hosts[0]):
                raise ValueError(f"Expected exactly one account named {source}, found {len(hosts)}")
            host = hosts[0]

            cursor.execute("SHOW GRANTS FOR %s@%s", (source, host))
            grants = [row[0] for row in cursor.fetchall()]

            cursor.execute("CREATE USER IF NOT EXISTS %s@%s IDENTIFIED BY %s", (target, host, pending["password"]))
            cursor.execute("ALTER USER %s@%s IDENTIFIED BY %s", (target, host, pending["password"]))
            # Copy the rights from the account in use, starting from nothing so
            # the two can never drift apart.
            cursor.execute("REVOKE ALL PRIVILEGES, GRANT OPTION FROM %s@%s", (target, host))
            old_spec, new_spec = f"`{source}`@`{host}`", f"`{target}`@`{host}`"
            for grant in grants:
                if not grant.endswith(" TO " + old_spec) and (" TO " + old_spec + " ") not in grant:
                    raise ValueError("Unexpected grant text; refusing to copy it")
                cursor.execute(grant.replace(" TO " + old_spec, " TO " + new_spec, 1))
        connection.commit()
    finally:
        connection.close()
    logger.info("setSecret: %s now has %s's rights and the new password", target, source)


def test_secret(arn, token):
    pending = _get(arn, "AWSPENDING", token)
    connection = _connect(pending)
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
    finally:
        connection.close()
    logger.info("testSecret: the pending login works")


def finish_secret(arn, token):
    metadata = sm.describe_secret(SecretId=arn)
    current_version = None
    for version, stages in metadata["VersionIdsToStages"].items():
        if "AWSCURRENT" in stages:
            if version == token:
                logger.info("finishSecret: version %s is already AWSCURRENT", token)
                return
            current_version = version
            break
    sm.update_secret_version_stage(
        SecretId=arn,
        VersionStage="AWSCURRENT",
        MoveToVersionId=token,
        RemoveFromVersionId=current_version,
    )
    logger.info("finishSecret: version %s is now AWSCURRENT", token)
