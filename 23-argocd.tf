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
  version    = "7.8.2"
  namespace  = kubernetes_namespace.argocd.metadata[0].name

  depends_on = [kubernetes_namespace.argocd]
}

# The astra AppProject and the "App of Apps" root Application (ASTRA_argocd's
# bootstrap/ folder) are applied manually via kubectl, not here - the kubectl
# provider's plan-time validation rejects a manifest if any CRD it references
# doesn't exist yet (e.g. kyverno-policies.yaml's ClusterPolicy, before
# Kyverno itself has synced), which blocks `terraform plan` entirely. A
# manual `kubectl apply` doesn't pre-validate CRDs the same way. See
# README.md for the apply command.
