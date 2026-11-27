# ADR-0010: Control access with role-based access in AWS, Kubernetes, Argo CD and the app

**Status:** Proposed

**Date:** 2026-11-27

**Context:**

Several people and systems act on ASTRA: teammates who deploy and debug, a CI pipeline that applies Terraform, Argo CD that deploys workloads, and operators who use the web app. Each needs enough access to do its job and no more. The cluster also holds the database connection string, which only the application should be able to read back. RDS rotates the database password every 7 days, so the connection string has to follow it. It used to be copied by hand into the `astra-web-app` secret, and after a rotation logins failed until someone edited it.

**Options Considered:**

1. **Layered RBAC with custom roles:** Map each IAM user into the cluster through an EKS access entry, bind them to custom Kubernetes ClusterRoles through groups, limit Argo CD with its own policy, and give the web app its own operator and handover rules.
   - *Pros:*
     - Each layer enforces its own boundary, so no single control has to be perfect.
     - Roles are defined as code (Terraform and YAML in Git), reviewed and repeatable.
     - Custom roles can withhold specific rights, such as reading secrets, that AWS's managed policies do not.
   - *Cons:*
     - Three systems (AWS, Kubernetes, Argo CD) each have their own role model to keep in step.
     - Custom roles need maintenance as new resource types are added.
2. **AWS managed access policies only:** Give every teammate one of AWS's built-in EKS policies (admin, edit or view).
   - *Pros:*
     - Nothing to write or maintain; AWS keeps the policies current.
     - Simple to explain.
   - *Cons:*
     - The built-in policies are coarse. The edit policy can read secrets, so it cannot protect the database credentials.
     - No middle ground between a broad edit role and read-only.
3. **One shared admin role for everyone:**
   - *Pros:*
     - Fastest to set up and nobody is ever blocked.
   - *Cons:*
     - Everyone can read secrets, change RBAC and delete anything.
     - Actions cannot be traced to a person, and one leaked credential exposes the whole cluster.

**Decision:**

We chose **Option 1: layered RBAC with custom roles.**

**Why:**

- **Least privilege where it matters.** Developers can run and debug workloads, SREs can only look, and neither can read secrets back through the API, which protects the database credentials.
- **Everything is reviewed code.** Access entries are in Terraform and the roles are in `ASTRA_argocd`, so a change to who can do what goes through a pull request.
- **Each layer has a different job.** AWS decides who reaches the cluster, Kubernetes decides what they can do in it, Argo CD decides who can change deployments, and the app decides who can act on a handover.

**Configuration:**

- **AWS to Kubernetes:** each teammate's IAM user has an EKS access entry (`11-teamaccess.tf`). Admins receive the AWS cluster-admin policy. Others are mapped to the Kubernetes groups `eks-developers` or `eks-sres`.
- **Kubernetes roles:** two custom ClusterRoles, bound to those groups with ClusterRoleBindings.
  - `developer` (group `eks-developers`) manages workloads, services, config maps, ingresses and namespaces, reads nodes, and can read logs and exec into pods. It cannot `get` or `list` secrets, only create, update or delete them, which lets Helm charts install.
  - `sre` (group `eks-sres`) is read-only: `get`, `list` and `watch` on pods, nodes, services and the rest of the cluster, plus pod logs. It has no exec, no delete and no create, update or patch, and it cannot read secrets.
- **Argo CD:** a local `developer` account is mapped to `role:developer`, limited to the `astra` project (sync, create, update, delete, logs, exec). The default policy is empty, so everyone else has no access.
- **CI:** the GitHub Actions role has an access entry with the cluster-admin policy so Terraform can manage the cluster.
- **Secrets in `web-app`:** the app reads two Kubernetes secrets.
  - `astra-db-credentials` holds only `DATABASE_URL`. It is created and kept current by External Secrets. Nobody edits it by hand.
  - `astra-web-app` is hand-made and holds `AUTH_SECRET` and `SQS_QUEUE_URL`. These are not in the RDS secret, so they are not synced.
- **External Secrets setup:**
  - *Source:* the RDS-managed master secret in AWS Secrets Manager, which holds only `username` and `password`. An `ExternalSecret` (`envs/development/web-app/external-secret.yaml`) builds `DATABASE_URL` from them, escaping the password, and refreshes it every 5 minutes.
  - *AWS access:* the operator's controller pod uses its own EKS Pod Identity role (`26-external-secrets.tf`). The role can only read and describe that one secret.
  - *Install:* the operator and Reloader are Argo CD apps, not Terraform, which keeps Argo CD changes in Git. Reloader is installed in `web-app` and watches only that namespace, so its permission to read secrets does not extend to other namespaces.
  - *After a rotation:* the operator updates `astra-db-credentials`, and Reloader restarts the web app and worker so they pick up the new password.
  - *Access:* developers cannot create External Secrets resources or read secrets, so they cannot use this path to get the password.
- **Web app:** operators sign in. For a shift handover, only the outgoing operator, the incoming operator and the creator can edit it, and the two named operators approve or reject it.

**Consequences:**

**What this makes easier:**

- Giving a teammate the right level of access by adding them to one group.
- Showing who can do what, because roles and bindings are in Git.
- Keeping the database connection string away from most people.
- Rotating the database password without a manual step. Nobody has to copy it into the cluster, and no password is stored in Git.

**What it makes harder or rules out:**

- **A short failure window remains at each rotation.** RDS changes the password in place, so new database connections can fail until the next 5-minute refresh and the pod restart. Connections already open keep working.
- **Reloader restarts on any change to either secret.** It watches every secret the workload uses, so editing `AUTH_SECRET` in `astra-web-app` also restarts the web app and worker.
- **Two secrets to keep track of.** `astra-web-app` is still hand-made and is not rotated. Only the database credentials are synced.
- **The ExternalSecret hard-codes the RDS secret ARN and database host.** If the database instance is recreated, both change and the file must be updated.
- **A new dependency in the cluster.** If the operator is down, existing secrets keep working, but a rotation is not picked up until it recovers.
- **The CI role is cluster-admin.** A compromised pipeline would have full control of the cluster. A narrower role for CI is a follow-up.
- **The secret restriction is not airtight.** Developers can exec into pods, and a running pod's environment variables include the database connection string, so someone with exec access can still read it.
- **SREs cannot act in an incident.** They can see pods, nodes and services but cannot restart, scale or exec. A fix needs a developer or the cluster admin, which can slow incident response.
- **Developers can write roles and bindings.** Namespace-level RBAC write access can allow an escalation of privileges, so it should be reviewed.
- **Argo CD has one shared account.** The `developer` account is shared, so deployment actions cannot be attributed to a person.
- **No application-wide roles.** Any signed-in operator can acknowledge alarms and write operator logs. Only shift handover has per-record roles.
- **Three role models to keep in step.** AWS, Kubernetes and Argo CD each define roles separately, so a change in one is not applied to the others.

**When to revisit:** if the team grows, if CI needs narrower rights, if actions must be traced to individuals in Argo CD (single sign-on), or if the app needs supervisor and operator roles.

**Evidence:** [Access entries and groups](../../11-teamaccess.tf), [teammate mapping](../../terraform.tfvars). [External Secrets IAM role](../../26-external-secrets.tf). In `ASTRA_argocd`: `Applications/rbac.yaml` (Kubernetes roles and bindings), `Applications/argocd-rbac.yaml` (Argo CD policy), `Applications/development/external-secrets.yaml` and `reloader.yaml` (installs), and `envs/development/web-app/external-secret.yaml` (the secret definition). In the app: `app/lib/shift-handover.ts` (handover roles).
