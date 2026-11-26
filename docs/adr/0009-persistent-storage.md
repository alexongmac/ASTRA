# ADR-0009: Use EBS-backed persistent volumes for in-cluster state

**Status:** Proposed

**Date:** 2026-11-26

**Context:**

The business data (operators, alarms, OEE telemetry, operator logs, shift handovers) lives in RDS, and log chunks live in S3. A small amount of state still lives inside the cluster: Grafana's hand-made dashboards and settings, and Loki's local write-ahead log and index cache. Without a persistent volume this state is lost whenever a pod is rescheduled. That happened on 2026-11-21, when scaling the node group moved the Grafana pod and left it empty.

**Options Considered:**

1. **EBS volumes through the EBS CSI driver, `gp2` storage class:** One PersistentVolumeClaim per stateful pod, backed by an EBS volume.
   - *Pros:*
     - State survives pod restarts, node replacement and node group rebuilds; Loki's volume already survived a node group rebuild and the nightly cleanup sweep.
     - Block storage is fast enough for Grafana and Loki's local needs.
     - Provisioning is automatic once the driver and its IAM role exist.
     - `gp2` is already the cluster's storage class, so no extra setup.
   - *Cons:*
     - An EBS volume lives in one availability zone, so the pod can only run on a node in that zone.
     - It attaches to one node at a time (ReadWriteOnce), so a rolling update can hang if the new pod lands on a different node.
     - `gp2` costs more per GB than `gp3` and its speed is tied to volume size; volume expansion is not enabled on this class.
2. **EBS CSI with `gp3`:** The same approach with the newer volume type.
   - *Pros:*
     - Lower price per GB and performance that does not depend on size.
     - Same driver and the same permissions.
   - *Cons:*
     - Needs a new StorageClass, and existing volumes cannot switch type without re-creating the claim.
     - The saving is small at 15 GiB in total.
3. **Amazon EFS (shared file system):**
   - *Pros:*
     - Available from every zone, so pods are not pinned to one zone.
     - Allows several pods to share a volume.
   - *Cons:*
     - Another driver, file system and mount targets to provision and secure.
     - Higher latency, and a poor fit for Loki's write pattern.
     - Costs more per GB for state this small.
4. **No persistence (`emptyDir` or container filesystem):**
   - *Pros:*
     - Nothing to provision or pay for, and no zone pinning.
   - *Cons:*
     - Grafana loses its dashboards and Loki its local index on every restart or node change, which is what happened on 2026-11-21.

**Decision:**

We chose **Option 1: EBS-backed persistent volumes through the EBS CSI driver, using the `gp2` storage class.**

**Why:**

- **It fixes the failure we saw.** Grafana's dashboards were lost because the pod had no volume; a 5 GiB claim keeps them across reschedules.
- **It is the smallest change that works.** The driver, its role and the `gp2` class are already in place, and the state is small (15 GiB across two claims).
- **Durable data is elsewhere.** Because RDS and S3 hold the data that matters, a zone-locked volume for dashboards and a local cache is an acceptable trade.

**Configuration:**

- **Driver:** the EBS CSI add-on with an EKS Pod Identity role using the AWS-managed `AmazonEBSCSIDriverPolicy`, both in Terraform.
- **Storage class:** `gp2`, volume binding `WaitForFirstConsumer` (the volume is created in the zone where the pod is scheduled), reclaim policy `Delete`, expansion off.
- **Claims (development):** Grafana `kube-prometheus-stack-grafana`, 5 GiB, ReadWriteOnce; Loki `storage-loki-0`, 10 GiB, ReadWriteOnce, one replica.
- **Prometheus has no persistent volume** in the chart values, so metrics history is lost when its pod is replaced.

**Consequences:**

**What this makes easier:**

- Restarting, upgrading or moving Grafana and Loki without losing dashboards or the local index.
- Adding another stateful component by requesting a claim; the volume is provisioned on demand.
- Replacing nodes or rebuilding the node group without losing the two volumes.

**What it makes harder or rules out:**

- **Pods are pinned to a zone.** A volume's zone is fixed when it is created; if that zone has no capacity, the pod stays Pending.
- **Rolling updates can hang.** A ReadWriteOnce volume attaches to one node, so a new pod scheduled on another node waits on `FailedAttachVolume` (hit on 2026-11-23). Use the Recreate strategy or keep one replica.
- **Deleting the claim deletes the volume.** The `Delete` reclaim policy removes the EBS volume with the claim, and there is no snapshot schedule in this repository, so a deleted claim is unrecoverable.
- **Metrics are not durable.** Prometheus keeps its data on the pod, so alert history and graphs reset on restart; adding a volume is a follow-up.
- **No resizing in place.** Expansion is not enabled on `gp2`, so growing a volume means a new class or a new claim.
- **Capacity counts against node limits.** Each attached volume uses one of the node's attachment slots.
- **Not highly available.** One replica per stateful component, so an outage of that zone takes the component down until the pod is rescheduled elsewhere (and this is only possible after re-creating the volume).

**When to revisit:** if Prometheus metrics need to survive restarts, if volumes need snapshots or resizing, if a stateful component needs more than one replica, or if the zone pinning causes repeated scheduling failures (then consider `gp3`, a snapshot schedule, or EFS).

**Evidence:** [EBS CSI add-on and role](../../18-ebs-csi.tf). In `ASTRA_argocd`: `Applications/kube-prometheus-stack.yaml` (Grafana persistence), `Applications/development/grafana-loki.yaml` (Loki persistence). Live check on the development cluster, 2026-11-26: two bound `gp2` claims and the `gp2` class settings above.
