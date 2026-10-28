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

  depends_on = [aws_eks_node_group.general]
}

