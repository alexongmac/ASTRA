"""Rotate the astra_app MySQL password held in AWS Secrets Manager.

Secrets Manager calls this four times per rotation (createSecret, setSecret,
testSecret, finishSecret). It is the "single user" strategy: the user changes
its own password, so this function never needs the master login and can only
touch this one secret and this one account.

  createSecret  generate a new password and store it as AWSPENDING
  setSecret     log in with the current password and change it to the new one
  testSecret    log in with the new password
  finishSecret  make the new password AWSCURRENT

Each step can be retried, so each one checks what has already been done.

Environment:
  DB_HOST  the RDS endpoint (not read from the secret, so a secret cannot point
           this function at another host)
  DB_PORT  3306
"""

import json
import logging
import os
import ssl

import boto3
import pymysql

logger = logging.getLogger()
logger.setLevel(logging.INFO)

sm = boto3.client("secretsmanager")

PASSWORD_LENGTH = 40


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


def _connect(secret):
    """Open a connection as the user in `secret`. Encrypted, not verified: the
    traffic stays inside the VPC, and this keeps the new password off the wire
    in clear when it is set."""
    context = ssl.create_default_context()
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    return pymysql.connect(
        host=os.environ["DB_HOST"],
        port=int(os.environ.get("DB_PORT", "3306")),
        user=secret["username"],
        password=secret["password"],
        connect_timeout=5,
        read_timeout=10,
        write_timeout=10,
        ssl=context,
    )


def _can_login(secret):
    try:
        _connect(secret).close()
        return True
    except pymysql.err.OperationalError:
        return False


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
    pending["password"] = new_password
    sm.put_secret_value(
        SecretId=arn,
        ClientRequestToken=token,
        SecretString=json.dumps(pending),
        VersionStages=["AWSPENDING"],
    )
    logger.info("createSecret: stored a new pending password")


def set_secret(arn, token):
    pending = _get(arn, "AWSPENDING", token)
    if _can_login(pending):
        logger.info("setSecret: the pending password already works")
        return

    # Log in with the password in use now. If this step is retried after the
    # secret moved on, the previous version is the other one that may be valid.
    current = _get(arn, "AWSCURRENT")
    connection = None
    for candidate in (current, _try_previous(arn)):
        if candidate and candidate["username"] == pending["username"] and _can_login(candidate):
            connection = _connect(candidate)
            break
    if connection is None:
        raise ValueError(f"setSecret: could not log in as {pending['username']} with the current or previous password")

    try:
        with connection.cursor() as cursor:
            # A user may change its own password; no extra privilege is needed.
            cursor.execute("ALTER USER USER() IDENTIFIED BY %s", (pending["password"],))
        connection.commit()
    finally:
        connection.close()
    logger.info("setSecret: changed the password for %s", pending["username"])


def _try_previous(arn):
    try:
        return _get(arn, "AWSPREVIOUS")
    except sm.exceptions.ResourceNotFoundException:
        return None


def test_secret(arn, token):
    pending = _get(arn, "AWSPENDING", token)
    connection = _connect(pending)
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
    finally:
        connection.close()
    logger.info("testSecret: the pending password works")


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
