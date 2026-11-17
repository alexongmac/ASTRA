# Request: exclude untaggable resource types from the daily 6am cleanup

Hi [Instructor name],

We understand the daily 6am cleanup (`AWSNukeAdminRole` via GitHub Actions) is meant to catch
untagged/abandoned resources, and we've tagged everything we can (`Project`, `Environment`,
`Team`, `NukeProtection=Enabled` via `default_tags` in our AWS provider). However, we've found
that several AWS resource types have **no tagging support at all**, so they get wiped every
single day regardless of how correctly the parent resource is tagged. This is forcing a full
manual recovery (`terraform apply`) every morning before our cluster is usable.

## Resource types that cannot be tagged (and are wiped daily regardless)

1. **IAM managed-policy attachments** (`AttachRolePolicy` / `DetachRolePolicy`)
   The *link* between a role and an AWS-managed policy (e.g. `AmazonEKSClusterPolicy` on an
   EKS cluster role) is not a taggable object in the IAM API — only the role and the policy
   are. Every day this strips the policies off our EKS cluster role, node role, LB controller
   role, cluster-autoscaler role, EBS CSI role, and our GitHub OIDC/CI role.

2. **IAM inline role policies** (`PutRolePolicy` / `DeleteRolePolicy`)
   Policies embedded directly on a role (not a separate managed-policy object) also have no
   tag slot. This strips permissions for cert-manager, external-dns, Loki's S3 access, our
   Lambda functions, and all the scoped permissions on our CI role.

3. **IoT Things and IoT Certificates**
   `aws_iot_thing` and `aws_iot_certificate` do not support tagging — confirmed directly
   against the IoT API (`TagResource` on a `thing` ARN returns
   `InvalidRequestException: Invalid resource type in ARN: thing`). This deletes our IoT
   device registration and certificate daily, requiring us to re-provision and re-export a
   new certificate to our physical hardware each time.

4. **EKS-managed node group launch templates**
   The internal launch template EKS creates for a managed node group (separate from any
   launch template we define ourselves) isn't user-taggable in a way that survives the sweep.
   When it's deleted, the node group's Auto Scaling Group fails to launch replacement
   instances (`Ec2LaunchTemplateNotFound`), which took our worker nodes fully offline this
   morning and required deleting and recreating the entire node group.

## This is not unique to our team

We checked another group's AWS resources (`carelink-*` IAM roles) and confirmed via
CloudTrail that the exact same categories are being stripped from their account every day
going back at least to 2026-11-07 — including their **production** environment, and even
their own CI role's `AdministratorAccess` attachment. This is an account-wide pattern hitting
every team identically, not something specific to our tagging setup.

## What we're asking for

Given that `NukeProtection=Enabled` (and full tagging generally) cannot protect these four
resource categories no matter what we do on our end, we'd like to ask whether the nuke
config can add an exclusion filter for:
- IAM role policy attachments and inline policies on roles tagged `NukeProtection=Enabled`
- IoT things/certificates belonging to a tagged IoT thing group (or by naming prefix)
- EKS-managed node group launch templates for clusters tagged `NukeProtection=Enabled`

Alternatively, if there's a reason these specific types are intentionally swept regardless of
tags, we'd appreciate understanding the reasoning so we can plan around it — right now it
costs us a full manual recovery pass every single morning.

Happy to share our CloudTrail evidence or Terraform config if useful.

Thanks,
[Your name]
