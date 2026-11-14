#!/usr/bin/env bash
# Generic evaluation installer; requires an explicitly selected Kubernetes context.
set -Eeuo pipefail
umask 077

usage() {
  printf 'Usage: bash %s --context CONTEXT [--namespace sync-store-example]\n' "$0"
}
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }
context=''
namespace=sync-store-example
while (($#)); do
  case "$1" in
    --context|--namespace)
      (($# >= 2)) || { usage >&2; exit 2; }
      case "$1" in
        --context) context=$2 ;;
        --namespace) namespace=$2 ;;
      esac
      shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done
[[ -n "$context" ]] || die 'Pass --context explicitly; use a disposable evaluation cluster.'
[[ ${#namespace} -le 63 && "$namespace" =~ ^[a-z0-9]([-a-z0-9]*[a-z0-9])?$ ]] || die 'Invalid namespace.'
for tool in kubectl helm openssl; do
  command -v "$tool" >/dev/null || die "Required command not found: $tool"
done
example_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
chart_dir=$(cd -- "$example_dir/../.." && pwd)
kube=(kubectl --context "$context" --namespace "$namespace")
scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT
trap 'printf "Installation failed; inspect Pods, events and the migration Job in the selected namespace.\n" >&2' ERR

kubectl --context "$context" cluster-info >/dev/null
kubectl --context "$context" create namespace "$namespace" --dry-run=client -o yaml |
  kubectl --context "$context" apply -f -

# Treat credentials as persistent state. Never rotate them on a rerun.
database_secret=$("${kube[@]}" get secret sync-store-example-databases --ignore-not-found -o name)
app_secret=$("${kube[@]}" get secret sync-store-example --ignore-not-found -o name)
if [[ -z "$database_secret" && -z "$app_secret" ]]; then
  claims=$("${kube[@]}" get pvc -o name)
  [[ -z "$claims" ]] || die 'PVCs already exist without example credentials. Restore the original Secrets or use a fresh namespace.'
  mongo_password=$(openssl rand -hex 32)
  redis_password=$(openssl rand -hex 32)
  printf 'MONGODB_PASSWORD=%s\nREDIS_PASSWORD=%s\n' "$mongo_password" "$redis_password" > "$scratch/databases.env"
  {
    printf 'DATABASE_URL=mongodb://example-admin:%s@sync-store-mongodb:27017/syncstore?authSource=admin&replicaSet=rs0\n' "$mongo_password"
    printf 'REDIS_URL=redis://:%s@sync-store-redis:6379\n' "$redis_password"
    printf 'JWT_SECRET=%s\n' "$(openssl rand -hex 32)"
    printf 'CSRF_SECRET=%s\n' "$(openssl rand -hex 32)"
  } > "$scratch/app.env"
  "${kube[@]}" create secret generic sync-store-example-databases --from-env-file="$scratch/databases.env"
  "${kube[@]}" create secret generic sync-store-example --from-env-file="$scratch/app.env"
elif [[ -z "$database_secret" || -z "$app_secret" ]]; then
  die 'Only one example Secret exists. Restore the matching Secret before retrying; credentials were not changed.'
fi
for key in MONGODB_PASSWORD REDIS_PASSWORD; do
  [[ -n "$("${kube[@]}" get secret sync-store-example-databases -o "jsonpath={.data.$key}")" ]] || die "Database Secret is missing $key"
done
for key in DATABASE_URL REDIS_URL JWT_SECRET CSRF_SECRET; do
  [[ -n "$("${kube[@]}" get secret sync-store-example -o "jsonpath={.data.$key}")" ]] || die "Application Secret is missing $key"
done

"${kube[@]}" apply -f "$example_dir/dependencies.yaml"
"${kube[@]}" rollout status statefulset/sync-store-mongodb --timeout=5m
"${kube[@]}" rollout status statefulset/sync-store-redis --timeout=5m
# Databases must be ready before the chart's pre-install migration hook starts.
helm upgrade --install sync-store "$chart_dir" --kube-context "$context" \
  --namespace "$namespace" --values "$example_dir/values.yaml" --wait --timeout 12m
helm test sync-store --kube-context "$context" --namespace "$namespace" --timeout 2m
printf '\nOpen http://localhost:3000/dashboard/ after running:\n'
printf 'kubectl --context %q --namespace %q port-forward service/sync-store 3000:80\n' "$context" "$namespace"
printf '\nFind the initial setup code (keep it private):\n'
printf 'kubectl --context %q --namespace %q logs deployment/sync-store\n' "$context" "$namespace"
