# ADR-0007: Use NGINX ingress with automated DNS and TLS certificates

**Status:** Proposed

**Date:** 2026-11-14

**Context:**

The repository includes hostname-based ingress definitions for Grafana and Prometheus. These endpoints need DNS records and TLS certificates. AWS infrastructure prerequisites and Kubernetes routing configuration have separate deployment ownership.

**Options Considered:**

1. **NGINX ingress with cert-manager and external-dns:** Matches the supplied Ingress manifests and DNS permissions.
2. **ALB-native ingress with ACM certificates:** Would require a different ingress class and certificate integration.
3. **Manual DNS and certificate management:** Reduces controller use but adds manual synchronization and renewal work.

**Decision:**

Use the `nginx` ingress class for the supplied monitoring endpoints. Configure TLS through the `letsencrypt-prod` ClusterIssuer using a Route 53 DNS-01 solver. Annotate Ingress resources for external-dns to synchronize their hostnames.

Terraform supplies cert-manager and external-dns add-ons, their Pod Identity associations, and hosted-zone-scoped record permissions. It also supplies AWS Load Balancer Controller IAM prerequisites. The load balancer controller and ingress-nginx charts are expected from the separate platform/application deployment; the precise load balancer type and chart configuration are not established by this repository.

**Consequences:**

Routing, DNS, and certificate intent are captured in manifests and IAM configuration. Operation depends on installed controllers, matching service accounts, DNS ownership, and certificate issuance. TLS does not supply dashboard authentication or authorization. The monitoring hostnames are fixed rather than environment-specific, so applying the same manifests in both environments requires an ownership and naming decision. Revisit when exposure requirements, controller support, or environment routing changes.

**Evidence:** [Load balancer prerequisites](../../15-ingress-nginx.tf), [DNS permissions](../../19-cert-manager-dns.tf), [issuer](../../clusterissuer.yaml), [Grafana ingress](../../grafana-ingress.yaml), [Prometheus ingress](../../prometheus-ingress.yaml).
