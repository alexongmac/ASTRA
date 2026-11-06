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

helm upgrade --install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
    --namespace monitoring \
    --create-namespace \
    --set prometheus.prometheusSpec.resources.requests.cpu=100m \
    --set prometheus.prometheusSpec.resources.requests.memory=256Mi \
    --set prometheus.prometheusSpec.resources.limits.cpu=500m \
    --set prometheus.prometheusSpec.resources.limits.memory=512Mi \
    --set prometheus.prometheusSpec.retention=6h \
    --set alertmanager.alertmanagerSpec.resources.requests.cpu=25m \
    --set alertmanager.alertmanagerSpec.resources.requests.memory=64Mi \
    --set alertmanager.alertmanagerSpec.resources.limits.cpu=100m \
    --set alertmanager.alertmanagerSpec.resources.limits.memory=128Mi \
    --set grafana.resources.requests.cpu=50m \
    --set grafana.resources.requests.memory=256Mi \
    --set grafana.resources.limits.cpu=200m \
    --set grafana.resources.limits.memory=512Mi \
    --set kubeControllerManager.enabled=true \
    --set kubeScheduler.enabled=true \
    --set kubeEtcd.enabled=true \
    --set kubeProxy.enabled=true \
    --wait --timeout 600s

### some of the aws eks command:

- aws eks update-kubeconfig --region us-east-1 --name astra-eks-development-cluster --profile <username>

- aws eks describe-cluster --name astra-eks-development-cluster --output json

- kubectl api-resources

- kubectl cluster-info dump

### ArgoCD Installation

kubectl create namespace argocd
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

helm upgrade --install loki grafana/loki \
  --version 7.5.0 \
  --namespace monitoring \
  --create-namespace \
  -f loki-values.yaml \
  --wait --timeout 600s

====================================

### Check ArgoCD is installed

❯ kubectl get pods,svc,secrets -n argocd

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
