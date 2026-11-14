# ADR-0006: Use EKS Pod Identity for workload access to AWS

**Status:** Proposed

**Date:** 2026-11-14

**Context:**

Kubernetes components need different AWS capabilities: Loki accesses S3, the autoscaler changes node capacity, the load balancer controller manages networking resources, DNS controllers update Route 53, and the EBS CSI driver manages volumes.

**Options Considered:**

1. **Static AWS keys in Kubernetes Secrets:** Adds key distribution and rotation responsibilities.
2. **Shared node-role permissions:** Couples workload access to the worker role and broadens the permissions available through that identity.
3. **EKS Pod Identity:** Matches the existing agent and namespace/service-account associations, with a separate IAM role for each integration.

**Decision:**

Install the EKS Pod Identity Agent add-on and associate named service accounts with dedicated IAM roles for Loki, Cluster Autoscaler, the AWS Load Balancer Controller, cert-manager, external-dns, and the EBS CSI driver.

Scope permissions where the current policy supports it: Loki uses its log bucket, DNS record access uses one hosted zone, and autoscaler capacity changes require the cluster ownership tag. Keep node infrastructure permissions and Lambda execution permissions in their separately defined roles.

**Consequences:**

These integrations avoid static AWS keys in pod configuration and have distinct AWS authorization policies. Deployments must use exactly the configured namespace and service-account names. Some policies retain wildcard resources or managed policies; this is not proof that all access is least privilege or that pods cannot reach node credentials. Production ingestion's customer-managed secret key also requires checking effective Lambda KMS access, which is not explicitly granted by its secret-read policy here. Revisit policies and identity boundaries as integrations change.

**Evidence:** [Agent](../../13-addons.tf), [Loki role](../../14-loki-s3.tf), [load balancer role](../../15-ingress-nginx.tf), [autoscaler role](../../16-cluster-autoscaler.tf), [storage role](../../18-ebs-csi.tf), [DNS roles](../../19-cert-manager-dns.tf), [Lambda role](../../22-iot-ingest.tf).
