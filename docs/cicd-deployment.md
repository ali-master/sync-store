# CI/CD and Kubernetes deployment example

This guide describes a generic release process for self-hosting Sync Store.
All hostnames, paths and names are examples. Choose your own registry, CI runner,
Kubernetes provider and secret manager. Keep actual environment values and
credentials private; this repository does not contain a site's deployment state.

## Try the complete example first

The [Helm chart](../charts/sync-store/README.md) contains a
[quick-start installer](../charts/sync-store/examples/quickstart/README.md) with
MongoDB, Redis, persistent volumes and generated credentials. Use it to understand
the application before designing a production environment.

## Build and validate

The checked-in `Helm chart` GitHub Actions workflow runs for chart changes on
pushes to `master`, pull requests and manual dispatch. It lints the default,
quick-start and production-example values, renders manifests and uploads a
packaged chart. It does **not** deploy to a cluster or build an application image.
Other workflows in `.github/workflows` have their own triggers and permissions.
Check the Actions page for the actual result of each run.

For an application release, build the repository's API Dockerfile from the
repository root. It includes the dashboard, SDK build dependencies, generated
database client and migration checks. For example:

```sh
docker build --file apps/api/Dockerfile --tag registry.example.com/team/sync-store:VERSION .
docker push registry.example.com/team/sync-store:VERSION
```

Replace `VERSION` and the registry with your release values. Configure registry
authentication as a masked CI secret or workload identity. Build for the target
node architecture; use a multi-platform builder when publishing multiple
architectures. Record the resulting image digest and scan the image according
to your project's release policy. Avoid mutable `latest` tags for deployments.

## Prepare a private environment

1. Provision a MongoDB replica set and a migration account with `readWrite` and
   `dbAdmin` on the application database. Create and test a backup/restore plan.
2. For multiple replicas, provision shared Redis 7.2+ with AOF enabled and
   permission for `WAITAOF`. Account for memory, persistence and failover.
3. Create a Kubernetes namespace and an environment Secret containing
   `DATABASE_URL`, `JWT_SECRET` and `CSRF_SECRET` (at least 32 characters).
   Add `REDIS_URL`, `SSO_CLIENT_SECRET` and `METRICS_TOKEN` when needed. Use a
   secret manager or a protected local environment file, never committed values.
4. Configure an ingress controller, DNS and a TLS Secret for public access.
   Set `env.API_URL` to the public API base including `/api`, and restrict CORS
   to your application's origins. Preserve WebSocket upgrades and connections.
5. Copy the chart's [production values example](../charts/sync-store/ci/production-values.yaml)
   to private storage. Replace hostnames, email allowlists, Secret references,
   resource budgets, image repository and digest. Review it for your environment.

The [Secret template](../charts/sync-store/examples/secret.example.yaml) documents
the key names. Its placeholder values are not working credentials.

## Deploy a reviewed release

An example deployment command, using a preconfigured CI Kubernetes identity:

```sh
helm upgrade --install sync-store ./charts/sync-store \
  --kube-context EXAMPLE_CONTEXT --namespace sync-store --create-namespace \
  --values /secure/path/production-values.yaml \
  --set-string image.repository=registry.example.com/team/sync-store \
  --set-string image.digest=sha256:REPLACE_WITH_IMAGE_DIGEST \
  --wait --timeout 12m

helm test sync-store --kube-context EXAMPLE_CONTEXT \
  --namespace sync-store --timeout 2m
```

The database and environment Secret must exist before Helm starts: the
pre-install/pre-upgrade migration Job runs before normal release resources.
Serialize deployments to the same environment/database. Retain failed Job logs
for diagnosis and report the deployed commit, image digest and chart version.

Use a dedicated deploy identity scoped to the release namespace; store its
credentials in CI secrets or use workload identity. If you automate deployment,
run it only on trusted release branches after build and validation succeed.
Never give untrusted pull-request code production credentials.

For GitOps, maintain chart references, image digests and environment overlays in
a private deployment repository. Review your controller's hook semantics: it
must run migrations and wait for success before replacing application Pods.
Do not assume `pre-install` has identical behavior in every GitOps controller.

## Verify and notify

Wait for the Helm release and test to succeed, then check dashboard setup/login,
an authenticated API write/read, and WebSocket synchronization with a dedicated
test application key. For dashboard OIDC, verify an allowed administrator can
log in and an unlisted user is rejected. REST/SDK/WebSocket applications use API
keys; they should not require an interactive browser login.

An optional CI notification can send the repository/release, status, commit and
job URL to your chosen notification service after deployment. Keep bot tokens,
relay URLs and recipient identifiers in protected CI secrets. Redact credentials
and setup codes from notifications and logs. A successful build alone must not
be reported as a successful deployment.

## Diagnose and roll back

Inspect Pod events, image pull failures, PVC binding and the migration Job before
retrying. See the chart guide for concrete commands and resource defaults.
Dependency upgrades must pass the database migration checks and be exercised
against a restored database before release; never reset production data or
rewrite migration history to bypass an error.

Roll back to a known compatible image through your maintained Helm values or
GitOps repository. A Helm rollback restores application resources, **not** the
database schema or data. Review compatibility before rolling back and restore
a verified backup if required. Pause automatic promotion while investigating a
bad release so it cannot immediately deploy the failing version again.
