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

The implementation keeps SQL and avoids committing the database password to source. The app does not use the master login. It connects as a dedicated MySQL user, `astra_app`, which can only select, insert, update and delete rows in `astradb` and only from inside the VPC (development, since 2026-11-27); it cannot change the schema or manage users. The master user is kept for migrations and seeding, which are run by a person through the `rds-proxy` pod. RDS rotates the master password every 7 days, but that rotation no longer touches the application: the app has two MySQL accounts with identical rights, `astra_app` and `astra_app_clone`, created once by `scripts/create-db-app-user.sh` and stored in their own Secrets Manager secret (one current, one previous). A Lambda function rotates them on a schedule (1st of each month, 19:00 UTC; `29-db-app-rotation.tf`): it logs in as the account not in use with its previous password, changes its own password, checks both accounts still have the same rights, and makes it current. The account in use keeps working until the pods move over, so a rotation causes no downtime, and the function never needs the master login. A live rotation on 2026-11-28 switched the app from `astra_app` to `astra_app_clone` with no database errors. External Secrets copies it into the Kubernetes secret the app reads, and Reloader restarts the pods when it changes (see ADR-0010). Before this, the app used the master login through a secret edited by hand, and each rotation broke logins until someone updated it and restarted the pods (this happened on 2026-11-26). If a rotation ever reports that the stored previous password no longer works, or that the two accounts' rights differ, it stops before switching the app, and re-running the script sets both accounts up again. A two-AZ subnet group is not a Multi-AZ database deployment: Multi-AZ is not enabled. Automated backups are kept for 7 days and deletion protection is on, but no final snapshot is taken on deletion and changes apply immediately. The export bucket and role alone do not establish a working export schedule. Revisit these settings before agreeing production recovery commitments.

**Evidence:** [RDS, security groups, and secrets](../../21-rds-mysql.tf), [Queue worker access to the secret](../../25-alarm-ingest.tf), [app user secret](../../28-db-app-user.tf), [app user script](../../scripts/create-db-app-user.sh), [password rotation](../../29-db-app-rotation.tf), [data model](../../app/prisma/schema.prisma).
