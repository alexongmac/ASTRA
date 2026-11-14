# ADR-0002: Place workloads in private subnets across two availability zones

**Status:** Proposed

**Date:** 2026-11-14

**Context:**

EKS workers, the ingestion Lambda, and RDS need internal connectivity. The platform also needs internet-facing entry points and outbound access from private workloads. The configuration uses `us-east-1a` and `us-east-1b` in `us-east-1`.

**Options Considered:**

1. **Public workload subnets:** Reduces routing components but gives workloads a more direct public networking model.
2. **Private workloads with one shared NAT gateway:** Matches the current topology with one managed outbound gateway.
3. **Private workloads with a NAT gateway per AZ:** Removes the shared gateway dependency for AZ-local egress but adds another gateway to operate and pay for.

**Decision:**

Use a `172.20.0.0/16` VPC with two public and two private subnets. Public subnets route through an internet gateway. Both private subnets share a route table whose default route uses one NAT gateway in the first public subnet. Place EKS workers, RDS's subnet group, and the ingestion Lambda in private subnets.

Retain the configured EKS private and public API endpoints. The public endpoint currently allows `0.0.0.0/0`; private worker placement must not be described as a private-only control plane.

**Consequences:**

Private workloads have controlled inbound paths while retaining outbound connectivity. Both AZs depend on the first AZ's NAT gateway for this default egress path, and traffic from the second AZ crosses zones. Security groups and IAM remain necessary controls. Revisit shared NAT and public API access when availability targets and administrator access requirements are agreed.

**Evidence:** [VPC](../../3-vpc.tf), [subnets](../../5-subnets.tf), [NAT](../../6-nat.tf), [routes](../../7-routes.tf), [EKS endpoint](../../9-eks.tf), [Lambda networking](../../22-iot-ingest.tf).
