# Sync Store Helm chart

This chart installs the Sync Store API, dashboard and WebSocket server from the
published `alimaster/sync-store` image. Chart `0.3.0` defaults to application
`1.2.0`. It creates a Deployment, Service, migration Job and optional Ingress and
PodDisruptionBudget. MongoDB, Redis, TLS certificates and credentials are managed
outside this chart.

All files in this directory are public, provider-independent examples. They do
not describe any particular organization's infrastructure. Keep real values,
credentials and deployment overlays in a private repository or secret manager.

## Quick start: complete evaluation stack

For a first installation, use the [complete example](examples/quickstart/README.md).
It provisions a single-node MongoDB replica set, authenticated Redis with AOF,
persistent volumes, random credentials and the application, then runs a Helm
HTTP test. No database service or credentials need to be prepared manually.

Requirements: Kubernetes 1.25+, Helm 3.17+, `kubectl`, Bash, OpenSSL, a default
StorageClass with dynamic provisioning, and access to the public container
images. A local kind cluster with Docker is one option:

```sh
git clone https://github.com/ali-master/sync-store.git
cd sync-store
kind create cluster --name sync-store-demo
bash charts/sync-store/examples/quickstart/install.sh --context kind-sync-store-demo
kubectl --context kind-sync-store-demo --namespace sync-store-example \
  port-forward service/sync-store 3000:80
```

Open `http://localhost:3000/dashboard/`, obtain the setup code from the application
logs, and create the first administrator. Use a disposable cluster for this
evaluation example. It has no public ingress, TLS, database HA or backup system.
For managed databases and a public service, follow the installation below.

## Prerequisites

- Kubernetes 1.25 or newer and Helm 3.17 or newer.
- A reachable MongoDB replica set. A standalone MongoDB server does not support
  the transactions used by Sync Store. The migration account needs `readWrite`
  and `dbAdmin` on the application database for schema changes such as
  `collMod`. Back up the database before upgrades.
- A pre-created Secret in the release namespace with `DATABASE_URL`,
  `JWT_SECRET` and `CSRF_SECRET`. Use stable, randomly generated secrets;
  `CSRF_SECRET` must contain at least 32 characters.
- For multiple replicas, shared Redis 7.2 or newer with AOF enabled and permission
  to execute `WAITAOF`. Set `REDIS_URL` in the same Secret. Configure backups and
  persistence for the external databases according to your durability needs.
- For public access, an ingress controller, DNS and an existing TLS Secret.
  Permit outbound connections to MongoDB, Redis and the OIDC provider as needed.

## Install

Clone the repository and run commands from its root:

```sh
git clone https://github.com/ali-master/sync-store.git
cd sync-store
kubectl create namespace sync-store
```

Prepare a local environment file containing the required Secret keys using your
secret manager. Keep it outside this checkout, restrict its permissions, and
never add it to Git. Optional keys include `REDIS_URL`, `SSO_CLIENT_SECRET` and
`METRICS_TOKEN`. Create the Secret before running Helm, because the pre-install
migration Job reads it before normal release resources are created:

```sh
kubectl --namespace sync-store create secret generic sync-store-secrets \
  --from-env-file=/secure/path/sync-store.env
```

For a local first installation:

```sh
helm upgrade --install sync-store ./charts/sync-store \
  --namespace sync-store \
  --set existingSecret=sync-store-secrets \
  --wait --timeout 12m

helm test sync-store --namespace sync-store --timeout 2m

kubectl --namespace sync-store port-forward \
  service/sync-store-sync-store 3000:80
```

Open `http://localhost:3000/dashboard/`. Find the setup code in the application
logs, complete first-time setup, and securely save the administrator API key:

```sh
kubectl --namespace sync-store logs deployment/sync-store-sync-store
```

The default `API_URL` is suitable for this port-forward example. Set it to the
public API URL, including `/api`, before exposing the service publicly. Existing
database data and setup state are reused on upgrades; the chart does not reset
the database.

## Production values

Copy [ci/production-values.yaml](ci/production-values.yaml) to a private values
file and replace the example hostnames, ingress class, Secret names and email
allowlist. It demonstrates two replicas, shared TLS ingress, dashboard SSO and a
disruption budget. Create the database/Redis credentials and TLS Secret before
installation. The example requires `REDIS_URL` in `sync-store-production`.
This is an example to adapt and review, not a complete production environment.
The [Secret template](examples/secret.example.yaml) documents required keys;
replace every placeholder locally and never commit the filled-in file.

```sh
helm upgrade --install sync-store ./charts/sync-store \
  --namespace sync-store --create-namespace \
  --values /secure/path/production-values.yaml \
  --wait --timeout 12m
```

Forward `/`, `/api` and WebSocket traffic to the same Service. Configure the
controller to support WebSocket upgrades and long-lived connections. Expose
only HTTPS in production, set `CORS_ALLOWED_ORIGINS` to the actual client
origins, and review the application's proxy/header trust settings for your
network. The example's timeout annotations apply to an NGINX ingress controller;
other controllers need their own configuration.

## Keycloak dashboard login

Sync Store includes native OIDC login for dashboard administrators. Complete the
initial administrator setup first; SSO requires an active administrator key.
Create a Keycloak client with the authorization-code flow and PKCE S256. Use the
exact callback URI `https://sync.example.com/api/v1/sso/callback`, replacing the
hostname. Configure these non-secret settings in `env`:

```yaml
env:
  API_URL: "https://sync.example.com/api"
  SSO_ISSUER: "https://identity.example.com/realms/example"
  SSO_CLIENT_ID: "sync-store-dashboard"
  SSO_REDIRECT_URI: "https://sync.example.com/api/v1/sso/callback"
  SSO_PROVIDER_NAME: "Keycloak"
  SSO_ALLOWED_EMAILS: "admin@example.com"
```

For a confidential client, put `SSO_CLIENT_SECRET` in `existingSecret`. A public
client can use PKCE without a client secret. The default scopes are
`openid email profile`. Keycloak must return a verified email that matches the
allowlist; allowed users receive administrator access. Use an explicit email
allowlist unless a whole-domain allowlist is intentional. SSO settings saved in
the dashboard/database can override environment settings.

REST, SDK and WebSocket applications continue to authenticate with Sync Store
API keys. Keep those application routes accessible with their native
authentication when configuring ingress or any external authentication proxy.

## Values and resources

See [values.yaml](values.yaml) for all defaults and comments. Common settings:

| Value | Default | Purpose |
| --- | --- | --- |
| `replicaCount` | `1` | Application replicas; multiple replicas require shared Redis |
| `image.repository` | `alimaster/sync-store` | Application and migration image |
| `image.tag` | chart `appVersion` | Image version override |
| `image.digest` | empty | Optional SHA-256 digest; overrides the tag |
| `existingSecret` | `sync-store-secrets` | Pre-created environment Secret |
| `env.API_URL` | `http://localhost:3000/api` | Externally reachable API URL |
| `extraEnv` | `[]` | Additional Kubernetes environment/valueFrom entries |
| `service.port` | `80` | Service port; container port is fixed at `3000` |
| `ingress.enabled` | `false` | Optional ingress using existing TLS Secrets |
| `migration.enabled` | `true` | Run migrations before install and upgrade |
| `migration.activeDeadlineSeconds` | `600` | Migration Job time limit |
| `strategy.type` | `Recreate` | Single-replica upgrades have brief downtime |
| `podDisruptionBudget.enabled` | `false` | Optional voluntary-disruption protection |

The application requests **100m CPU and 256Mi memory** per replica, with limits
of **1 CPU and 768Mi memory**. The migration Job has the same independent budget
while it runs. On upgrades the Job can overlap with existing application Pods;
rolling updates can also add a surge Pod. These are starting budgets, not
measured capacity guarantees. MongoDB and Redis consume additional resources
outside this chart. Measure workload, connection counts and migration size
before adjusting limits or scaling.

Pods run as non-root user/group `1000`, drop Linux capabilities and do not mount
a Kubernetes API token. `PORT` and `NODE_ENV` are reserved by the chart. Put
credentials in the Secret, not `env` or a committed values file; Helm stores
release values in cluster release metadata. After changing Secret contents,
restart the Deployment so environment variables are reloaded:

```sh
kubectl --namespace sync-store rollout restart deployment/sync-store-sync-store
kubectl --namespace sync-store rollout status deployment/sync-store-sync-store
```

## Migrations, upgrades and rollback

The pre-install/pre-upgrade hook runs `bun run db:deploy` once using the same
image, environment, scheduling settings and security context as the application.
Successful Jobs are removed. Failed Jobs remain for inspection until the next
attempt. A failed hook blocks the release before application resources update.
Set `migration.enabled=false` only when a separate process has already applied
the required migrations. Serialize upgrades against the same database.

Use backward-compatible migrations when old Pods remain live during an upgrade.
Increase the Helm timeout and migration deadline together for larger databases.
To inspect a failed migration:

```sh
kubectl --namespace sync-store logs job/sync-store-sync-store-migrate
kubectl --namespace sync-store describe job/sync-store-sync-store-migrate
```

Review the target image version and database backup, then use the installation
command with your maintained values file for each upgrade. A Helm rollback
restores application resources, **not database schema or data**. Confirm schema
compatibility before rolling back; restore a database backup when necessary.
The readiness/startup endpoint checks HTTP availability, not complete database
health. After installation, verify dashboard login and an authenticated API
write/read using a dedicated test application key.
`helm test` verifies that the Service reaches the application's setup endpoint;
it does not exercise SSO, WebSockets or authenticated data operations.

## Validate and package

```sh
helm lint charts/sync-store --strict
helm lint charts/sync-store --strict \
  --values charts/sync-store/ci/production-values.yaml
helm lint charts/sync-store --strict \
  --values charts/sync-store/examples/quickstart/values.yaml
helm template sync-store charts/sync-store --namespace sync-store
helm template sync-store charts/sync-store --namespace sync-store \
  --values charts/sync-store/ci/production-values.yaml
helm package charts/sync-store --destination /tmp/sync-store-chart
```

The `Helm chart` GitHub Actions workflow lints, renders and packages chart
changes. Its downloadable artifact contains `sync-store-0.3.0.tgz`. This
validation workflow does not install the chart or change a running release.
The chart is distributed from this repository; no Helm repository or OCI
registry is required for a local-path installation.
See [the CI/CD example](https://github.com/ali-master/sync-store/blob/master/docs/cicd-deployment.md) for image builds,
private release values, deployment, verification and rollback.
