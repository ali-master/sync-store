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

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

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
