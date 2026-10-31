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

helm repo update

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
  --create-namespace \
  -f loki-values.yaml \
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
### since they're what blocked  (NLB, ENIs, target groups)
helm uninstall ingress-nginx -n ingress-nginx
helm uninstall kube-prometheus-stack -n monitoring
helm uninstall loki -n monitoring
helm uninstall cluster-autoscaler -n kube-system
helm uninstall aws-load-balancer-controller -n kube-system
