# Sotoon CI/CD and deployment

This runbook describes the Sync Store installation at
<https://sync-store.revue.ir/dashboard/>. Application source lives in this
repository. Image builds and Kubernetes deployment configuration live in the
private [DevOps / addons](https://gitlab.mom.ir/devops/addons) repository.
Access to that GitLab project and the Kubernetes cluster is required for the
operator commands below.

## Release flow

```text
GitHub: ali-master/sync-store, master
  -> Kubernetes GitHub poller (every minute)
  -> GitLab: devops/addons, main
       prepare-sync-store -> build-sync-store -> deploy-sync-store
  -> GitOps commit: source revision + image tag
  -> Argo CD: sync-store
  -> Sotoon Kubernetes: sync-store namespace
```

A push to GitHub `master` is detected by the shared poller used for IPU and
Telegram Relay. It triggers a pipeline on the protected GitLab `main` branch.
There is no GitHub Actions deployment and no direct deployment from a developer
laptop. A GitHub commit alone is not evidence of a successful release: check the
image build, GitOps commit, and Argo CD health.

The poller runs once per minute, but detection, runner availability, image build,
image pull, database initialization and readiness checks all add time. Deployment
is not instantaneous.

### 1. Prepare the source

`ci/prepare-sync-store.sh` clones GitHub `master`, validates the full commit SHA,
and publishes the exact source checkout as a pipeline artifact. Its dotenv
artifact supplies `SYNC_STORE_SHA`, `SYNC_STORE_IMAGE_TAG` and
`SYNC_STORE_CHANGED` to the next jobs.

The image tag is `upstream-<12-character-SHA>-sotoon-3`. The suffix identifies the
deployment build recipe. Bump it consistently in all three Sync Store CI scripts
when a recipe change requires a new image for the same application commit.

If both `gitops/vendor/sync-store` and the deployed image tag already match, the
build and deployment scripts exit successfully without changing the installation.
An infrastructure commit containing `[rebuild-sync-store]` forces a rebuild.
Prefer a new recipe suffix when a new rollout is required: rebuilding an existing
tag does not change the pod template and therefore does not restart a running pod.

### 2. Build and publish

`ci/build-sync-store.sh` verifies the source artifact SHA and builds the upstream
`apps/api/Dockerfile` with rootless BuildKit on the `mom-kubernetes` GitLab runner.
The image contains the API and compiled dashboard. The Dockerfile installs locked
dependencies with Bun, generates the database client, builds the shared packages
and dashboard/API, and assembles the production runtime.

The image is published to:

```text
registry.mom.ir/devops/addons/sync-store:upstream-<SHA12>-sotoon-3
```

Registry credentials come from GitLab's built-in CI variables and are written to
a temporary Docker configuration removed when the job exits. The build requests
4 GiB of ephemeral storage and permits up to 12 GiB; the runner and namespace
limits must permit this. The job timeout is 60 minutes.

This image job is a production build, not a complete test suite. It does not
replace the API's unit, integration or type checks. Run the relevant tests when
changing application behavior.

### 3. Record the release and let Argo CD deploy

`ci/deploy-sync-store.sh` runs only after the build succeeds. It checks GitHub
`master` again and skips a build superseded by a newer source commit. All addons
deployment jobs use the `addons-main` resource group so their GitOps writes are
serialized.

The job fetches the latest infrastructure `main`, updates the
`gitops/vendor/sync-store` gitlink and the image in
`gitops/apps/sync-store/kustomization.yaml`, and pushes a deployment commit. Its
commit message includes the source URL and the GitLab pipeline URL. The job uses
the existing protected `RELAY_GIT_PUSH_TOKEN`; despite its historical name, that
credential is shared by these addons deployment jobs. Do not put its value in
source files, logs or documentation.

Argo CD reconciles the `sync-store` application from these Kustomize manifests.
GitLab's deploy job records the desired version; it does not itself wait for
Kubernetes health. Confirm `Synced` and `Healthy` before treating a release as
complete.

## Infrastructure layout

These paths are relative to the private addons repository:

| Path | Responsibility |
| --- | --- |
| `.gitlab-ci.yml` | Prepare, build and deploy jobs and their dependencies |
| `ci/prepare-sync-store.sh` | Fetch source and detect a required build |
| `ci/build-sync-store.sh` | Build and publish the production image |
| `ci/deploy-sync-store.sh` | Record the source and image in GitOps |
| `gitops/vendor/sync-store` | Git submodule pointer for the deployed source |
| `gitops/apps/sync-store/` | Application, data services, storage, routes and policies |
| `gitops/apps/telegram-relay/github-poller.yaml` | Shared GitHub polling CronJob |
| `gitops/charts/keycloak/values.yaml` | Managed Keycloak client configuration |
| `scripts/verify-sync-store-sso.py` | Deployment authentication smoke checks |

Sync Store runs one API/dashboard replica with a `Recreate` strategy. An upgrade
can briefly interrupt service. Its `migrate` init container runs `bun run
db:deploy` using the same image before the API starts. MongoDB uses a persistent
single-node replica set; Redis is colocated in the MongoDB pod in this
installation. This is not a highly available deployment.

The API container requests 100m CPU and 256 MiB memory, with limits of 1 CPU and
768 MiB. These are reservations and ceilings, not measured usage. Inspect actual
consumption with `kubectl top pods -n sync-store --containers` before resizing.
MongoDB and Redis have their own resources and persistent volumes; do not delete
their PVCs during an application rollback.

The `sync-store-secrets` Kubernetes Secret supplies database, Redis, JWT and CSRF
credentials. Registry pull credentials and the gateway OIDC client secret are
also provisioned separately. The repository contains references, not secret
values. Preserve these secrets across application releases.

## Dashboard SSO and application API access

There are two browser authentication steps:

1. Envoy Gateway protects the UI using Keycloak client `sync-store-gateway`.
   Its callback and logout paths are `/oauth2/callback` and `/oauth2/logout`.
2. Sync Store's native dashboard SSO uses client `sync-store-dashboard`. Its
   authorization-code flow uses PKCE and returns to `/api/v1/sso/callback`.
   The existing Keycloak browser session normally avoids another password prompt.

The native client is public, uses the standard authorization-code flow and
requires PKCE S256. It does not require a client secret. Its exact redirect URI is:

```text
https://sync-store.revue.ir/api/v1/sso/callback
```

The application ConfigMap sets:

```dotenv
API_URL=https://sync-store.revue.ir
SSO_ISSUER=https://oauth.revue.ir/realms/mom
SSO_CLIENT_ID=sync-store-dashboard
SSO_REDIRECT_URI=https://sync-store.revue.ir/api/v1/sso/callback
SSO_PROVIDER_NAME=Keycloak
SSO_ALLOWED_EMAILS=<comma-separated approved administrator email addresses>
```

The deployed allow-list grants installation administrator access only to the
approved Ali and Mohsen accounts. Keycloak must supply their verified email
addresses in ID tokens; `openid email profile` are the default scopes. Native
SSO authorizes by the configured email allow-list, not the legacy
`sync-store-admin` realm role. Do not enable a broad email-domain allow-list as a
shortcut. Settings saved in the dashboard override environment values; inspect
those overrides when diagnosing a mismatch.

The old `ADMIN_OIDC_*` variables and `/dashboard/` redirect may remain during the
transition to support rollback to the previous custom image. Current upstream
SSO uses `SSO_*` variables and `/api/v1/sso/callback`.

The `/api/v1` and `/socket.io` routes bypass the gateway's interactive browser
login. Sync Store still authenticates those requests itself. Applications such
as Pay use a Sync Store API key with the required tenant/user/instance context;
they do not need a Keycloak client ID or client secret. A dashboard SSO session
authorizes administration routes only and must not work as an application API key.
See the [dashboard SSO guide](../apps/docs/content/docs/guides/dashboard-sso.mdx)
for session behavior and access revocation.

## Validate a release

Run from an authorized operator environment with the intended Kubernetes context:

```sh
kubectl --context mom-admin@mom -n argocd get application sync-store
kubectl --context mom-admin@mom -n sync-store rollout status deployment/sync-store --timeout=300s
kubectl --context mom-admin@mom -n sync-store get pods
kubectl --context mom-admin@mom -n sync-store get deployment sync-store \
  -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'
kubectl --context mom-admin@mom -n sync-store get pods -l app=sync-store \
  -o jsonpath='{range .items[*]}{.metadata.name}{" "}{.status.containerStatuses[0].imageID}{"\n"}{end}'
```

Compare the GitHub SHA, successful GitLab build, GitOps gitlink/image tag and live
container image ID. A green pipeline with an older running pod is not a completed
deployment. Also verify:

- An anonymous `/dashboard/` request redirects to Keycloak.
- Both approved administrator accounts can open the dashboard and admin API.
- An account outside the allow-list cannot obtain administrator access.
- Anonymous requests and forged bearer tokens cannot access protected API routes.
- A dashboard SSO token cannot access application data routes.
- Existing application API keys still work without a Keycloak browser cookie.

The installation must already have its bootstrap administrator. SSO does not
replace first-time setup or create that administrator automatically.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| No pipeline after a GitHub push | Shared CronJob status/logs, GitHub connectivity, trigger secret and protected `main` |
| Pipeline succeeds without building | `SYNC_STORE_CHANGED=0`: the tracked source and image tag already match |
| Build fails or is evicted | Job log, runner disk usage, 12 GiB ephemeral-storage allowance, registry/package connectivity |
| Deploy job reports a superseded commit | A newer GitHub commit arrived during the build; follow its pipeline |
| GitOps push fails | Protected push credential, branch permissions and concurrent manual changes; retry the deploy job |
| Argo is OutOfSync or Degraded | Application conditions, image pull, init-container logs, PVC availability and readiness |
| SSO callback fails | Exact client redirect URI, PKCE, issuer, verified email claim and application allow-list/overrides |
| UI works but Pay is rejected | Check the native API key and request context; a Keycloak token is not a replacement |

The shared poller records the source SHA when it successfully *triggers* a
pipeline. It does not automatically retry a failed build for an unchanged GitHub
SHA. Retry that failed GitLab pipeline/job or run a new pipeline on infrastructure
`main`; preparation compares against the deployed version and rebuilds as needed.

Useful diagnostics (avoid sharing logs that contain credentials or user data):

```sh
kubectl --context mom-admin@mom -n sync-store describe deployment sync-store
kubectl --context mom-admin@mom -n sync-store logs deployment/sync-store -c migrate --tail=100
kubectl --context mom-admin@mom -n sync-store logs deployment/sync-store -c api --tail=100
kubectl --context mom-admin@mom -n sync-store get events --sort-by=.lastTimestamp
```

## Rollback

For a normal code regression, revert the offending application change on GitHub
`master`. The resulting new commit goes through the same build and deployment
path, preserving a clear release history.

For an emergency rollback to an already published image:

1. Coordinate a temporary pause of automatic releases. Suspend the shared
   `relay-github-poller` CronJob and cancel pending Sync Store deploy jobs; this
   also pauses GitHub detection for IPU and Telegram Relay. Remember that an
   infrastructure `main` pipeline can independently run the Sync Store jobs.
2. In an infrastructure branch, restore the previous working image tag/digest in
   `gitops/apps/sync-store/kustomization.yaml` and matching
   `gitops/vendor/sync-store` gitlink. Commit through the normal protected-branch
   process while keeping automatic Sync Store deploy jobs paused.
3. Let Argo CD reconcile, then repeat the health and authentication checks above.
   Do not rely on `kubectl rollout undo`: Argo CD would restore the Git version.
4. Fix or revert the upstream regression before re-enabling the shared poller
   and deployment jobs, or automation can deploy the bad revision again.

An image rollback does not reverse database changes. Review migration
compatibility and take a verified data backup before releases that change the
schema. Never remove persistent storage or rotate application secrets merely to
roll back an image.
