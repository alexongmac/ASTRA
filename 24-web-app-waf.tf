locals {
  # development stays unsuffixed, matching the other astra-* hostnames;
  # production takes the -prod suffix the monitoring hostnames use.
  web_app_hostname = var.environment == "development" ? "astra-app.sctp-sandbox.com" : "astra-app-prod.sctp-sandbox.com"

  web_app_waf_managed_rules = {
    AWSManagedRulesCommonRuleSet          = 10
    AWSManagedRulesKnownBadInputsRuleSet  = 20
    AWSManagedRulesSQLiRuleSet            = 30
    AWSManagedRulesAmazonIpReputationList = 40
  }
}

data "aws_route53_zone" "sandbox" {
  name         = "sctp-sandbox.com"
  private_zone = false
}

# An ALB terminates TLS with an ACM certificate - it can't use the
# cert-manager/Let's Encrypt secrets the Traefik ingresses use. The AWS Load
# Balancer Controller discovers this certificate by the Ingress host name.
resource "aws_acm_certificate" "web_app" {
  domain_name       = local.web_app_hostname
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "web_app_cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.web_app.domain_validation_options :
    dvo.domain_name => {
      name   = dvo.resource_record_name
      type   = dvo.resource_record_type
      record = dvo.resource_record_value
    }
  }

  zone_id         = data.aws_route53_zone.sandbox.zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 60
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "web_app" {
  certificate_arn         = aws_acm_certificate.web_app.arn
  validation_record_fqdns = [for r in aws_route53_record.web_app_cert_validation : r.fqdn]
}

# Attached to the web app's ALB by the Ingress annotation
# alb.ingress.kubernetes.io/wafv2-acl-arn - there is no association resource
# here because the AWS Load Balancer Controller owns the ALB.
resource "aws_wafv2_web_acl" "web_app" {
  name  = "${local.eks_name}-web-app"
  scope = "REGIONAL"

  default_action {
    allow {}
  }

  dynamic "rule" {
    for_each = local.web_app_waf_managed_rules

    content {
      name     = rule.key
      priority = rule.value

      override_action {
        none {}
      }

      statement {
        managed_rule_group_statement {
          name        = rule.key
          vendor_name = "AWS"

          # The Common rule set blocks any request body over 8 KB, which stops
          # attachments being uploaded on the shift handover page. Count that one
          # rule instead of blocking; the BlockLargeBodyExceptUploads rule below
          # restores the same limit for every path except the upload endpoints.
          dynamic "rule_action_override" {
            for_each = rule.key == "AWSManagedRulesCommonRuleSet" ? ["SizeRestrictions_BODY"] : []

            content {
              name = rule_action_override.value

              action_to_use {
                count {}
              }
            }
          }
        }
      }

      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = rule.key
        sampled_requests_enabled   = true
      }
    }
  }

  # Same 8 KB body limit the Common rule set applies, but not for the shift
  # handover endpoints, whose uploads are larger (the app caps each file itself).
  rule {
    name     = "BlockLargeBodyExceptUploads"
    priority = 15

    action {
      block {}
    }

    statement {
      and_statement {
        statement {
          size_constraint_statement {
            comparison_operator = "GT"
            size                = 8192

            field_to_match {
              body {
                oversize_handling = "MATCH"
              }
            }

            text_transformation {
              priority = 0
              type     = "NONE"
            }
          }
        }

        statement {
          not_statement {
            statement {
              byte_match_statement {
                search_string         = "/api/shift-handovers/"
                positional_constraint = "STARTS_WITH"

                field_to_match {
                  uri_path {}
                }

                text_transformation {
                  priority = 0
                  type     = "NONE"
                }
              }
            }
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "BlockLargeBodyExceptUploads"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "RateLimitPerIp"
    priority = 50

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = 2000
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "RateLimitPerIp"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${local.eks_name}-web-app"
    sampled_requests_enabled   = true
  }
}

output "web_app_hostname" {
  value = local.web_app_hostname
}

output "web_app_waf_acl_arn" {
  value = aws_wafv2_web_acl.web_app.arn
}

output "web_app_certificate_arn" {
  value = aws_acm_certificate_validation.web_app.certificate_arn
}
