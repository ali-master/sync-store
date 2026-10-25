# Examples

## React playground

The main demo uses two real SDK clients, each with its own cache and connection.
It requires a running API and a disposable, write-enabled API key.

```sh
# From the repository root
bun install --frozen-lockfile
bun run --cwd packages/sync-client build
bun run --cwd examples/react-app dev
```

Open Vite's printed URL, enter the API origin and key, and connect both clients.
Save JSON on A and watch B receive it. Disconnect A, save locally, then reconnect
to verify pending delivery. Delete affects only the selected key; clearing the log
does not delete data.

Credentials stay in memory. Cached values and pending operations persist in browser
storage. Ending a session does not delete that outbox. Keep the same tab/server/user
to recover pending work.

```sh
bun run --cwd examples/react-app test:types
bun run --cwd examples/react-app build
bun run --cwd examples/react-app preview
```

Set `VITE_DOCS_URL` to a docs URL ending in `/docs` when deploying the playground.
Never put an API secret in a Vite environment variable.

## Basic HTTP example

Serve `examples/basic-usage/index.html` from the repository using a static server.
This standalone page sends direct authenticated REST calls and shows the response
envelope. It deliberately has no SDK, realtime subscription or offline outbox.

For local use, Vite can serve the repository:

```sh
cd examples/react-app
bun ./node_modules/vite/bin/vite.js ../..
# Open /examples/basic-usage/index.html on the printed local URL.
```

See [Getting started](../apps/docs/content/docs/getting-started.mdx) for API setup
and [the playground guide](../apps/docs/content/docs/playground.mdx) for its behavior.
A shared API key is not end-user authentication; these demos are for development,
not a production browser authorization pattern.
