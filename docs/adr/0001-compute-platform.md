# ADR-0001: Use Amazon EKS with managed EC2 worker nodes

**Status:** Proposed

**Date:** 2026-11-14

**Context:**

ASTRA's infrastructure is built around Kubernetes workloads and platform integrations, including ingress, certificate management, DNS automation, monitoring, and persistent storage. The platform needs a managed control plane while retaining control over worker capacity and Kubernetes add-ons.

**Options Considered:**

1. **EKS with managed EC2 nodes:** Managed Kubernetes control plane with worker nodes in our own account.
   - *Pros:*
     - Matches the existing Kubernetes integrations (ALB controller, cert-manager, ExternalDNS, EBS CSI, Argo CD).
     - AWS operates the control plane and handles node group rolling updates.
     - Full control over instance type, capacity and add-ons, with Cluster Autoscaler for scaling.
     - Kubernetes skills and manifests carry over to other clouds.
   - *Cons:*
     - Requires node capacity planning (per-node pod limits, instance sizing).
     - We remain responsible for cluster upgrades, add-on compatibility and node patching cadence.
     - EKS control plane fee plus always-on EC2 cost, even when idle.
2. **ECS / Fargate:** AWS-native container orchestration with serverless compute.
   - *Pros:*
     - Simpler to operate: no cluster upgrades, node management or add-on compatibility.
     - Fargate removes node capacity planning and per-task billing avoids paying for idle nodes.
     - Tight integration with ALB, IAM and CloudWatch.
   - *Cons:*
     - Would require replacing the current Kubernetes deployments and controller integrations (Argo CD, cert-manager, Helm-based monitoring).
     - AWS-specific, so less portable and a different skill set to maintain.
     - Less flexibility for stateful and custom workloads (limited persistent storage options, no DaemonSets).
3. **Self-managed Kubernetes on EC2:** Run our own control plane (for example kubeadm) on EC2 instances.
   - *Pros:*
     - Maximum control over Kubernetes version, configuration and control plane components.
     - No EKS control plane fee.
     - Same Kubernetes manifests and integrations as option 1.
   - *Cons:*
     - We operate etcd, API servers, certificates, upgrades, backups and high availability ourselves.
     - Higher operational and security risk for a small team.
     - Weaker AWS integration (IAM, Pod Identity and add-ons need manual setup).

**Decision:**

We chose **Option 1: Amazon EKS with an On-Demand managed node group**.

**Why:**

- **It fits what we already run.** The ALB controller, cert-manager, DNS automation, EBS CSI storage, monitoring and Argo CD all assume Kubernetes. Option 2 would mean rewriting each of them, and a rewrite is a poor use of the time we have.
- **It gives us a managed control plane without owning it.** AWS runs and patches the API servers and etcd. Option 3 would put that on a small team for a saving of only the EKS control plane fee.
- **We keep control where it matters.** Managed node groups let us pick the instance type, scale with Cluster Autoscaler, and add the add-ons we need, while AWS handles rolling node updates.
- **On-Demand capacity** keeps nodes predictable for a demo and avoids Spot interruptions.

**Configuration:** two private subnets, Amazon Linux 2023 x86_64 workers on `t3.medium`, scaling from a minimum of 3 to a maximum of 10 nodes (6 desired at creation). Node updates allow one unavailable node at a time.

Terraform provisions Cluster Autoscaler permissions, Pod Identity, and Auto Scaling Group discovery tags. Installation of the autoscaler itself belongs to the separate platform/application deployment. Terraform ignores changes to desired node count so it does not continually reset autoscaler decisions.

**Consequences:**

**What this makes easier:**

- Deploying and updating the app through Kubernetes manifests and Argo CD (GitOps), with no change to the existing tooling.
- Reusing the platform integrations already in place: ALB ingress, cert-manager and DNS automation, EBS persistent storage, and Loki/Grafana monitoring.
- Scaling worker capacity automatically with Cluster Autoscaler, within the 3 to 10 node range.
- Running the control plane without operating it: AWS patches and keeps the API servers and etcd available, and node group updates roll one node at a time.
- Keeping the option to move to another Kubernetes platform later, because the manifests are not tied to AWS-specific orchestration.

**What it makes harder or rules out:**

- **Ongoing upkeep stays with us.** We own cluster version upgrades, add-on compatibility, node patching, and resource requests and limits.
- **Cost never drops to zero.** We pay the EKS control plane fee and for the always-on EC2 workers even when idle, which Fargate-style per-task billing would avoid.
- **Node capacity needs planning.** A `t3.medium` limits how many pods fit per node (about 17), so pod count, not CPU or memory, can force us to add nodes.
- **Images must be x86_64 (AMD64).** ARM64 images and Graviton nodes are ruled out for this cluster, so builds from an ARM Mac need `--platform linux/amd64`.
- **Two subnets do not guarantee availability.** Replica placement, pod disruption budgets and anti-affinity still need separate configuration.
- **ECS/Fargate is ruled out** for this platform without a rewrite of the deployment and controller integrations, and a self-managed control plane is ruled out too.

**When to revisit:** if Kubernetes maintenance outweighs its value for the team, or if capacity needs exceed the 10-node maximum.

**Evidence:** [Cluster](../../9-eks.tf), [worker nodes](../../12-nodes.tf), [add-ons](../../13-addons.tf), [autoscaler prerequisites](../../16-cluster-autoscaler.tf).
