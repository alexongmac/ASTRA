resource "aws_eks_addon" "pod_identity_agent" {
  cluster_name = aws_eks_cluster.eks.name
  addon_name   = "eks-pod-identity-agent"

  resolve_conflicts_on_update = "OVERWRITE"

  depends_on = [aws_eks_node_group.general]
}

resource "aws_eks_addon" "coredns" {
  cluster_name = aws_eks_cluster.eks.name
  addon_name   = "coredns"

  resolve_conflicts_on_update = "OVERWRITE"

  depends_on = [aws_eks_node_group.general]
}

# Powers `kubectl top` and is the metrics source cluster-autoscaler/HPA read
# from - core cluster capability, not an app-layer concern.
resource "aws_eks_addon" "metrics_server" {
  cluster_name = aws_eks_cluster.eks.name
  addon_name   = "metrics-server"

  resolve_conflicts_on_update = "OVERWRITE"

  depends_on = [aws_eks_node_group.general]
}

resource "aws_eks_addon" "cert_manager" {
  cluster_name = aws_eks_cluster.eks.name
  addon_name   = "cert-manager"

  resolve_conflicts_on_update = "OVERWRITE"

  # Explicit resources for all three components - the addon's own defaults
  # don't set a CPU limit, which fails Kyverno's require-resource-limits
  # policy (kyverno-require-resource-limits.yaml).
  configuration_values = jsonencode({
    resources = {
      requests = { cpu = "10m", memory = "32Mi" }
      limits   = { cpu = "100m", memory = "128Mi" }
    }
    cainjector = {
      resources = {
        requests = { cpu = "10m", memory = "32Mi" }
        limits   = { cpu = "100m", memory = "128Mi" }
      }
    }
    webhook = {
      resources = {
        requests = { cpu = "10m", memory = "32Mi" }
        limits   = { cpu = "100m", memory = "64Mi" }
      }
    }
  })

  depends_on = [aws_eks_node_group.general]

}

resource "aws_eks_addon" "node_monitoring_agent" {
  cluster_name = aws_eks_cluster.eks.name
  addon_name   = "eks-node-monitoring-agent"

  resolve_conflicts_on_update = "OVERWRITE"

  depends_on = [aws_eks_node_group.general]
}

resource "aws_eks_addon" "ext_dns" {
  cluster_name = aws_eks_cluster.eks.name
  addon_name   = "external-dns"

  resolve_conflicts_on_update = "OVERWRITE"

  # Default addon config omits a CPU limit, failing Kyverno's
  # require-resource-limits policy (kyverno-require-resource-limits.yaml).
  configuration_values = jsonencode({
    resources = {
      requests = { cpu = "10m", memory = "32Mi" }
      limits   = { cpu = "100m", memory = "64Mi" }
    }
  })

  depends_on = [aws_eks_node_group.general]
}

