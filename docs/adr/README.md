# ASTRA Architecture Decision Records

These drafts describe the architecture defined in this repository, first drafted at commit `ec60ad4` on 2026-11-14 and corrected on 2026-11-26 against the current Terraform and `ASTRA_argocd` manifests. They do not confirm what is currently deployed in AWS. Status remains **Proposed** until the team reviews and accepts each record; the date is the drafting date, not an inferred historical approval date.

The decisions reflect existing configuration. Options and tradeoffs are reconstructed for review, rather than presented as minutes of earlier discussions. Team size, traffic, budget, recovery targets, and performance measurements have not been supplied and are not assumed.

| ADR | Decision |
| --- | --- |
| [0001](0001-compute-platform.md) | EKS with managed EC2 worker nodes |
| [0002](0002-network-isolation.md) | Two-AZ VPC with private workloads and shared NAT |
| [0003](0003-relational-database.md) | RDS MySQL with managed credentials |
| [0004](0004-iot-event-ingestion.md) | IoT Core, SQS and an EKS worker for OEE event ingestion |
| [0005](0005-infrastructure-delivery.md) | Terraform and GitHub Actions with separate environment state |
| [0006](0006-workload-identity.md) | EKS Pod Identity for AWS service access |
| [0007](0007-ingress-dns-tls.md) | Traefik and AWS ALB ingress with automated DNS and certificates |
| [0008](0008-observability.md) | Prometheus, Grafana, Loki, and EKS audit logs |
| [0009](0009-persistent-storage.md) | EBS-backed persistent volumes (EBS CSI, gp2) for in-cluster state |

Each record links to its supporting source files. Terraform defines AWS infrastructure and selected EKS add-ons. Several Helm charts and application resources are expected from a separate platform/application repository or manual setup described in the root README; their deployment is not verified here.

To accept a record, review its rationale and consequences, update its status and acceptance date through the team's normal review process, and retain the source references. Use a superseding ADR for a later architectural change.
