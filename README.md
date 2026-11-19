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

### Install ArgoCD

Run from the repo root. The `-upgrade` and `-reconfigure` flags are only needed
on a first run or after the backend changes; a normal `terraform init` is enough
otherwise.

terraform init -upgrade -backend-config="key=astra/development.tfstate" -reconfigure

terraform plan -var-file="envs/development.tfvars" -target="helm_release.argocd"

terraform apply -var-file="envs/development.tfvars" -target="helm_release.argocd"

### Bootstrap the astra AppProject, Traefik and the root Application

Once ArgoCD itself is running, apply these three manifests from the
ASTRA_argocd repo's `bootstrap/` folder. Use the branch matching the cluster:
`develop` for development, `main` for production.

They are applied with kubectl rather than Terraform because the
`kubectl_manifest` resource validates at plan time and rejects a manifest whose
CRDs do not exist yet — for example a ClusterPolicy before Kyverno has synced —
which blocked `terraform plan` entirely.

### Option A: one file (development only)

argocd-app-deploy.yaml bundles astra-project.yaml, traefik-app.yaml, and
root-app.yaml into a single multi-document manifest, with targetRevision
already set to `develop` so the separate `kubectl patch` below isn't needed:

kubectl apply -f argocd-app-deploy.yaml

kubectl applies all three documents immediately but doesn't wait for Traefik
to finish syncing before root-app's comparison runs - if that first sync
fails on the missing traefik IngressClass, just re-run the same command once
Traefik is synced (`kubectl get application traefik -n argocd`); astra-root's
retry policy (limit 5, backoff) usually recovers on its own anyway. For
production, don't use this file (it's pinned to `develop`) - use Option B.

### Option B: step by step (any environment)

the AppProject every Application references:

kubectl apply -f https://raw.githubusercontent.com/alexongmac/ASTRA_argocd/develop/bootstrap/astra-project.yaml

Traefik must be installed BEFORE the root app - the traefik-classed ingresses
in Applications/ fail ArgoCD's server-side-diff comparison if the traefik
IngressClass doesn't exist yet (the AWS LB controller webhook rejects them),
which would deadlock the whole root app. So Traefik is applied standalone here:

kubectl apply -f https://raw.githubusercontent.com/alexongmac/ASTRA_argocd/develop/bootstrap/traefik-app.yaml

then the root app-of-apps that syncs everything in Applications/:

kubectl apply -f https://raw.githubusercontent.com/alexongmac/ASTRA_argocd/develop/bootstrap/root-app.yaml

### Point root-app at the right branch

**Important:** `root-app.yaml` ships with `targetRevision: main`. On the
development cluster it must be changed to `develop`, or the app-of-apps tracks
the wrong branch.

kubectl patch application astra-root -n argocd --type merge -p '{"spec":{"source":{"targetRevision":"develop"}}}'

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
