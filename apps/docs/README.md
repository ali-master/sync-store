# Sync Store documentation

**Help people go from a first connection to a service they can operate confidently.**

This is the documentation site for Sync Store. It explains how to run an installation,
connect an application, manage customer workspaces and recover data. The guides focus
on tasks and observable behavior so readers can understand both what the service
provides and where its limits are.

## Find the right guide

| What you want to do | Guide |
| --- | --- |
| Run your own installation | [Self hosted](content/docs/guides/self-hosted.mdx) |
| Connect an application | [Client SDK](content/docs/guides/client-sdk.mdx) |
| Watch two clients synchronize | [Playground](content/docs/playground.mdx) |
| Manage access and stored data | [Dashboard](content/docs/guides/dashboard.mdx) |
| Give customers separate workspaces | [Multi-tenancy](content/docs/guides/multi-tenancy.mdx) |
| Branch data or restore a snapshot | [Branches and commits](content/docs/guides/branches-and-commits.mdx) |
| Understand traffic and growth | [Operational reports](content/docs/guides/operational-reports.mdx) |
| Integrate directly with the service | [HTTP and Socket.IO reference](content/docs/reference/http-api.mdx) |

## Preview the site

From the repository root:

```sh
bun install --frozen-lockfile
bun run --cwd apps/docs dev
```

Open `http://localhost:4000`. Reading the guides does not require a running API;
trying live playground operations does. Follow the self-hosting guide to start a
service and create a disposable application key.

## Improve a guide

Edit pages under [content/docs](content/docs) and update
[content/docs/meta.json](content/docs/meta.json) when adding a navigation entry.
Use screenshots under [public/screenshots](public/screenshots) to explain an actual
workflow, keeping credentials and customer data out of images.

Start with the reader's goal, give the shortest complete path to a result, and explain
how to check that it worked. Distinguish queued work from confirmed server writes,
retained history from backups, and local test results from production guarantees.
Keep commands and permission requirements aligned with the current API and SDK.

Validate edits from the repository root:

```sh
bun run --cwd apps/docs types:check
bun run --cwd apps/docs build
```

## Publish the documentation

For Vercel, use `apps/docs` as the project root and enable **Include source files
outside of the Root Directory in the Build Step** so shared assets are available.
The checked-in [vercel.json](vercel.json) supplies the install and build commands;
keep those instead of the automatically suggested Turbo command. Leave the output
directory at its default.

Set `SITE_URL` to the public documentation origin when building elsewhere:

```sh
SITE_URL=https://docs.example.com bun run --cwd apps/docs build
```

This gives link previews absolute image URLs. Vercel's production domain is detected
automatically; local development uses `http://localhost:4000`.

## Keep the identity consistent

The canonical logo and share image live in [assets](../../assets). Development and
build commands generate the site's branding copies and favicon from those originals.
Edit the originals rather than generated copies.

The GitHub repository's social preview is configured separately: upload
[assets/social-preview.png](../../assets/social-preview.png) under repository
**Settings → General → Social preview**. Website preview metadata does not update
that setting.
