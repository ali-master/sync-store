# Shared service utilities

**Keep common service behavior consistent across Sync Store.**

This internal package holds helpers used by the project so each service does not
need its own version of routine request handling, logging and process management.
Its value is consistency: shared behavior can be maintained in one place.

## What belongs here

The current exports cover:

- Request and device information, including IP-address helpers.
- Logging, process signals and local port management.
- Identifiers, durations and decimal handling.
- Object inspection, runtime type checks and shared types.
- API-documentation filtering and reflection helpers.

The public exports are defined in [src/index.ts](src/index.ts),
[src/utils/index.ts](src/utils/index.ts) and [src/types/index.ts](src/types/index.ts).
Check those entry points before adding another helper or importing an internal file.

## Use it within the workspace

This is a private workspace package. Application developers connecting to Sync Store
should start with the [client SDK](../client-sdk/README.md); they do not need to
install these service utilities.

When maintaining the project, reuse an existing helper where its behavior fits.
Keep domain decisions such as tenant authorization, storage changes and recovery
inside their owning service rather than moving them into a general utility package.

## Check a change

From the repository root:

```sh
bun run --cwd packages/utils test:types
bun run --cwd packages/utils lint
bun run --cwd packages/utils build
```

Review callers when changing a shared helper: a small change here can affect several
parts of the service. Add a focused test for new behavior rather than expanding the
package with unused abstractions.
