resource "aws_vpc" "main" {
  cidr_block = "172.20.0.0/16"

  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    "Name" = "${local.eks_name}-vpc"
  }
}

# The VPC's implicit main route table, default security group and default
# network ACL aren't managed resources here (the explicit route tables live
# in 7-routes.tf), so default_tags never reaches them - tag them directly.
locals {
  vpc_implicit_resources = {
    main_route_table = aws_vpc.main.default_route_table_id
    default_sg       = aws_vpc.main.default_security_group_id
    default_nacl     = aws_vpc.main.default_network_acl_id
  }

  vpc_implicit_tags = {
    Project        = "capstone-project-group-01"
    Environment    = var.environment
    Team           = local.team_name
    NukeProtection = "Enabled"
  }

  vpc_implicit_tag_pairs = merge([
    for res, id in local.vpc_implicit_resources : {
      for key, value in local.vpc_implicit_tags :
      "${res}/${key}" => { id = id, key = key, value = value }
    }
  ]...)
}

resource "aws_ec2_tag" "vpc_implicit" {
  for_each = local.vpc_implicit_tag_pairs

  resource_id = each.value.id
  key         = each.value.key
  value       = each.value.value
}

moved {
  from = aws_ec2_tag.main_route_table_project
  to   = aws_ec2_tag.vpc_implicit["main_route_table/Project"]
}

moved {
  from = aws_ec2_tag.main_route_table_nuke_protection
  to   = aws_ec2_tag.vpc_implicit["main_route_table/NukeProtection"]
}

moved {
  from = aws_ec2_tag.default_sg_project
  to   = aws_ec2_tag.vpc_implicit["default_sg/Project"]
}

moved {
  from = aws_ec2_tag.default_sg_nuke_protection
  to   = aws_ec2_tag.vpc_implicit["default_sg/NukeProtection"]
}

moved {
  from = aws_ec2_tag.default_nacl_project
  to   = aws_ec2_tag.vpc_implicit["default_nacl/Project"]
}

moved {
  from = aws_ec2_tag.default_nacl_nuke_protection
  to   = aws_ec2_tag.vpc_implicit["default_nacl/NukeProtection"]
}
