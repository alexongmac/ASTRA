# ADR-0003: Store application and machine-event data in RDS MySQL

**Status:** Proposed

**Date:** 2026-11-14

**Context:**

The web app and its queue worker store operators, alarms, OEE events and summaries, operator logs and shift handovers in the `astradb` database. Applications on EKS need database access. Database credentials should be managed outside application source code.

**Options Considered:**

1. **RDS MySQL:** Matches the existing SQL data model (Prisma) and delegates database instance management to RDS.
2. **MySQL inside EKS:** Keeps the database in Kubernetes but adds database storage, backup, and recovery operations to cluster responsibilities.
3. **DynamoDB:** Requires a different data model, write implementation, and query design.

**Decision:**

Use RDS MySQL 8.0 with a `db.t3.micro` instance and 20 GiB of allocated storage, using a subnet group containing both private subnets. Permit MySQL port 3306 from the EKS cluster security group only.

Enable RDS-managed master credentials in Secrets Manager. The web app role can read the secret through EKS Pod Identity. Development selects the AWS-managed Secrets Manager key; production selects a customer-managed KMS key. Source comments record a production key-access problem as the reason for that exception; its underlying account-policy cause is not independently verified.

**Consequences:**

The implementation keeps SQL and avoids committing the database password to source. The app currently connects with the master credentials; a dedicated application user remains a follow-up. RDS rotates the managed password every 7 days, but the application reads its connection string from a Kubernetes secret that is set by hand and not synced, so each rotation breaks logins until that secret is updated and the pods restart (this happened on 2026-11-26). A two-AZ subnet group is not a Multi-AZ database deployment: Multi-AZ is not enabled. Automated backups are kept for 7 days and deletion protection is on, but no final snapshot is taken on deletion and changes apply immediately. The export bucket and role alone do not establish a working export schedule. Revisit these settings before agreeing production recovery commitments.

**Evidence:** [RDS, security groups, and secrets](../../21-rds-mysql.tf), [Queue worker access to the secret](../../25-alarm-ingest.tf), [data model](../../app/prisma/schema.prisma).
