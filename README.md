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

### Helm Installation

Once the EKS is launch, here's the steps as follows:

- aws eks update-kubeconfig --region us-east-1 --name astra-eks-development-cluster
- kubectl create namespace astra-eks

follow by the installation of helm chart accordingly: copy and paste each helm repo to terminal and "enter"

helm repo add eks https://aws.github.io/eks-charts

helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx

helm repo add prometheus-community https://prometheus-community.github.io/helm-charts

helm repo add grafana https://grafana.github.io/helm-charts

helm repo add autoscaler https://kubernetes.github.io/autoscaler

helm repo add kyverno https://kyverno.github.io/kyverno/

helm repo add aqua https://aquasecurity.github.io/helm-charts/

helm repo add aqua https://aquasecurity.github.io/helm-charts/

helm repo update

====================================

helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx \
 --namespace ingress-nginx \
 --create-namespace \
 --set controller.replicaCount=2 \
 --set controller.resources.requests.cpu=50m \
 --set controller.resources.requests.memory=90Mi \
 --set controller.resources.limits.cpu=200m \
 --set controller.resources.limits.memory=180Mi \
 --set controller.service.type=LoadBalancer \
 --set controller.service.annotations."service\.beta\.kubernetes\.io/aws-load-balancer-type"=nlb \
 --set controller.service.annotations."service\.beta\.kubernetes\.io/aws-load-balancer-scheme"=internet-facing \
 --set controller.service.annotations."service\.beta\.kubernetes\.io/aws-load-balancer-nlb-target-type"=ip \
 --wait --timeout 600s

====================================

VPC_ID=$(aws eks describe-cluster --name astra-eks-development-cluster --region us-east-1 \
 --query 'cluster.resourcesVpcConfig.vpcId' --output text)

helm upgrade --install aws-load-balancer-controller eks/aws-load-balancer-controller \
 --namespace kube-system \
 --set clusterName=astra-eks-development-cluster \
 --set region=us-east-1 \
 --set vpcId="$VPC_ID" \
 --set serviceAccount.create=true \
 --set serviceAccount.name=aws-load-balancer-controller \
 --set resources.requests.cpu=50m \
 --set resources.requests.memory=100Mi \
 --set resources.limits.cpu=200m \
 --set resources.limits.memory=200Mi \
 --wait --timeout 600s

====================================

helm upgrade --install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
 --namespace monitoring \
 --set grafana.sidecar.resources.requests.cpu=20m \
 --set grafana.sidecar.resources.requests.memory=32Mi \
 --set grafana.sidecar.resources.limits.cpu=100m \
 --set grafana.sidecar.resources.limits.memory=64Mi \
 --reuse-values \
 --wait --timeout 300s 2>&1 | tail -15

====================================

helm upgrade --install cluster-autoscaler autoscaler/cluster-autoscaler \
 --namespace kube-system \
 --set autoDiscovery.clusterName=astra-eks-development-cluster \
 --set awsRegion=us-east-1 \
 --set rbac.serviceAccount.create=true \
 --set rbac.serviceAccount.name=cluster-autoscaler \
 --set resources.requests.cpu=25m \
 --set resources.requests.memory=64Mi \
 --set resources.limits.cpu=100m \
 --set resources.limits.memory=128Mi \
 --set extraArgs.balance-similar-node-groups=true \
 --set extraArgs.skip-nodes-with-system-pods=false \
 --wait --timeout 300s

====================================

helm upgrade --install loki grafana/loki \
 --version 7.5.0 \
 --namespace monitoring \
 -f loki-values.yaml \
 --wait --timeout 600s 2>&1 | tail -20

====================================

helm upgrade --install kyverno kyverno/kyverno \
 --namespace kyverno \
 --set admissionController.resources.requests.cpu=50m \
 --set admissionController.resources.requests.memory=128Mi \
 --set admissionController.resources.limits.cpu=200m \
 --set admissionController.resources.limits.memory=256Mi \
 --set backgroundController.resources.requests.cpu=30m \
 --set backgroundController.resources.requests.memory=64Mi \
 --set backgroundController.resources.limits.cpu=150m \
 --set backgroundController.resources.limits.memory=192Mi \
 --set cleanupController.resources.requests.cpu=20m \
 --set cleanupController.resources.requests.memory=64Mi \
 --set cleanupController.resources.limits.cpu=100m \
 --set cleanupController.resources.limits.memory=128Mi \
 --set reportsController.resources.requests.cpu=30m \
 --set reportsController.resources.requests.memory=64Mi \
 --set reportsController.resources.limits.cpu=150m \
 --set reportsController.resources.limits.memory=192Mi \
 --wait --timeout 300s

====================================

### Kyverno policy: require-resource-limits (audit mode)

kubectl apply -f kyverno-require-resource-limits.yaml

Audits every Pod for missing CPU/memory limits (validationFailureAction: Audit, so nothing is blocked - just reported). Check results:

kubectl get polr -A
kubectl get polr -A --no-headers | awk '{fail[$1]+=$6; total[$1]++} END {for (ns in fail) print ns, "fail="fail[ns], "resources="total[ns]}' | sort -k2 -t= -rn

### Fixing resource-limit failures per install method

Most of this cluster's workloads come from one of three install paths, and each needs a different fix for missing CPU/memory limits:

1. **Helm charts** (kyverno, kube-prometheus-stack, loki) - set via `--set resources...` on `helm upgrade --install`, same pattern as the install commands above. Also check for sidecar containers with their own `resources` key (e.g. `kiwigrid/k8s-sidecar` in both Loki's `sidecar.resources` and Grafana's `grafana.sidecar.resources` - defaults to `{}` upstream, not inherited from the main container).

2. **EKS-managed addons** (cert-manager, external-dns, in 13-addons.tf) - not Helm, so `--set` doesn't apply. Use the `aws_eks_addon` resource's `configuration_values` field instead (JSON-encoded, schema discoverable via `aws eks describe-addon-configuration --addon-name <name> --addon-version <version>`). coredns/kube-proxy/aws-node/ebs-csi/eks-pod-identity-agent are also EKS addons but don't expose a `resources` key in their configuration schema - left unaddressed for now, since overriding them isn't straightforward and they're AWS-managed system components, not app-layer workloads.

3. **Raw manifests** (ArgoCD, installed via `kubectl apply -f https://raw.githubusercontent.com/argoproj/argo-cd/...`) - no values file at all. Patch the live Deployments/StatefulSet directly with `kubectl patch --type strategic` (NOT `kubectl apply` - a partial manifest gets treated as the full desired state and nulls out `spec.selector`/images/etc., which errors on immutable fields). See argocd-resource-limits.yaml for the exact values and patch commands.

Watch for init containers reported separately from the main container (e.g. ArgoCD's `argocd-redis` has an `secret-init` init container, `argocd-dex-server` has a `copyutil` init container) - each needs its own `resources` entry.

====================================

helm upgrade --install trivy-operator aqua/trivy-operator \
 --namespace trivy-system \
 --create-namespace \
 --set="trivy.ignoreUnfixed=true" \
 --wait --timeout 600s

====================================

### Get Grafana 'admin' user password by running:

kubectl --namespace monitoring get secrets kube-prometheus-stack-grafana -o jsonpath="{.data.admin-password}" | base64 -d ; echo

### Then launch 3 values yaml file for CA to be assigned to the domain . Wait for 5 mins before launching https://astra-prom.sctp-sandbox.com and https://astra-grafana.sctp-sandbox.com

kubectl apply -f clusterissuer.yaml -f grafana-ingress.yaml -f prometheus-ingress.yaml -f alertmanager-ingress.yaml

====================================

### Register Loki as a Grafana datasource (kube-prometheus-stack's Grafana doesn't auto-detect the separate Loki Helm release)

kubectl apply -f loki-datasource.yaml

====================================

### Apply custom RBAC roles (developer, sre) for teammates mapped via kubernetes_groups in terraform.tfvars

kubectl apply -f rbac.yaml

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

### Uninstall in reverse dependency order — ingress/LB stuff first, before Terraform Destroy

### since they're what blocked (NLB, ENIs, target groups)

helm uninstall ingress-nginx -n ingress-nginx
helm uninstall kube-prometheus-stack -n monitoring
helm uninstall loki -n monitoring
helm uninstall cluster-autoscaler -n kube-system
helm uninstall aws-load-balancer-controller -n kube-system

### ArgoCD Installation

kubectl create namespace argocd
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

### Check ArgoCD is installed

❯ k get pods,svc,secrets -n argocd

### To interact with ArgoCD, Install argocd cli

brew install argocd

or refer to documentation

https://argo-cd.readthedocs.io/en/stable/cli_installation/

### to get the secrets

kubectl get secret -n argocd

kubectl get secret argocd-initial-admin-secret -n argocd -o jsonpath="{.data.password}" | base64 --decode

kubectl port-forward svc/argocd-server -n argocd 8080:443

open a Browser and type

### Use this command to access ArgoCD on your local machine on port 8080

kubectl get svc -n argocd
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
