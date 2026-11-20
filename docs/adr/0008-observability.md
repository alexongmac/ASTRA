# ADR-0008: Use Prometheus, Grafana, Loki, and EKS audit logging

**Status:** Proposed

**Date:** 2026-11-14

**Context:**

ASTRA needs cluster metrics, dashboards, application logs, and a record of Kubernetes API activity. The README documents Prometheus/Grafana and Loki installation, while Terraform supplies log storage and EKS control-plane logging.

**Options Considered:**

1. **Prometheus, Grafana, and Loki with AWS log storage:** Matches the documented Kubernetes monitoring stack and S3 integration.
2. **An AWS-managed monitoring stack:** Would move more monitoring operations outside the cluster but require different configuration and integration.
3. **Only local pod and node logs:** Reduces monitoring components but provides a weaker basis for history and cross-workload investigation.

**Decision:**

Use the documented kube-prometheus-stack for metrics and dashboards, and Loki with an S3 log bucket. Terraform enables bucket versioning, public-access blocking, KMS server-side encryption, and a 14-day current-object expiration rule. Loki receives an S3 role through Pod Identity. The EBS CSI add-on supports workloads that request EBS-backed persistent volumes.

Enable EKS `api` and `audit` control-plane logs, which the README directs operators to inspect in CloudWatch. Keep chart deployment separate from the AWS infrastructure definitions. The README's Prometheus command sets six hours of retention; this is a documented installation value, not a verified live setting.

**Consequences:**

The architecture separates metrics, application logging, and Kubernetes API auditing. The team must operate the in-cluster monitoring services and their capacity. This repository does not include the referenced `loki-values.yaml`, log collector deployment, alert rules, or a complete dashboard configuration. The S3 expiration rule does not expire noncurrent versions, so it is not a guarantee that all log data disappears after 14 days. EKS log retention is not explicitly managed here, and Loki KMS access needs verification. Revisit retention, alert delivery, and storage protection when operational and audit requirements are defined.

**Evidence:** [Monitoring installation notes](../../README.md), [Loki storage](../../14-loki-s3.tf), [EKS logging](../../9-eks.tf), [EBS CSI](../../18-ebs-csi.tf).
