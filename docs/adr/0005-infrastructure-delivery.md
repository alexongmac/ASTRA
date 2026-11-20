# ADR-0005: Manage infrastructure with Terraform and GitHub Actions

**Status:** Proposed

**Date:** 2026-11-14

**Context:**

Development and production use the same Terraform source with different environment values. Infrastructure changes need repeatable execution and AWS authentication from CI. The shared state bucket's documented permission restriction prevents deleting Terraform lockfiles.

**Options Considered:**

1. **Manual AWS console changes:** Provides direct control but does not capture the infrastructure definition and review history in this repository.
2. **Terraform with GitHub Actions:** Matches the existing resource definitions, environment files, and branch workflow.
3. **CloudFormation or CDK:** Would require translating the current Terraform resources and state-management approach.

**Decision:**

Use Terraform with remote S3 state keys `astra/development.tfstate` and `astra/production.tfstate`. Map pushes to `develop` to development and pushes to `main` to production. Use GitHub OIDC to assume environment-specific AWS roles instead of storing AWS access keys in the workflow.

The plan job builds Lambda artifacts, checks Terraform formatting, validates configuration, runs TFLint and a non-blocking Checkov scan, and displays a plan. The apply job references the corresponding GitHub Environment. Production approval depends on required reviewers being configured in repository settings; the workflow alone does not establish that protection.

Keep backend lockfiles disabled as currently configured. Workflow jobs share a per-environment concurrency group to serialize participating jobs. Infrastructure owns AWS resources and selected add-ons; application/platform deployment owns the separately installed charts.

**Consequences:**

Environment state is separated and infrastructure changes are versioned. Separate keys are not separate AWS-account isolation. CI concurrency does not protect against local Terraform runs, and separate plan/apply jobs can interleave with other runs. Apply computes a fresh plan rather than applying the exact reviewed plan artifact. Checkov findings do not block deployment. The Lambda ZIP builder normalizes archive metadata, but its dependency installation is not a fully locked dependency supply chain. Revisit backend locking and saved-plan promotion before requiring strict reviewed-plan execution.

**Evidence:** [Backend](../../2-provider.tf), [deployment workflow](../../.github/workflows/terraform-apply.yml), [OIDC setup](../../0-github_oidc.tf), [trust policy](../../github-oidc-bootstrap/main.tf), [artifact builder](../../lambda/build.py), [environment files](../../envs).
