# ADR-0008: Use Prometheus, Grafana, Loki, and EKS audit logging

**Status:** Proposed

**Date:** 2026-11-14

**Context:**

ASTRA needs cluster metrics, dashboards, application logs, and a record of Kubernetes API activity. The README documents Prometheus/Grafana and Loki installation, while Terraform supplies log storage and EKS control-plane logging.

**Options Considered:**

1. **Prometheus, Grafana, and Loki with AWS log storage:** Matches the monitoring stack deployed through Argo CD, with S3 for durable log storage.
2. **An AWS-managed monitoring stack:** Would move more monitoring operations outside the cluster but require different configuration and integration.
3. **Only local pod and node logs:** Reduces monitoring components but provides a weaker basis for history and cross-workload investigation.

**Decision:**

Use kube-prometheus-stack for metrics, dashboards and alerting, Promtail to ship pod logs, and Loki with an S3 log bucket. Grafana also reads CloudWatch (ALB and WAF metrics for the web app) through a read-only Pod Identity role, and Alertmanager sends alerts to Discord. Terraform enables bucket versioning, public-access blocking, KMS server-side encryption, and a 14-day current-object expiration rule. Loki receives an S3 role through Pod Identity. The EBS CSI add-on supports workloads that request EBS-backed persistent volumes.

Enable EKS `api` and `audit` control-plane logs, which operators inspect in CloudWatch. Keep chart deployment in `ASTRA_argocd`, separate from the AWS infrastructure definitions. Prometheus retention is not set in the chart values, so the chart default applies.

**Consequences:**

The architecture separates metrics, application logging, and Kubernetes API auditing. The team must operate the in-cluster monitoring services and their capacity. This repository holds only the AWS side; chart settings, alert routing and dashboards live in `ASTRA_argocd`, and the Discord webhook secret is created by hand. Alert rules are the kube-prometheus-stack defaults, with no ASTRA-specific rules for the SQS dead-letter queue or database health. The S3 expiration rule does not expire noncurrent versions, so it is not a guarantee that all log data disappears after 14 days. EKS log retention is not explicitly managed here, and Loki KMS access needs verification. Revisit retention, alert delivery, and storage protection when operational and audit requirements are defined.

**Evidence:** [Loki storage](../../14-loki-s3.tf), [Grafana CloudWatch role](../../22-grafana-cloudwatch.tf), [EKS logging](../../9-eks.tf), [EBS CSI](../../18-ebs-csi.tf). In `ASTRA_argocd`: `Applications/kube-prometheus-stack.yaml`, `Applications/grafana-promtail.yaml`, `Applications/development/grafana-loki.yaml`.
