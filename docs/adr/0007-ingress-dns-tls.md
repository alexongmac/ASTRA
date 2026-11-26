# ADR-0007: Use Traefik and an AWS ALB for ingress, with automated DNS and TLS

**Status:** Proposed

**Date:** 2026-11-14

**Context:**

ASTRA exposes two kinds of endpoints. The operator-facing web app (`astra-app`) is public and needs a managed TLS certificate and a web application firewall. The internal tools (Grafana, Prometheus, Alertmanager, Argo CD) need hostnames and TLS certificates but not AWS-managed edge protection. All of them need DNS records. AWS infrastructure prerequisites (IAM, certificates, WAF, hosted-zone permissions) live in this repository; the Kubernetes routing manifests and controller charts live in the separate `ASTRA_argocd` repository.

**Options Considered:**

1. **Traefik for tools, AWS ALB for the web app:** Two ingress classes, each used where it fits best.
   - *Pros:*
     - The web app gets an ALB with an ACM certificate and an attached AWS WAF web ACL, which Traefik cannot provide.
     - Traefik serves all the internal tools through one shared load balancer and certificates from cert-manager (Let's Encrypt), so adding a tool costs no extra AWS load balancer.
     - Traefik exposes Prometheus metrics that feed the monitoring stack.
     - Both controllers are Argo CD managed, so routing stays in Git.
   - *Cons:*
     - Two ingress controllers and two certificate mechanisms (ACM and cert-manager) to understand and maintain.
     - Traefik's `IngressClass` must exist before any `traefik` ingress syncs, so Traefik is bootstrapped first (see README).
     - Traefik's own metrics never see web app traffic, so that traffic is monitored through CloudWatch instead.
2. **ALB for everything (AWS Load Balancer Controller with ACM):**
   - *Pros:*
     - One ingress controller and one certificate mechanism.
     - AWS-managed TLS and WAF available for every hostname.
   - *Cons:*
     - Each ALB adds an hourly cost, unless ingresses share one through ingress groups, which adds configuration.
     - Every hostname needs its own ACM certificate and validation records.
     - ALB-based internal tools lose the simple cert-manager and basic-auth middleware pattern we use today.
3. **NGINX ingress controller with cert-manager and external-dns:**
   - *Pros:*
     - Widely used and well documented.
     - A single controller for web app and tools.
   - *Cons:*
     - A third option nobody on the team operates, with nothing in the cluster using it.
     - No AWS WAF integration for the web app without extra work.
     - The community ingress-nginx project is being retired, which is a poor basis for a new platform.
4. **Manual DNS and certificate management:**
   - *Pros:*
     - No controllers and no controller IAM permissions.
   - *Cons:*
     - Manual record updates and certificate renewals; easy to forget and cause an outage.

**Decision:**

We chose **Option 1: Traefik for internal tools and an AWS ALB for the web app.**

**Why:**

- **The web app needs AWS-native protection.** Its ALB terminates TLS with an ACM certificate and has an AWS WAF web ACL attached through the `wafv2-acl-arn` annotation.
- **The internal tools are cheaper and simpler behind Traefik.** One Network Load Balancer fronts every tool, and cert-manager issues the certificates.
- **DNS is automated for both.** external-dns keeps Route 53 records in step with the ingress hostnames.

**Configuration:**

- **Traefik** is installed by Argo CD as a standalone application with `ingressClass` enabled as the default class. It sits behind an internet-facing NLB (service type `LoadBalancer`) and has a Prometheus `ServiceMonitor`. The Grafana, Prometheus, Alertmanager and Argo CD ingresses use `ingressClassName: traefik`, the `letsencrypt-prod` ClusterIssuer (Route 53 DNS-01 solver) and the external-dns hostname annotation.
- **The web app** uses `ingressClassName: alb` with an internet-facing, IP-target ALB, HTTP-to-HTTPS redirect, `/api/health` health check and the WAF ACL ARN. Terraform creates its ACM certificate and DNS validation records, and the controller finds the certificate by the ingress host name.
- **Terraform** supplies the cert-manager and external-dns Pod Identity roles with hosted-zone-scoped Route 53 permissions, and the AWS Load Balancer Controller IAM prerequisites. The controller and Traefik charts themselves come from the separate `ASTRA_argocd` repository.

**Consequences:**

**What this makes easier:**

- Giving the web app managed TLS and WAF protection without touching the tools' routing.
- Adding another internal tool: one Ingress with the `traefik` class, and DNS and the certificate follow automatically.
- Keeping routing, DNS and certificate intent in Git through Argo CD.

**What it makes harder or rules out:**

- **Two controllers to run.** We maintain Traefik and the AWS Load Balancer Controller, plus two certificate paths (ACM and Let's Encrypt).
- **Bootstrap order matters.** Traefik must be applied before the root Argo CD apps, otherwise `traefik` ingresses fail to sync.
- **TLS is not authentication.** The tools sit behind basic-auth middleware or their own login; certificates alone do not protect them.
- **Hostnames differ per environment.** Development uses unsuffixed names (for example `astra-app`); production takes a `-prod` suffix, and the two environments must keep separate ownership of their records.
- **NGINX ingress is ruled out** for this cluster; adopting it later would mean a third ingress class.
- **Let's Encrypt rate limits and DNS-01 propagation** apply to the Traefik-fronted hostnames.

**When to revisit:** if running two controllers becomes a burden, if the tools need AWS WAF or ACM, or if the number of exposed hostnames grows enough to justify a single ingress model.

**Evidence:** [AWS Load Balancer Controller prerequisites](../../15-aws-lb-controller.tf), [cert-manager and external-dns permissions](../../19-cert-manager-dns.tf), [web app ACM certificate and WAF](../../24-web-app-waf.tf). In the `ASTRA_argocd` repository: `bootstrap/traefik-app-development.yaml`, `Applications/clusterissuer.yaml`, `Applications/development/grafana-ingress.yaml`, `Applications/development/prometheus-ingress.yaml`, `envs/development/web-app/ingress.yaml`.
