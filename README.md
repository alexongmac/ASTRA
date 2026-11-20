# ASTRA — operator notes

Working commands for the development and production clusters. Run everything
from the repo root unless a section says otherwise.

### One-time setup, after provider.tf changes

terraform init -reconfigure

### Day to day Ensure your are in the correct branch

run this command when you're in branch develop. but the backend must be switched first

git checkout develop
terraform init -reconfigure -backend-config=key=astra/development.tfstate
grep '"key"' .terraform/terraform.tfstate (must print development)

ensure PR is performed and merged, then switch to main, to run this command, the the backend must be switched first.

git checkout main
terraform init -reconfigure -backend-config=key=astra/production.tfstate
grep '"key"' .terraform/terraform.tfstate (must print production)

reconfigure matters when switching between environments: without it,
Terraform offers to copy the current state into the new key, and answering
"yes" would overwrite prod's state with dev's (or vice versa).

terraform plan -var-file=envs/development.tfvars
terraform plan -var-file=envs/production.tfvars

terraform apply --auto-approve -var-file=envs/development.tfvars
terraform apply --auto-approve -var-file=envs/production.tfvars

Review the plan/apply before typing "yes" - especially any destroy or
"must be replaced" lines.

### State files in the S3 bucket `sctp-tfstate-ce13`

- astra/development.tfstate
- astra/production.tfstate

### Terraform destroy

Check you are on the `develop` branch first.

terraform destroy --auto-approve -var-file="envs/development.tfvars"

terraform destroy --auto-approve -var-file="envs/production.tfvars"

### Recovering from the daily 6am sweep

The sweep deletes AWS resources, not the state file. State still records them as
existing while AWS no longer has them, which is ordinary drift: `terraform plan`
refreshes against reality and proposes recreating what is missing. No state
import is needed — a plan showing only additions and no destroys confirms that.

terraform plan -var-file=envs/development.tfvars

terraform apply -var-file=envs/development.tfvars -auto-approve

It mainly takes untaggable resources: IAM inline policies, role-policy
attachments and IoT topic rules. Afterwards the worker still holds stale
credentials and keeps failing with "169.254.170.23 is not a valid container
metadata service hostname", so restart it:

kubectl rollout restart deployment/astra-web-app-worker -n web-app

### When the node group is DEGRADED after a sweep (Ec2LaunchTemplateNotFound)

This one does NOT show up as drift, so the plan/apply above will not fix it.

Symptoms:

- EKS console shows the node group Degraded, with health issue
  `Ec2LaunchTemplateNotFound: The Amazon EC2 Launch Template lt-xxxx version 1 was not found`
- cluster-autoscaler is in CrashLoopBackOff with a high restart count
- `terraform plan` says "No changes"
- Running nodes and pods are FINE — what is lost is the ability to launch new
  ones, so a node that dies is not replaced and scaling stops

Why. There are two launch templates per node group. `aws_launch_template.nodes`
in 12-nodes.tf is ours and is tagged NukeProtection, so it survives. EKS copies
it into an internal `eks-<uuid>` template that the ASG actually references, and
that copy carries none of our tags, so the sweep deletes it. Terraform never
sees a problem because the template it owns is still there.

Confirm which template the ASG is pointing at and whether it still exists:

aws eks describe-nodegroup --cluster-name astra-eks-development-cluster \
 --nodegroup-name astra-eks-development-nodes \
 --query 'nodegroup.{status:status,health:health}' --region us-east-1

Do NOT bother bumping the launch template version to fix this. Publishing a new
version is the normal way to make EKS regenerate its copy, but
UpdateNodegroupVersion refuses while the node group is already DEGRADED:

    InvalidRequestException: Nodegroup health has issues other than
    [ AsgInstanceLaunchFailures, InstanceLimitExceeded,
      InsufficientFreeAddresses, ClusterUnreachable,
      Ec2LaunchTemplateVersionMismatch ]

`Ec2LaunchTemplateNotFound` is not on that allowlist, so EKS blocks the very
operation that would repair it. Both a local apply and the CI run fail here.

The fix is to recreate the node group. Verify the backend FIRST — this destroys
nodes, and getting the wrong environment here is unrecoverable:

grep '"key"' .terraform/terraform.tfstate (must print the environment you intend)

terraform taint aws_eks_node_group.general

terraform plan -var-file=envs/development.tfvars

Expect "5 to add, 0 to change, 5 to destroy": the node group plus its four
aws_autoscaling_group_tag resources, which move because the ASG name changes.
If the plan proposes anything else, stop and read it.

terraform apply -var-file=envs/development.tfvars

Note this is NOT a rolling replacement. aws_eks_node_group has no
create_before_destroy, so the old node group goes away before the new one
exists and there is a window of several minutes with zero nodes. The
`max_unavailable = 1` setting only applies to in-place version updates. Expect
the site to return errors during it; budget 10-20 minutes.

Afterwards the pods from the destroyed nodes may sit in Error/Completed with the
deployments showing 0/2. Clear them so they reschedule:

kubectl delete pods -n web-app --all

Then confirm recovery — status ACTIVE with an empty issues list, and the
autoscaler Running rather than CrashLoopBackOff:

aws eks describe-nodegroup --cluster-name astra-eks-development-cluster \
 --nodegroup-name astra-eks-development-nodes \
 --query 'nodegroup.{status:status,issues:health.issues}' --region us-east-1

kubectl get pods -n kube-system | grep autoscaler

kubectl get deploy -n web-app

This recurs. The sweep will delete the regenerated copy the next morning, so
treat the above as a routine ~15 minute procedure rather than a one-off repair,
and run it on the day it matters rather than the night before. Karpenter would
avoid the failure mode entirely, since it manages instances directly instead of
through an ASG, but it needs its own controller node group and is a migration in
its own right.

### to restart when the pods is down, example

aws eks update-kubeconfig --region us-east-1 --name astra-eks-<env-cluster> --profile alexongmac
kubectl rollout restart deployment -n external-dns
kubectl rollout restart deployment -n cert-manager

### Fetching the IoT certificates

Run from the ASTRA directory.

terraform output -raw iot_certificate_pem > certs/nodered-bridge.crt
terraform output -raw iot_private_key > certs/nodered-bridge.key
terraform output -raw iot_endpoint > certs/iot-endpoint.txt
curl -s https://www.amazontrust.com/repository/AmazonRootCA1.pem > certs/AmazonRootCA1.pem

chmod 600 certs/nodered-bridge.key
ls -l certs/

### Kyverno policy reports

kubectl get polr -A
kubectl get polr -A --no-headers | awk '{fail[$1]+=$6; total[$1]++} END {for (ns in fail) print ns, "fail="fail[ns], "resources="total[ns]}' | sort -k2 -t= -rn

### Grafana admin password

kubectl --namespace monitoring get secrets kube-prometheus-stack-grafana -o jsonpath="{.data.admin-password}" | base64 -d ; echo

### CloudWatch audit logs — who did what, when, via the K8s API

1. Go to CloudWatch -> Log groups

2. Find /aws/eks/astra-eks-development-cluster/cluster (or -production-)

3. Inside it you'll see separate log streams per log type: kube-apiserver-audit-..., kube-apiserver-... (since you enabled api and audit)

4. Click a stream to view entries, or use Logs Insights to run queries across all streams in the group

### Audit logs via the AWS CLI

aws logs describe-log-streams \
 --log-group-name /aws/eks/astra-eks-development-cluster/cluster \
 --region us-east-1

aws logs tail /aws/eks/astra-eks-development-cluster/cluster --follow --region us-east-1

aws logs start-query \
 --log-group-name /aws/eks/astra-eks-development-cluster/cluster \
 --start-time $(date -v-1H +%s) \
 --end-time $(date +%s) \
 --query-string 'fields @timestamp, @message | filter @logStream like /audit/ | sort @timestamp desc | limit 20' \
 --region us-east-1

Then fetch results with

aws logs get-query-results --query-id <id>.

### Common aws eks commands

- aws eks update-kubeconfig --region us-east-1 --name astra-eks-development-cluster --profile <aws_username>

- aws eks describe-cluster --name astra-eks-development-cluster --output json

- kubectl api-resources

- kubectl cluster-info dump

- kubectl get pods -n <namespace> -l app.kubernetes.io/name=<app name>

### Check ArgoCD is running

kubectl get pods,svc,secrets -n argocd

### Get the ArgoCD admin secret

kubectl get secret -n argocd

kubectl get secret argocd-initial-admin-secret -n argocd -o jsonpath="{.data.password}" | base64 --decode

### Access the ArgoCD UI locally on port 8080

kubectl get svc -n argocd
kubectl port-forward svc/argocd-server -n argocd 8080:443
open browser type: localhost:8080/

### ArgoCD login

Username: admin
password : xxxxxxxxxxx

### Access RDS from inside the cluster

kubectl apply -f rds-access.yaml
kubectl wait --for=condition=Ready pod/rds-access --timeout=60s
kubectl exec -it rds-access -- mysql \
 -h astra-mysql-db.chheppac9ozc.us-east-1.rds.amazonaws.com \
 -P 3306 -u dbadmin -p astradb -e "SHOW TABLES;"

enter the password from Secrets Manager

### Access RDS by port forwarding

Creates a relay pod in the cluster and forwards a local port through it.

kubectl apply -f rds-proxy.yaml
kubectl wait --for=condition=Ready pod/rds-proxy --timeout=60s
kubectl port-forward pod/rds-proxy 3306:3306

Connect via Workbench to 127.0.0.1:3306, user dbadmin, schema astradb, password from Secrets Manager.

### Access RDS through an SSM tunnel for eks-development

No relay pod needed — this forwards through a node's SSM agent instead, so it
works even when the cluster is unhealthy. This is what the local web app and
worker use, on port 13306 to avoid clashing with a local MySQL on 3306.

Pick any node that is online. The IDs change whenever nodes are replaced, so
look them up rather than reusing an old one:

aws ssm describe-instance-information --query "InstanceInformationList[?PingStatus=='Online'].InstanceId" --output text

Then open the tunnel, leaving it running in its own terminal:

aws ssm start-session --target <instance-id> \
 --document-name AWS-StartPortForwardingSessionToRemoteHost \
 --parameters '{"host":["astra-mysql-db.chheppac9ozc.us-east-1.rds.amazonaws.com"],"portNumber":["3306"],"localPortNumber":["13306"]}'

Connect Workbench to 127.0.0.1:13306, user dbadmin, schema astradb, password
from Secrets Manager. The app reads the same tunnel through DATABASE_URL in
app/.env.local.

Check it is up with:

nc -z 127.0.0.1 13306 && echo "tunnel up"

### Access RDS through an SSM tunnel for eks-production

# Terminal 1 — tunnel to production RDS via a production node

aws ssm describe-instance-information --query "InstanceInformationList[?PingStatus=='Online'].InstanceId" --output text

aws ssm start-session --target <a-production-node-id> \
 --document-name AWS-StartPortForwardingSessionToRemoteHost \
 --parameters '{"host":["astra-mysql-db-production.chheppac9ozc.us-east-1.rds.amazonaws.com"],"portNumber":["3306"],"localPortNumber":["13307"]}'

# Terminal 2

cd /Users/alex/Desktop/ClassActivity/ASTRA/app
DATABASE_URL="mysql://dbadmin:<password-from-secrets-manager>@127.0.0.1:13307/astradb" npx prisma migrate deploy
DATABASE_URL="..." SEED_OPERATOR_USERNAME=alex SEED_OPERATOR_PASSWORD='your-choice' SEED_OPERATOR_NAME=alex npm run seed

### Clean up the relay pods

kubectl delete -f rds-access.yaml
kubectl delete -f rds-proxy.yaml

### Dump the SQL database

kubectl exec rds-access -- mysqldump \
 -h astra-mysql-db.chheppac9ozc.us-east-1.rds.amazonaws.com \
 -P 3306 -u dbadmin -p'your secrets password' \
 --single-transaction --skip-lock-tables \
 --column-statistics=0 \
 --databases astradb > astradb_dump.sql

### Export a database table to CSV

kubectl exec rds-access -- mysql \
 -h astra-mysql-db.chheppac9ozc.us-east-1.rds.amazonaws.com \
 -P 3306 -u dbadmin -p'your secrets password' astradb \
 -e "SELECT \* FROM machine_events" \
 --batch --raw | tr '\t' ',' > machine_events.csv

### Check the Trivy operator

kubectl get pods -n trivy-system

kubectl get vulnerabilityreports -A -o wide

### Trivy scan results

Trivy scans workloads automatically as they are created or updated; no manual
trigger is needed. To see current results:

kubectl get vulnerabilityreports -A -o wide

### Example: reading a Kyverno report

kubectl get polr -A

kubectl get polr -n kube-system | grep cluster-autoscaler

kubectl describe polr <uid> -n kube-system

kubectl describe polr 6d200205-b172-46c8-b8e9-1c92f228ff70 -n kube-system

### Bootstrap the astra AppProject, Traefik and the root Applications

Once ArgoCD itself is running, apply four manifests from the ASTRA_argocd
repo's `bootstrap/` folder. Every file is per environment and already carries
the right `targetRevision`, so there is no `kubectl patch` step and nothing to
edit by hand — just pick the matching set.

They are applied with kubectl rather than Terraform because the
`kubectl_manifest` resource validates at plan time and rejects a manifest whose
CRDs do not exist yet — for example a ClusterPolicy before Kyverno has synced —
which blocked `terraform plan` entirely.

**Check the kube context first.** Nothing in these manifests names a cluster
(they all say `server: https://kubernetes.default.svc`, meaning "the cluster I
am running in"), so they go wherever the active context points. This is a
separate switch from the Terraform backend above — `aws eks update-kubeconfig`
changes it as a side effect, so it can easily be left on the wrong cluster.

kubectl config current-context

Development:

kubectl config use-context arn:aws:eks:us-east-1:255945442255:cluster/astra-eks-development-cluster
BRANCH=develop ENV=development

Production:

kubectl config use-context arn:aws:eks:us-east-1:255945442255:cluster/astra-eks-production-cluster
BRANCH=main ENV=production

Then, in order. First the AppProject every Application references:

kubectl apply -f https://raw.githubusercontent.com/alexongmac/ASTRA_argocd/$BRANCH/bootstrap/astra-project.yaml

Traefik must be installed BEFORE the root apps - the traefik-classed ingresses
in Applications/ fail ArgoCD's server-side-diff comparison if the traefik
IngressClass doesn't exist yet (the AWS LB controller webhook rejects them),
which would deadlock the whole root app. So Traefik is applied standalone here:

kubectl apply -f https://raw.githubusercontent.com/alexongmac/ASTRA_argocd/$BRANCH/bootstrap/traefik-app-$ENV.yaml

Wait for it to settle before continuing:

kubectl get application traefik -n argocd

then the two root app-of-apps. The first syncs the shared `Applications/`
folder, the second the environment's own `Applications/$ENV/` folder, which
the first does not pick up because it sets `recurse: false`:

kubectl apply -f https://raw.githubusercontent.com/alexongmac/ASTRA_argocd/$BRANCH/bootstrap/root-app-$ENV.yaml
kubectl apply -f https://raw.githubusercontent.com/alexongmac/ASTRA_argocd/$BRANCH/bootstrap/root-app-$ENV-env.yaml

If a root app's first sync fails on the missing traefik IngressClass, re-run
that same command once Traefik is synced; its retry policy (limit 5, backoff)
usually recovers on its own anyway.

There used to be a generic `bootstrap/root-app.yaml` (app name `astra-root`,
pinned to `main`) and an `argocd-app-deploy.yaml` in this repo that bundled
three of these manifests into one apply. Both are deleted: the per-environment
files above replace them, and each already carries the right `targetRevision`.

If `kubectl get applications -n argocd` on a cluster still shows a plain
`astra-root`, it was created by that old bundle and is a leftover. It does the
same job as `astra-root-$ENV` but under the wrong name and with no file behind
it, and on a cluster that also runs `astra-root-$ENV` the two reconcile the
same `Applications/` folder with `prune: true` on both. Migrating one off is
not a rename: ArgoCD tracks ownership with an
`argocd.argoproj.io/instance: <app name>` label on every resource, so the
children have to be relabelled to the new app BEFORE the old one is removed,
and the old one must be deleted with `--cascade=orphan` or it takes Kyverno,
Prometheus, Trivy and the RBAC objects with it.

### Confirm ArgoCD has taken over

From here ArgoCD syncs everything in ASTRA_argocd's `Applications/` folder
automatically.

kubectl get applications -n argocd

### Update an Application without pushing to git

Disable self-heal first, apply the change, then trigger a sync. Re-enable
self-heal afterwards, or ArgoCD will revert the change on its next pass.

kubectl patch application <applications> -n argocd --type merge -p '{"spec":{"syncPolicy":{"automated":{"selfHeal":false}}}}'
kubectl apply -f <manifest file>.yaml
kubectl patch application <applications> -n argocd --type merge -p '{"operation":{"sync":{}}}'

### ArgoCD OutofSync

kubectl config current-context
kubectl get app astra-root-development -n argocd -o json

If a child resource is OutOfSync but a sync succeeds and changes nothing, and
the only diff ArgoCD reports is `labels: null`, that is a comparison artifact,
not drift. ArgoCD strips its own `argocd.argoproj.io/instance` tracking label
(named by `application.instanceLabelKey` in `argocd-cm`) from the desired
manifest before diffing. On a resource whose only label is that one, stripping
it leaves an empty map that serialises as `null`, which never equals the live
object's absent key. The fix is to declare any real label in git — the four
child Applications and the ClusterIssuer in `Applications/` carry
`app.kubernetes.io/part-of: astra` for exactly this reason.

### Migrating ArgoCD off Terraform onto the kustomize bootstrap

**Status: prepared, not done.** `ASTRA_argocd/bootstrap/argocd-install/`
holds a working Kustomize setup (upstream `install.yaml` pinned to v3.6.2,
plus patches for the resource limits, `server.insecure` and
`accounts.developer`). It is not yet the live installer.

Why bother: `provider "kubernetes"` and `provider "helm"` in `2-provider.tf`
call `aws eks get-token` against the cluster endpoint at **plan** time, so
`terraform plan` needs a reachable, healthy cluster — exactly what you do not
have when something is broken. A cert-manager CA rotation once failed the
apply with an x509 webhook error, and the production node-group outage blocked
it too. `23-argocd.tf` holds the only real uses of both providers, so removing
it makes Terraform pure AWS-API again. Helm also never upgrades CRDs, so the
v3 CRDs were already being applied by hand; the kustomize path includes them.

**This cannot be done in place.** Applying the kustomization over a
Helm-installed ArgoCD rejects all 7 workloads:

    Deployment.apps "argocd-server" is invalid: spec.selector: Invalid value:
    {"matchLabels":{"app.kubernetes.io/name":"argocd-server"}}: field is immutable

The chart's selector carries `app.kubernetes.io/instance: argocd` as well as
the name label; upstream's carries only the name, and `spec.selector` is
immutable. ConfigMaps, Services, RBAC and NetworkPolicies do apply cleanly, so
a partial attempt leaves a half-owned install.

Do this on a quiet cluster, one environment at a time. ArgoCD being down stops
syncing, not running workloads — pods keep serving throughout.

    # 0. development first. Confirm which cluster you are on.
    kubectl config current-context

    # 1. Record what is live, so you can compare afterwards.
    kubectl get app -n argocd -o name | wc -l        # expect 11 on dev
    kubectl -n argocd get cm argocd-cm -o json | jq '.data | keys | length'

    # 2. Remove the Helm release. Applications are CRs, not Helm-managed, so
    #    they survive - but verify rather than trust this.
    helm uninstall argocd -n argocd
    kubectl get app -n argocd -o name | wc -l        # must still be 11

    # 3. Install from the kustomization.  --server-side is REQUIRED: the
    #    ApplicationSet CRD exceeds the 256KB annotation limit that
    #    client-side apply needs for last-applied-configuration.
    cd ../ASTRA_argocd
    kubectl apply --server-side -k bootstrap/argocd-install/
    kubectl -n argocd rollout status deploy/argocd-server

    # 4. Verify before touching Terraform.
    kubectl get app -n argocd        # 11/11 Synced + Healthy
    kubectl -n argocd get cm argocd-cm -o json | jq '.data | keys | length'
    # expect 10: upstream's 9 + accounts.developer from cm-patch.yaml

    # 5. Only now is argocd-cm safe to drop from
    #    Applications/argocd-rbac.yaml, because the kustomization owns the
    #    complete object. Removing it earlier makes astra-root-ENV's
    #    prune: true delete the whole ConfigMap - see that file's comment.

    # 6. Drop the resources from Terraform state so a later apply or destroy
    #    does not tear down the ArgoCD you just installed. ONE TIME, and per
    #    environment: the backend key differs, so init first.
    cd ../ASTRA
    terraform init -reconfigure -backend-config="key=astra/development.tfstate"
    terraform state rm helm_release.argocd kubernetes_namespace.argocd

    # 7. The gate. If this wants to destroy anything ArgoCD-related, STOP.
    terraform plan -var-file=envs/development.tfvars

    # 8. Delete 23-argocd.tf, and the kubernetes + helm provider blocks and
    #    their required_providers entries in 2-provider.tf. Keep 23-argocd.tf's
    #    closing comment about why the AppProject and root Applications are
    #    applied with kubectl - that reasoning still holds.
    terraform plan -var-file=envs/development.tfvars   # still no destroys

    # 9. Repeat 0-8 for production with its own backend key.

Note `state rm` is one-time migration surgery and deliberately **not** in
`terraform-destroy.yml`. In a destroy it would have the opposite effect —
telling Terraform to forget those resources so it skips them, orphaning the
namespace — and it errors once they are no longer in state.
