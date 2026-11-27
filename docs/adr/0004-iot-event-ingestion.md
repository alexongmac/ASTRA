# ADR-0004: Ingest OEE events through AWS IoT Core, SQS and an EKS worker

**Status:** Proposed

**Date:** 2026-11-14

**Context:**

ASTRA receives Overall Equipment Effectiveness (OEE) machine events and summaries through an MQTT bridge. These messages need to reach RDS, where the web app turns them into telemetry and alarms, without losing messages when the application is restarted or briefly unavailable.

**Options Considered:**

1. **IoT Core rules writing to SQS, read by a worker in EKS:** The IoT rules put each message on a queue; the web app's worker reads the queue and writes to RDS.
   - *Pros:*
     - The queue buffers messages while the worker restarts, is redeployed or the database is unavailable.
     - Failed messages move to a dead-letter queue after three attempts instead of being lost.
     - Alarm logic lives in the web app, next to the data model, and is deployed through the existing CI and Argo CD flow.
     - No extra compute service to run: the worker is another deployment of the web app image.
   - *Cons:*
     - The queue gives at-least-once delivery, so the worker must tolerate duplicates.
     - Processing depends on the EKS worker running; a stopped worker lets the queue back up.
     - Needs an alert on queue depth and the dead-letter queue to notice a stuck pipeline (added; see Configuration).
2. **IoT Core rule invoking Lambda that writes to RDS:**
   - *Pros:*
     - Event handling is fully separate from the EKS deployment, and Lambda scales per message automatically.
     - No always-on consumer to run.
   - *Cons:*
     - Lambda needs VPC networking, its own secrets access and database connections per concurrent invocation, which can exhaust a `db.t3.micro`.
     - Alarm logic would have to be duplicated or split between Lambda and the web app.
     - A separate build and deployment path for the Lambda package.
3. **An MQTT consumer inside the EKS web app:**
   - *Pros:*
     - Fewest AWS resources; direct subscription to the topics.
   - *Cons:*
     - The pod must keep a long-lived MQTT connection, and messages published while it is down are lost unless the broker retains them.
     - Scaling out the web app multiplies subscribers and risks duplicate processing.

**Decision:**

We chose **Option 1: IoT Core rules to SQS, with an EKS worker reading the queue.**

**Why:**

- **Durability.** The queue holds messages for up to four days, and messages that fail three times land in a dead-letter queue kept for 14 days, so a worker outage or a bad message does not drop data.
- **Fits the application.** The worker runs as `astra-web-app-worker` from the same image, writes through the same Prisma data model and raises or clears alarms in one place.
- **Least extra operations.** There is no Lambda package, VPC Lambda networking or per-invocation database connection to manage.

**Configuration:**

- **Device identity:** an IoT Thing with an active certificate and a policy limited to the configured MQTT client ID and the `r2d2` topic prefix.
- **Rules:** two IoT topic rules, `r2d2/+/oee/event` and `r2d2/+/oee/summary`, send messages to the `oee-events` SQS queue through a dedicated IAM role that can only `sqs:SendMessage` to that queue.
- **Queue:** 30-second visibility timeout, four-day retention, redrive to a dead-letter queue after three receives.
- **Worker access:** the web app role, attached through EKS Pod Identity, can receive and delete messages on the queue and read the RDS-managed secret.
- **Alerting:** two CloudWatch alarms notify Discord through an SNS topic and a small Lambda.
  - *Dead-letter queue not empty:* fires as soon as one message arrives, and again when it is cleared. A message there is an event that failed three times and was not saved.
  - *Queue backlog:* fires when more than 100 events stay in the main queue for 10 minutes, which means the worker is down, crash-looping or too slow.
  - *Discord webhook:* the Lambda reads the URL from a Secrets Manager secret that is filled in by hand, so it is never in Terraform state or Git. The Lambda only forwards notifications; it is not part of the ingest path.

**Consequences:**

**What this makes easier:**

- Restarting or redeploying the web app without losing incoming events.
- Inspecting or replaying failed messages from the dead-letter queue.
- Changing alarm logic as an ordinary application release.

**What it makes harder or rules out:**

- **Duplicates are possible.** The queue is at-least-once and this repository sets no deduplication, so the worker must be idempotent.
- **Alerting covers two cases only.** There are alarms on queue depth and the dead-letter queue, but none on message age or on the worker itself, so a worker that is slow but keeps the queue under 100 messages is not reported. Nothing replays messages from the dead-letter queue automatically; someone has to inspect and delete or redrive them.
- **The worker is a single point of processing.** If the worker pods are down, events wait in the queue (up to four days) and then expire.
- **Certificate handling needs care.** Terraform creates the device certificate, so its private key is held in Terraform state and must reach the MQTT bridge through a controlled step (see `scripts/sync-iot-cert.sh`).
- **A Lambda-based path is ruled out** for this cluster; moving back to it would mean rebuilding the networking, secrets access and alarm logic outside the web app.

**When to revisit:** if event volume outgrows a single worker deployment, if event-loss tolerance tightens (add deduplication and a message-age alarm first), or if processing should be isolated from the web app.

**Evidence:** [IoT identity and policy](../../20-iot.tf), [rules, queues and worker access](../../25-alarm-ingest.tf), [device certificate sync](../../scripts/sync-iot-cert.sh), [queue alarms and Discord notifier](../../27-queue-alarms.tf). The worker itself is in `app/` (the `astra-web-app-worker` deployment in `ASTRA_argocd`).
