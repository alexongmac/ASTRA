# ADR-0009: Use EBS-backed persistent volumes for in-cluster state

**Status:** Proposed

**Date:** 2026-11-26 (updated 2026-11-27: `gp3` for new volumes, and a volume for Prometheus)

**Context:**

The business data (operators, alarms, OEE telemetry, operator logs, shift handovers) lives in RDS, and log chunks live in S3. A small amount of state still lives inside the cluster: Grafana's hand-made dashboards and settings, Loki's local write-ahead log and index cache, and Prometheus's metrics history. Without a persistent volume this state is lost whenever a pod is rescheduled. That happened on 2026-11-21, when scaling the node group moved the Grafana pod and left it empty. Prometheus is in the same position: measured on 2026-11-27, it held about 6.4 days of history (4.5 GB, 246,000 series, about 0.7 GB a day) in a temporary disk that a reschedule would erase.

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
     - About 20% lower price per GB, and 3,000 IOPS and 125 MB/s whatever the size. A small `gp2` volume gets 100 IOPS.
     - Same driver and the same permissions, and the class can allow volume expansion.
   - *Cons:*
     - Needs a new StorageClass, and a claim's class cannot be changed, so existing claims keep naming `gp2`. Their volumes can be converted in place in AWS, which changes the volume but not the label Kubernetes shows.
     - The saving is small at about 35 GiB in total.
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

We chose **EBS-backed persistent volumes through the EBS CSI driver: Option 1 for the volumes that already exist, and Option 2 (`gp3`) for every new claim, starting with Prometheus.**

**Why:**

- **It fixes the failure we saw.** Grafana's dashboards were lost because the pod had no volume; a 5 GiB claim keeps them across reschedules, and a 20 GiB claim does the same for Prometheus's history.
- **It is the smallest change that works.** The driver and its role are already in place, and the state is small. Grafana and Loki keep their working `gp2` claims instead of being re-created, which would risk their data for a small saving.
- **New volumes use the better type.** `gp3` costs less and does not tie speed to size, so there is no reason to add more `gp2`.
- **Durable data is elsewhere.** Because RDS and S3 hold the data that matters, a zone-locked volume for dashboards, a local cache and metrics is an acceptable trade.

**Configuration:**

- **Driver:** the EBS CSI add-on with an EKS Pod Identity role using the AWS-managed `AmazonEBSCSIDriverPolicy`, both in Terraform.
- **Storage classes:** `gp2` (existing, legacy in-tree provisioner, expansion off) and `gp3` (new, EBS CSI driver, expansion on). Both use volume binding `WaitForFirstConsumer` (the volume is created in the zone where the pod is scheduled) and reclaim policy `Delete`. Neither is encrypted, matching the existing volumes. The driver puts the project tags, including `NukeProtection`, on every volume it creates.
- **Claims (development):**
  - Grafana `kube-prometheus-stack-grafana`, 5 GiB, `gp2`, ReadWriteOnce.
  - Loki `storage-loki-0`, 10 GiB, `gp2`, ReadWriteOnce, one replica.
  - Prometheus, 20 GiB, `gp3`, ReadWriteOnce, one replica. Retention is 10 days with a 16 GB size cap, so a burst of new series fills the cap and not the disk. Its memory limit is raised from 1 GiB to 2 GiB, because replaying the write-ahead log after a restart needs more memory than steady state, and it was already at 934 MiB of 1 GiB.
- **Rollout status (2026-11-27):** the `gp3` class and the Prometheus volume are written in `ASTRA_argocd` on `develop` but not yet applied. They are planned for after the 2026-11-28 presentation, because enabling them restarts Prometheus and discards the history it holds now. Converting the two existing volumes to `gp3` in AWS is a separate, optional step with no restart.

**Consequences:**

**What this makes easier:**

- Restarting, upgrading or moving Grafana and Loki without losing dashboards or the local index.
- Adding another stateful component by requesting a claim; the volume is provisioned on demand.
- Replacing nodes or rebuilding the node group without losing the two volumes.

**What it makes harder or rules out:**

- **Pods are pinned to a zone.** A volume's zone is fixed when it is created; if that zone has no capacity, the pod stays Pending.
- **Rolling updates can hang.** A ReadWriteOnce volume attaches to one node, so a new pod scheduled on another node waits on `FailedAttachVolume` (hit on 2026-11-23). Use the Recreate strategy or keep one replica.
- **Deleting the claim deletes the volume.** The `Delete` reclaim policy removes the EBS volume with the claim, and there is no snapshot schedule in this repository, so a deleted claim is unrecoverable.
- **The Prometheus rollout discards its current history once.** The new volume starts empty, so graphs begin again from the day it is applied. After that, history survives restarts.
- **Prometheus needs more memory.** The limit is 2 GiB instead of 1 GiB, which is a larger share of a 3.3 GB node.
- **Resizing depends on the class.** `gp3` claims can grow in place; the existing `gp2` claims cannot, so growing one means a new class or a new claim.
- **Existing volumes keep the `gp2` label.** If they are converted to `gp3` in AWS, Kubernetes still shows `gp2`, and a claim re-created from the chart would come back as `gp2`.
- **Capacity counts against node limits.** Each attached volume uses one of the node's attachment slots.
- **Not highly available.** One replica per stateful component, so an outage of that zone takes the component down until the pod is rescheduled elsewhere (and this is only possible after re-creating the volume).

**When to revisit:** if volumes need snapshots or encryption, if a stateful component needs more than one replica, if Prometheus outgrows 20 GiB or needs longer retention, or if the zone pinning causes repeated scheduling failures (then consider a snapshot schedule or EFS).

**Evidence:** [EBS CSI add-on and role](../../18-ebs-csi.tf). In `ASTRA_argocd`: `Applications/storageclass-gp3.yaml` (the `gp3` class), `Applications/kube-prometheus-stack.yaml` (Grafana and Prometheus persistence), `Applications/development/grafana-loki.yaml` (Loki persistence). Live check on the development cluster, 2026-11-27: two bound `gp2` claims, only a `gp2` class, Prometheus with no volume, and Prometheus at 934 MiB of its 1 GiB limit.
