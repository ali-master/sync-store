# See Sync Store in action

**Try the behaviors your application needs before integrating them.**

These examples let you watch changes move between clients, inspect stored values
and understand what happens when a connection disappears. They use a real running
Sync Store service rather than simulated synchronization.

## Two-client playground

The playground puts two independent clients side by side. Each has its own local
cache and connection, making delivery and reconnect behavior visible.

Try this sequence:

1. Enter your API origin and a disposable application key with write access.
2. Connect both clients, save JSON on client A and watch client B receive it.
3. Disconnect A and make another change. Reconnect it to send the pending write.
4. Delete the selected key and check that the other client reflects the removal.

Clearing the activity log does not delete stored data. Credentials stay in memory;
cached values and pending operations remain in browser storage. Ending a session
does not discard its queue. Keep the same client configuration and cache namespace
when recovering pending work.

### Run the playground

Start the service with the [self-hosting guide](../apps/docs/content/docs/guides/self-hosted.mdx)
or [development setup](../apps/docs/content/docs/getting-started.mdx), then run these
commands from the repository root:

```sh
bun install --frozen-lockfile
bun run --cwd packages/client-sdk build
bun run --cwd examples/react-app dev
```

Open the URL printed in the terminal. The
[playground walkthrough](../apps/docs/content/docs/playground.mdx) explains its controls
and how to interpret connection and delivery status.

## Basic request example

[Basic usage](basic-usage/index.html) shows the smallest request-and-response workflow:
connect with an application key, send storage requests and inspect the response
envelope. Use it to understand the API independently of the client's cache and live
subscriptions. This example does not queue offline work or receive live updates.

To serve it locally after installing workspace dependencies:

```sh
cd examples/react-app
bun ./node_modules/vite/bin/vite.js ../..
# Open /examples/basic-usage/index.html at the printed URL.
```

## Adapt an example for your application

Use disposable data and credentials while experimenting. A shared API key does not
authenticate individual users; these examples are not a production browser
authorization pattern. Keep unrestricted keys behind a trusted application backend.

When deploying the playground, set `VITE_DOCS_URL` to a documentation URL ending in
`/docs`. Never put an API secret in a frontend environment variable.

```sh
# From the repository root
bun run --cwd examples/react-app test:types
bun run --cwd examples/react-app build
bun run --cwd examples/react-app preview
```

Continue with the [SDK guide](../packages/client-sdk/README.md) when you are ready
to build synchronization into your own application.
