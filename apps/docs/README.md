This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/create-next-app).

## Getting Started

First, run the development server:

```bash
bun run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/route.ts`. The page auto-updates as you edit the file.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

Set the Vercel project's **Root Directory** to `apps/docs` and enable **Include source files outside of the Root Directory in the Build Step**. The Next.js configuration reads canonical branding files from the repository's `assets/` directory.

The checked-in `vercel.json` sets the Next.js preset, installs with `bun install --frozen-lockfile`, and builds with `bun run build`. This runs the existing `bun --bun next build` script directly. Leave the output directory at the Next.js default.

Do not use the automatically suggested `turbo run build` command for this project: Turbo's JavaScript launcher has a Node shebang and fails with `env: 'node': No such file or directory` on a Bun-only build image. Repository `bunfig.toml` settings apply when Bun launches scripts, not when the platform launches Turbo directly. The explicit file-based build command overrides that default.

After deploying this configuration, the build log should show `Running "bun run build"`, followed by `bun --bun next build`. The warning about blocked dependency postinstall scripts is separate from the Turbo launcher failure; it does not require enabling all lifecycle scripts.

## API Routes

This directory contains example API routes for the headless API app.

For more details, see [route.js file convention](https://nextjs.org/docs/app/api-reference/file-conventions/route).

# Branding and link previews

The canonical logo and share image live in the repository's `assets/` directory.
Next.js copies them to `public/brand/` and creates `app/icon.svg` on dev/build.
Generated copies are ignored by Git; edit the originals rather than the copies.

Set `SITE_URL` to the public documentation origin before building (for example,
`SITE_URL=https://docs.example.com bun run build`). This provides absolute URLs for
Open Graph and Twitter cards. Vercel's production domain is detected automatically;
local development defaults to `http://localhost:4000`.

The GitHub repository preview is a separate setting: upload
`assets/social-preview.png` under repository **Settings → General → Social preview**.
Committing an image or adding website metadata does not change that GitHub setting.
