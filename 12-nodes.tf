data "aws_iam_policy_document" "ec2_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "nodes" {
  name               = "${local.eks_name}-node-role"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume_role.json
}

resource "aws_iam_role_policy_attachment" "amazon_eks_worker_node_policy" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy"
  role       = aws_iam_role.nodes.name
}

resource "aws_iam_role_policy_attachment" "amazon_eks_cni_policy" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy"
  role       = aws_iam_role.nodes.name
}

resource "aws_iam_role_policy_attachment" "amazon_ec2_container_registry_read_only" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
  role       = aws_iam_role.nodes.name
}

resource "aws_iam_role_policy_attachment" "amazon_ssm_managed_instance_core" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
  role       = aws_iam_role.nodes.name
}

resource "aws_launch_template" "nodes" {
  name_prefix   = "${local.eks_name}-ec2"
  instance_type = "t4g.large"

  tag_specifications {
    resource_type = "instance"
    tags = {
      Name = "${local.eks_name}-ec2"
    }
  }
}

resource "aws_eks_node_group" "general" {
  cluster_name    = aws_eks_cluster.eks.name
  version         = local.eks_version
  node_group_name = "${local.eks_name}-nodes"
  node_role_arn   = aws_iam_role.nodes.arn

  subnet_ids = [
    aws_subnet.private_zone1.id,
    aws_subnet.private_zone2.id,
  ]

  capacity_type = "ON_DEMAND"
  ami_type      = "AL2023_ARM_64_STANDARD"

  launch_template {
    id      = aws_launch_template.nodes.id
    version = aws_launch_template.nodes.latest_version
  }

  scaling_config {
    desired_size = 2
    max_size     = 4
    min_size     = 2
  }

  # 1 means nodes get replaced one at a time during a node group update
  # (e.g. launch template version change), keeping the rest up throughout.
  update_config {
    max_unavailable = 1
  }

  labels = {
    role = aws_iam_role.nodes.name
  }

  depends_on = [
    aws_iam_role_policy_attachment.amazon_eks_worker_node_policy,
    aws_iam_role_policy_attachment.amazon_eks_cni_policy,
    aws_iam_role_policy_attachment.amazon_ec2_container_registry_read_only,
    aws_iam_role_policy_attachment.amazon_ssm_managed_instance_core,
  ]

  # Allow external changes (e.g. cluster-autoscaler scaling the ASG)
  # without terraform plan showing a diff.
  lifecycle {
    ignore_changes = [scaling_config[0].desired_size]
  }
}
