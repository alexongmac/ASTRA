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
  name_prefix = "${local.eks_name}-ec2"
  # x86_64. Must stay in step with ami_type on the node group below, and with
  # the runs-on runner in .github/workflows/web-app-deploy.yml: an image built
  # for a different architecture fails at pod start with "no match for platform
  # in manifest".
  instance_type = "t3.medium"

  # EKS managed node groups do not use this template directly: they copy it
  # into an internal eks-<uuid> template that the ASG references. The 6am
  # sweep deletes those copies (they carry no tags to protect), which leaves
  # the node group DEGRADED with Ec2LaunchTemplateNotFound and crashes
  # cluster-autoscaler, while terraform plan reports no drift because the
  # template it owns is still there.
  #
  # Changing this description publishes a new version of this template, which
  # makes EKS regenerate its internal copy and repoint the ASG. Bump the date
  # to force that regeneration after a sweep has taken the copy.
  description = "astra nodes, regenerated 2026-11-20"

  # The AMI's default ~20 GiB root volume fills up with the monitoring/policy
  # stack's images and hits kubelet DiskPressure evictions.
  block_device_mappings {
    device_name = "/dev/xvda"
    ebs {
      volume_size           = 50
      volume_type           = "gp3"
      encrypted             = true
      delete_on_termination = true
    }
  }

  # Provider default_tags don't propagate into tag_specifications, so the
  # instances and volumes the node group launches need the full set here.
  tag_specifications {
    resource_type = "instance"
    tags = {
      Name           = "${local.eks_name}-ec2"
      Project        = "capstone-project-group-01"
      Environment    = var.environment
      Team           = local.team_name
      NukeProtection = "Enabled"
    }
  }

  tag_specifications {
    resource_type = "volume"
    tags = {
      Project        = "capstone-project-group-01"
      Environment    = var.environment
      Team           = local.team_name
      NukeProtection = "Enabled"
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
  # Paired with instance_type = "t3.medium" above. t3.medium has 4 GiB against
  # t4g.large's 8, so the monitoring/policy stack (kube-prometheus-stack, Loki,
  # Kyverno, Trivy) runs with much less headroom here; watch for evicted pods
  # and raise min_size if they appear.
  ami_type = "AL2023_x86_64_STANDARD"

  launch_template {
    id      = aws_launch_template.nodes.id
    version = aws_launch_template.nodes.latest_version
  }

  scaling_config {
    desired_size = 6
    max_size     = 10
    min_size     = 3
  }

  # 1 means nodes get replaced one at a time during a node group update
  # (e.g. launch template version change), keeping the rest up throughout.
  update_config {
    max_unavailable = 1
  }

  labels = {
    role = aws_iam_role.nodes.name
  }

  # Set explicitly rather than relying on provider default_tags. EKS creates its
  # own internal launch template (named eks-<nodegroup-uuid>) for the ASG and
  # stamps some of the node group's tags onto it; that internal copy is what the
  # nightly sweep deletes, leaving the node group DEGRADED with
  # Ec2LaunchTemplateNotFound while terraform plan still reports no drift.
  #
  # Honest caveat: this is defence-in-depth, not a proven fix. On 2026-11-21 the
  # sweep deleted the internal template of 3 of 4 teams' node groups. The two
  # that survived (capstone-project-group-03) carry the same kind of tags this
  # block sets, and their internal templates do show a propagated Project tag -
  # but group-04 carries MORE tags than they do and was deleted anyway, and ours
  # already carried Project/Environment/Team/NukeProtection on the node group
  # itself and was deleted too. The likelier differentiator is resource age: the
  # survivors' templates date from 2026-11-13 and predate the sweep window,
  # while every template created in the last few days was taken. Confirm the
  # nuke config's filters with the instructor before trusting tags alone.
  tags = {
    Project        = "capstone-project-group-01"
    Environment    = var.environment
    Team           = local.team_name
    NukeProtection = "Enabled"
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
