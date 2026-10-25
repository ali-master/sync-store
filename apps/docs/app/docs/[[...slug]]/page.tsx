import { source } from "@root/lib/source";
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/page";
import { notFound } from "next/navigation";
import { getMDXComponents } from "@root/mdx-components";
import type { Metadata } from "next";
import { siteMetadata } from "@root/lib/metadata";

export default async function Page(props: { params: Promise<{ slug?: string[] }> }) {
  const params = await props.params;
  const page = source.getPage(params.slug);

  if (!page) {
    notFound();
  }

  const MDX = page.data.body;

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <header className="article-header">
        <p className="eyebrow">
          {params.slug?.[0] === "reference"
            ? "REFERENCE"
            : params.slug?.[0] === "guides"
              ? "DEVELOPER GUIDE"
              : "SYNC STORE ESSENTIALS"}
        </p>
        <DocsTitle>{page.data.title}</DocsTitle>
        <DocsDescription>{page.data.description}</DocsDescription>
      </header>
      <DocsBody className="article-content">
        <MDX components={getMDXComponents()} />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: { params: Promise<{ slug?: string[] }> }) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
    openGraph: {
      ...siteMetadata.openGraph,
      title: page.data.title,
      description: page.data.description,
    },
    twitter: {
      ...siteMetadata.twitter,
      title: page.data.title,
      description: page.data.description,
    },
  } satisfies Metadata;
}
