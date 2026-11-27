"""Forward CloudWatch alarm notifications from SNS to a Discord channel.

SNS invokes this with the alarm's JSON in each record's Message. The Discord
webhook URL is read from Secrets Manager at run time, so it is never in
Terraform state, Git or an environment variable.
"""

import json
import os
import urllib.request

import boto3

_secrets = boto3.client("secretsmanager")
_webhook_url = None  # cached for the life of the execution environment

RED = 0xD93025
GREEN = 0x1E8E3E
GREY = 0x6B7280


def _get_webhook_url():
    global _webhook_url
    if _webhook_url is None:
        value = _secrets.get_secret_value(SecretId=os.environ["WEBHOOK_SECRET_ARN"])
        _webhook_url = value["SecretString"].strip()
    return _webhook_url


def _embed(alarm):
    state = alarm.get("NewStateValue", "UNKNOWN")
    if state == "ALARM":
        title, color = "ALARM: " + alarm.get("AlarmName", "unknown"), RED
    elif state == "OK":
        title, color = "RESOLVED: " + alarm.get("AlarmName", "unknown"), GREEN
    else:
        title, color = state + ": " + alarm.get("AlarmName", "unknown"), GREY
    description = alarm.get("AlarmDescription") or ""
    reason = alarm.get("NewStateReason") or ""
    return {
        "title": title[:256],
        "description": (description + "\n\n" + reason).strip()[:4000],
        "color": color,
        "footer": {"text": "ASTRA " + os.environ.get("ENVIRONMENT", "") + " · " + alarm.get("Region", "")},
        "timestamp": alarm.get("StateChangeTime"),
    }


def _post(payload):
    request = urllib.request.Request(
        _get_webhook_url(),
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            # Discord rejects urllib's default User-Agent with a 403.
            "User-Agent": "ASTRA-queue-alerts (AWS Lambda, 1.0)",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        response.read()


def handler(event, _context):
    for record in event.get("Records", []):
        message = record["Sns"]["Message"]
        try:
            alarm = json.loads(message)
        except ValueError:
            # Not a CloudWatch alarm (for example a test publish): send it as is.
            alarm = {"AlarmName": record["Sns"].get("Subject") or "Notification", "NewStateValue": "INFO", "NewStateReason": message}
        # An error here makes Lambda retry the invocation, so a Discord outage
        # does not silently lose the alert.
        _post({"embeds": [_embed(alarm)]})
    return {"sent": len(event.get("Records", []))}
