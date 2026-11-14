# Complete Kubernetes evaluation example

This example is portable and uses only public images and generic resource names.
It is a starting point for learning and testing, not a production database design.

## What is included

| Component | Configuration |
| --- | --- |
| Sync Store | Helm chart, one replica, automatic migration, HTTP smoke test |
| MongoDB | Official `mongo:8.0` image, authenticated single-member `rs0` replica set, 2Gi PVC |
| Redis | Official `redis:8-alpine` image, password authentication, AOF with `appendfsync always`, 1Gi PVC |
| Credentials | Random MongoDB/Redis passwords, JWT and CSRF secrets in Kubernetes Secrets |
| Access | Cluster-internal Services and local port-forward; no public ingress |

Application, MongoDB and Redis requests total **250m CPU and 576Mi memory**.
The migration temporarily adds **100m CPU and 256Mi memory**; the Helm test adds
**50m CPU and 64Mi memory**. These are scheduling requests, not measured usage.
Allow additional capacity for Kubernetes, filesystem cache and image downloads.
The dependency PVCs use the cluster's default StorageClass. Edit their
`storageClassName` and sizes in a private copy if your cluster requires them.

## Install

Install Docker, kind, kubectl, Helm 3.17+, Bash and OpenSSL for a local demo.
Alternatively use an existing evaluation cluster with dynamic volume provisioning.
Run from a cloned repository:

```sh
kind create cluster --name sync-store-demo
bash charts/sync-store/examples/quickstart/install.sh --context kind-sync-store-demo
```

The context argument is required so the installer cannot silently target your
current cluster. Use `--namespace another-example` to change the namespace.
The script works from any directory, including an unpacked Helm chart archive.

The installer creates the namespace and Secrets, starts databases, waits for the
MongoDB primary and Redis, then runs `helm upgrade --install` and `helm test`.
The ordering matters: the chart's **pre-install migration hook** requires both
the database and Secret before normal Helm release resources are created.
The database manifests are therefore applied separately from the chart.

Run the printed port-forward command and open `http://localhost:3000/dashboard/`:

```sh
kubectl --context kind-sync-store-demo --namespace sync-store-example \
  port-forward service/sync-store 3000:80
```

Find the setup code in the logs, complete setup, and store the administrator key
securely. Do not paste setup codes, administrator keys or Secret dumps into issues:

```sh
kubectl --context kind-sync-store-demo --namespace sync-store-example \
  logs deployment/sync-store
```

Create a dedicated application API key for REST, SDK or WebSocket clients.
Optional Keycloak/OIDC configuration controls dashboard administrator login;
application clients continue using API keys. See the [chart guide](../../README.md).

## Rerun and troubleshoot

Rerunning the installer reuses both Secrets and PVCs. It does not rotate
credentials or reset data. If only one Secret remains, restore the matching
original Secret before retrying. If PVCs exist without Secrets, restore the
credentials from backup or start in a fresh namespace. Do not generate new
database passwords over existing database files.

```sh
kubectl --context kind-sync-store-demo --namespace sync-store-example get pods,pvc
kubectl --context kind-sync-store-demo --namespace sync-store-example \
  get events --sort-by=.lastTimestamp
kubectl --context kind-sync-store-demo --namespace sync-store-example \
  logs statefulset/sync-store-mongodb
kubectl --context kind-sync-store-demo --namespace sync-store-example \
  logs job/sync-store-migrate
```

Pending PVCs usually mean a missing/default StorageClass or unavailable storage.
ImagePullBackOff requires registry/network access (and image pull credentials if
you adapt the example to a private registry). A failed migration blocks the
application install; inspect its Job before rerunning. The MongoDB replica set's
internal key stays on its PVC. Its headless Service publishes not-ready addresses
so the first member can resolve its own hostname during replica-set initiation.

## Adapt for a public service

Use the [production values example](../../ci/production-values.yaml) and
[Secret template](../secret.example.yaml) with your own external databases,
hostname, TLS Secret, ingress controller and OIDC settings. MongoDB in this demo
uses a root account and a single member; Redis is also a single instance. For
production, use least-privilege database accounts, HA, TLS between services,
backups with tested restoration, network policies and monitored capacity.
Pin tested image digests for reproducible releases. The database image tags here
follow their maintenance series and are not upgraded by the application chart.

## Remove the example

Uninstalling the application keeps the separately managed databases and PVCs:

```sh
helm uninstall sync-store --kube-context kind-sync-store-demo --namespace sync-store-example
```

To permanently delete **all example data and credentials**, delete its namespace
(check your StorageClass reclaim policy), or delete the disposable kind cluster:

```sh
kubectl --context kind-sync-store-demo delete namespace sync-store-example
# For the disposable local cluster only:
kind delete cluster --name sync-store-demo
```
