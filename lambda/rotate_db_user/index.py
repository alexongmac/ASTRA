"""Rotate the astra_app MySQL password held in AWS Secrets Manager, with no
downtime and without the master login.

There are two MySQL accounts with identical rights, astra_app and
astra_app_clone, created once by scripts/create-db-app-user.sh. Only one is
AWSCURRENT in the secret at a time; the other one's login is AWSPREVIOUS.

Each rotation changes the password of the account that is NOT in use. It logs
in as that account with its previous password and changes its own password,
which any MySQL account may do, so this function never needs the master login.
Then it makes that account current. The account that was in use keeps its
password, so pods that have not yet picked up the new secret still connect.

Secrets Manager calls this four times per rotation:

  createSecret  pick the other account and generate a password for it (AWSPENDING)
  setSecret     log in as the other account with its previous password and
                change its own password
  testSecret    log in with the new login, and check both accounts still have
                the same rights
  finishSecret  make it AWSCURRENT (Secrets Manager moves the old one to
                AWSPREVIOUS, ready for next month)

Each step can be retried, so each one checks what has already been done.

Environment (never read from the secret, so a secret cannot point this function
at another host):
  DB_HOST  the RDS endpoint
  DB_PORT  3306
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
USER_RE = re.compile(r"^[A-Za-z0-9_]{1,32}$")
SETUP_HINT = "run scripts/create-db-app-user.sh to set up both accounts again"


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


def _get_previous(arn):
    try:
        return _get(arn, "AWSPREVIOUS")
    except sm.exceptions.ResourceNotFoundException:
        return None


def _connect(login):
    """Open a connection as the user in `login`. Encrypted, not verified: the
    traffic stays inside the VPC, and this keeps the new password off the wire
    in clear when it is set."""
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
    if not USER_RE.match(username):
        raise ValueError("The secret's user name has unexpected characters")
    other = username[: -len(CLONE_SUFFIX)] if username.endswith(CLONE_SUFFIX) else username + CLONE_SUFFIX
    if not USER_RE.match(other):
        raise ValueError(f"Cannot alternate the user name {username!r}")
    return other


def _own_grants(login):
    """This account's rights, with its own name taken out so two accounts can
    be compared."""
    connection = _connect(login)
    try:
        with connection.cursor() as cursor:
            cursor.execute("SHOW GRANTS")
            rows = [row[0] for row in cursor.fetchall()]
    finally:
        connection.close()
    name = f"`{login['username']}`@"
    return sorted(row.replace(name, "`<user>`@") for row in rows)


def create_secret(arn, token):
    current = _get(arn, "AWSCURRENT")
    try:
        _get(arn, "AWSPENDING", token)
        logger.info("createSecret: a pending version already exists")
        return
    except sm.exceptions.ResourceNotFoundException:
        pass

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
    if _can_login(pending):
        logger.info("setSecret: the pending login already works")
        return
    current = _get(arn, "AWSCURRENT")
    if pending["username"] != _other(current["username"]):
        raise ValueError("The pending user is not the alternate of the current user")

    # The account we are about to switch to was last in use before this one, so
    # its password is the AWSPREVIOUS version.
    previous = _get_previous(arn)
    if not previous or previous.get("username") != pending["username"]:
        raise ValueError(f"No previous password is stored for {pending['username']}; {SETUP_HINT}")
    if not _can_login(previous):
        raise ValueError(f"The stored previous password for {pending['username']} no longer works; {SETUP_HINT}")

    connection = _connect(previous)
    try:
        with connection.cursor() as cursor:
            # Any account may change its own password; no extra privilege needed.
            cursor.execute("ALTER USER USER() IDENTIFIED BY %s", (pending["password"],))
        connection.commit()
    finally:
        connection.close()
    logger.info("setSecret: changed the password for %s", pending["username"])


def test_secret(arn, token):
    pending = _get(arn, "AWSPENDING", token)
    current = _get(arn, "AWSCURRENT")
    # Logs in with the new login (raises if it does not work) and compares rights,
    # so the switch never moves the app to an account with different access.
    if _own_grants(pending) != _own_grants(current):
        raise ValueError(f"{pending['username']} and {current['username']} have different rights; {SETUP_HINT}")
    logger.info("testSecret: the pending login works and has the same rights")


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
