### Notes

### one-time setup, after provider.tf changes

- terraform init -reconfigure

### day to day

- terraform init -backend-config="key=astra/development.tfstate"
- terraform init -backend-config="key=astra/development.tfstate"

- terraform apply -var-file=envs/development.tfvars
- terraform apply -var-file=envs/production.tfvars

### State files will land at s3 bucket:

- astra-env/dev/astra/terraform.tfstate
- astra-env/prod/astra/terraform.tfstate

### Terraform Destroy

please take note of the git branch must be in "develop"

terraform destroy -auto-approve -var-file="envs/development.tfvars

### Kyverno policy:

kubectl get polr -A
kubectl get polr -A --no-headers | awk '{fail[$1]+=$6; total[$1]++} END {for (ns in fail) print ns, "fail="fail[ns], "resources="total[ns]}' | sort -k2 -t= -rn

### Get Grafana 'admin' user password by running:

kubectl --namespace monitoring get secrets kube-prometheus-stack-grafana -o jsonpath="{.data.admin-password}" | base64 -d ; echo

helm repo add prometheus-community https://prometheus-community.github.io/helm-charts

### CloudWatch for audit logging who did what, when, via the K8s API

1. Go to CloudWatch -> Log groups

2. Find /aws/eks/astra-eks-development-cluster/cluster (or -production-)

3. Inside it you'll see separate log streams per log type: kube-apiserver-audit-..., kube-apiserver-... (since you enabled api and audit)

4. Click a stream to view entries, or use Logs Insights to run queries across all streams in the group

### via AWS CLI

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

### some of the aws eks command:

- aws eks update-kubeconfig --region us-east-1 --name astra-eks-development-cluster --profile <username>

- aws eks describe-cluster --name astra-eks-development-cluster --output json

- kubectl api-resources

- kubectl cluster-info dump

### ArgoCD Installation

kubectl create namespace argocd
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

### Check ArgoCD is installed

kubectl get pods,svc,secrets -n argocd

### to get the secrets

kubectl get secret -n argocd

kubectl get secret argocd-initial-admin-secret -n argocd -o jsonpath="{.data.password}" | base64 --decode

### Use this command to access ArgoCD UI on your local machine on port 8080

❯ kubectl get svc -n argocd
kubectl port-forward svc/argocd-server -n argocd 8080:443
open browser type: localhost:8080/

### Enter argoCD Username and password

Username: admin
password : xxxxxxxxxxx

### To access the RDS via EKS internal subnet

kubectl apply -f rds-access.yaml
kubectl wait --for=condition=Ready pod/rds-access --timeout=60s
kubectl exec -it rds-access -- mysql \
 -h astra-mysql-db.chheppac9ozc.us-east-1.rds.amazonaws.com \
 -P 3306 -u dbadmin -p astradb -e "SHOW TABLES;"

enter the password from Secrets Manager

### access the RDS by port forwarding

create a relay pod...

kubectl apply -f rds-proxy.yaml
kubectl wait --for=condition=Ready pod/rds-proxy --timeout=60s
kubectl port-forward pod/rds-proxy 3306:3306

Connect via Workbench to 127.0.0.1:3306, user dbadmin, schema astradb, password from Secrets Manager.

when done, clean up

kubectl delete -f rds-access.yaml
kubectl delete -f rds-proxy.yaml

### To dump SQL database

kubectl exec rds-access -- mysqldump \
 -h astra-mysql-db.chheppac9ozc.us-east-1.rds.amazonaws.com \
 -P 3306 -u dbadmin -p'your secrets password' \
 --single-transaction --skip-lock-tables \
 --column-statistics=0 \
 --databases astradb > astradb_dump.sql

### To get database table to csv

kubectl exec rds-access -- mysql \
 -h astra-mysql-db.chheppac9ozc.us-east-1.rds.amazonaws.com \
 -P 3306 -u dbadmin -p'your secrets password' astradb \
 -e "SELECT \* FROM machine_events" \
 --batch --raw | tr '\t' ',' > machine_events.csv

### Check Trivy operator pod status

kubectl get pods -n trivy-system

### Running and healthy. It automatically scans workloads as they're created/updated — no manual trigger needed for that. To see its actual scan results right now:

kubectl get vulnerabilityreports -A -o wide

### here's an example how you get report from kyverno

kubectl get polr -A

kubectl get polr -n kube-system | grep cluster-autoscaler

kubectl describe polr <uid> -n kube-system

kubectl describe polr 6d200205-b172-46c8-b8e9-1c92f228ff70 -n kube-system

### to start argocd, we need to follow:

terraform init -upgrade -backend-config="key=astra/development.tfstate" -reconfigure

terraform plan -var-file="envs/development.tfvars" -target="helm_release.argocd"

terraform apply -var-file="envs/development.tfvars" -target="helm_release.argocd"

### once ArgoCD itself is running, bootstrap the astra AppProject, Traefik, and the root Application

these come from ASTRA_argocd's bootstrap/ folder and are applied directly via
kubectl, not Terraform - kubectl_manifest's plan-time validation rejects a
manifest if any CRD it references doesn't exist yet (e.g. a ClusterPolicy
before Kyverno has synced), which blocked `terraform plan` entirely. Use
the branch matching the cluster: `develop` for development, `main` for production.

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

### IMPORTANT: root-app.yaml ships with targetRevision: main. On the development cluster, change it to develop or the app-of-apps tracks the wrong branch:

kubectl patch application astra-root -n argocd --type merge -p '{"spec":{"source":{"targetRevision":"develop"}}}'

### once applied, ArgoCD takes over syncing everything in ASTRA_argocd's Applications/ folder automatically

kubectl get applications -n argocd
