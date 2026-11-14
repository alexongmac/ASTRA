# ADR-0003: Store application and machine-event data in RDS MySQL

**Status:** Proposed

**Date:** 2026-11-14

**Context:**

The ingestion handler inserts structured machine events into the `machine_events` table in `astradb`. Applications on EKS and the ingestion Lambda need database access. Database credentials should be managed outside application source code.

**Options Considered:**

1. **RDS MySQL:** Matches the existing SQL writer and delegates database instance management to RDS.
2. **MySQL inside EKS:** Keeps the database in Kubernetes but adds database storage, backup, and recovery operations to cluster responsibilities.
3. **DynamoDB:** Requires a different data model, write implementation, and query design.

**Decision:**

Use RDS MySQL 8.0 with a `db.t3.micro` instance and 20 GiB of allocated storage, using a subnet group containing both private subnets. Permit MySQL port 3306 from the EKS cluster security group and the ingestion Lambda security group.

Enable RDS-managed master credentials in Secrets Manager. The Lambda receives the secret ARN and retrieves credentials at runtime. Development selects the AWS-managed Secrets Manager key; production selects a customer-managed KMS key. Source comments record a production key-access problem as the reason for that exception; its underlying account-policy cause is not independently verified.

**Consequences:**

The implementation retains SQL inserts and avoids embedding the database password in the Lambda configuration. It currently uses master credentials for ingestion; a dedicated application user remains a follow-up. A two-AZ subnet group is not a Multi-AZ database deployment: Multi-AZ is not enabled in this resource. The configuration skips the final snapshot and applies changes immediately; backup retention and deletion protection are not explicitly configured. The export bucket and role alone do not establish a working backup or export schedule. Revisit these settings before agreeing production recovery commitments.

**Evidence:** [RDS, security groups, and secrets](../../21-rds-mysql.tf), [Lambda configuration](../../22-iot-ingest.tf), [SQL writer](../../lambda/oee-ingest/handler.py).
