resource "aws_eip" "nat" {
  domain = "vpc"
  tags = {
    "Name" = "${local.eks_name}-nat-${local.zone1}"
  }
}

resource "aws_nat_gateway" "nat" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public_zone1.id

  tags = {
    "Name" = "${local.eks_name}-nat-${local.zone1}"
  }
  depends_on = [aws_internet_gateway.igw]
}
