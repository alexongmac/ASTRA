# ADR-0001: Use Amazon EKS with managed EC2 worker nodes

**Status:** Proposed

**Date:** 2026-11-14

**Context:**

ASTRA's infrastructure is built around Kubernetes workloads and platform integrations, including ingress, certificate management, DNS automation, monitoring, and persistent storage. The platform needs a managed control plane while retaining control over worker capacity and Kubernetes add-ons.

**Options Considered:**

1. **EKS with managed EC2 nodes:** Matches the existing Kubernetes integrations, but requires node capacity planning and cluster maintenance.
2. **ECS / Fargate:** An alternative container platform, but adopting it would require replacing the current Kubernetes deployment and controller integrations.
3. **Self-managed Kubernetes on EC2:** Retains Kubernetes control but adds responsibility for operating the control plane.

**Decision:**

Use EKS with an On-Demand managed node group in two private subnets. The current configuration selects ARM64 Amazon Linux 2023 workers on `t4g.large`, initially two nodes, with a minimum of two and maximum of four. Node updates allow one unavailable node at a time.

Terraform provisions Cluster Autoscaler permissions, Pod Identity, and Auto Scaling Group discovery tags. Installation of the autoscaler itself belongs to the separate platform/application deployment. Terraform ignores changes to desired node count so it does not continually reset autoscaler decisions.

**Consequences:**

We retain Kubernetes-based deployment and platform integrations. We also retain responsibility for cluster upgrades, add-on compatibility, resource requests, and worker costs. Application images must support ARM64. Two subnets do not by themselves guarantee application availability; replica placement and disruption policies need separate configuration. Revisit if Kubernetes maintenance outweighs its value or capacity requirements exceed the current node range.

**Evidence:** [Cluster](../../9-eks.tf), [worker nodes](../../12-nodes.tf), [add-ons](../../13-addons.tf), [autoscaler prerequisites](../../16-cluster-autoscaler.tf).
