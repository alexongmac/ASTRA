# ADR-0004: Ingest OEE events through AWS IoT Core and Lambda

**Status:** Proposed

**Date:** 2026-11-14

**Context:**

ASTRA receives Overall Equipment Effectiveness (OEE) machine events through an MQTT bridge. These events need to reach RDS without depending on an application pod maintaining an MQTT subscription.

**Options Considered:**

1. **IoT Core rule invoking Lambda:** Matches the current MQTT integration and separates event handling from EKS application deployment.
2. **An MQTT consumer on EKS:** Allows a long-running consumer but adds connection lifecycle and consumer availability responsibilities.
3. **An ingestion path with an intermediate queue:** Adds an explicit buffering and replay layer, with additional resources and consumer behavior to design.

**Decision:**

Use an IoT Thing and active certificate with a policy restricted to the configured MQTT client ID and topic prefix. Route `r2d2/+/oee/event` through an IoT SQL rule to a Python 3.12 Lambda in the private subnets.

The handler parses the event timestamp and state fields and performs a parameterized insert into `machine_events`. It retrieves the RDS-managed secret and opens a database connection per invocation. Terraform sets a ten-second function timeout and scopes IoT invocation permission to the topic rule.

**Consequences:**

Ingestion has a separate execution path from the EKS application. Database connection demand grows with concurrent invocations. The repository does not configure an intermediate queue, dead-letter destination, IoT rule error action, or application-level deduplication; durable replay and duplicate prevention must not be assumed. Secrets are cached for the lifetime of a warm execution environment, without refresh on authentication failure. Terraform creates the device certificate, so state access and certificate handling require care. Revisit when ingestion volume or event-loss tolerance requires buffering, stronger validation, or idempotency.

**Evidence:** [IoT identity and policy](../../20-iot.tf), [rule and Lambda](../../22-iot-ingest.tf), [event handler](../../lambda/oee-ingest/handler.py).
