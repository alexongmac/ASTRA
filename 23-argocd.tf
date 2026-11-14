resource "kubernetes_namespace" "argocd" {
  metadata {
    name = "argocd"
  }

  depends_on = [aws_eks_node_group.general]
}

resource "helm_release" "argocd" {
  name       = "argocd"
  repository = "https://argoproj.github.io/argo-helm"
  chart      = "argo-cd"
  version    = "7.9.1" # app v2.14.11 - newest patch still on the v2 line; v3.x (chart 8+) has breaking changes
  namespace  = kubernetes_namespace.argocd.metadata[0].name

  # Traefik terminates TLS in front of argocd-server, so it must run
  # plaintext internally or it 307-redirect-loops every request (it thinks
  # every request is insecure and keeps redirecting to itself). Set here,
  # not via a separate ConfigMap patch in ASTRA_argocd/Applications/ -
  # this chart's own argocd-cmd-params-cm template would overwrite that
  # patch back to empty on every Helm upgrade, since both own the same
  # ConfigMap object.
  set {
    name  = "configs.params.server\\.insecure"
    value = "true"
  }

  depends_on = [kubernetes_namespace.argocd]
}

# The astra AppProject and the "App of Apps" root Application (ASTRA_argocd's
# bootstrap/ folder) are applied manually via kubectl, not here - the kubectl
# provider's plan-time validation rejects a manifest if any CRD it references
# doesn't exist yet (e.g. kyverno-policies.yaml's ClusterPolicy, before
# Kyverno itself has synced), which blocks `terraform plan` entirely. A
# manual `kubectl apply` doesn't pre-validate CRDs the same way. See
# README.md for the apply command.
