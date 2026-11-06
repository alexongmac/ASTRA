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

# Bootstraps the astra AppProject and the "App of Apps" root Application
# from ASTRA_argocd. ArgoCD then takes over syncing everything under
# Applications/ in that repo - these are the only manifests Terraform
# ever applies directly.
data "http" "astra_project_manifest" {
  url = "https://raw.githubusercontent.com/alexongmac/ASTRA_argocd/main/bootstrap/astra-project.yaml"
}

resource "kubectl_manifest" "astra_project" {
  yaml_body = data.http.astra_project_manifest.response_body

  depends_on = [helm_release.argocd]
}

data "http" "root_app_manifest" {
  url = "https://raw.githubusercontent.com/alexongmac/ASTRA_argocd/main/bootstrap/root-app.yaml"
}

locals {
  # development tracks the develop branch, production tracks main - keeps
  # each cluster in sync with the branch its own tfvars already selects.
  argocd_target_revision = var.environment == "production" ? "main" : "develop"
}

resource "kubectl_manifest" "root_app" {
  yaml_body = replace(
    data.http.root_app_manifest.response_body,
    "targetRevision: main",
    "targetRevision: ${local.argocd_target_revision}",
  )

  depends_on = [kubectl_manifest.astra_project]
}
