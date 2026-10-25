import Link from "next/link";
import { Logo } from "../logo";

const paths = [
  {
    number: "01",
    title: "Your first sync.",
    description: "From an empty database to a connected application. Start with a local setup.",
    href: "/docs/getting-started",
    label: "Get started",
    icon: "↗",
  },
  {
    number: "02",
    title: "See both sides.",
    description: "Two independent clients. One shared state. Explore delivery and reconnects.",
    href: "/docs/playground",
    label: "Explore the playground",
    icon: "⇄",
  },
  {
    number: "03",
    title: "Make it yours.",
    description: "Bring synchronized JSON into your application with TypeScript and React.",
    href: "/docs/guides/client-sdk",
    label: "Meet the SDK",
    icon: "⌘",
  },
];

/** Introduce the synchronization model and direct readers into the documentation. */
export default function HomePage() {
  return (
    <div className="docs-home">
      <section className="home-hero" aria-labelledby="hero-title">
        <p className="eyebrow">
          <span className="status-dot" /> THE SYNC STORE DEVELOPER GUIDE
        </p>
        <h1 id="hero-title">
          A little code.
          <br />
          <span>Everything in sync.</span>
        </h1>
        <p className="hero-description">
          Shared state, thoughtfully simple.
          <br />
          Build connected experiences with synchronized JSON,
          <br className="desktop-break" /> local writes, and a clear path back online.
        </p>
        <div className="hero-actions">
          <Link href="/docs/getting-started" className="button-primary">
            Start building <span aria-hidden="true">↗</span>
          </Link>
          <Link href="/docs/playground" className="button-text">
            Explore the playground <span aria-hidden="true">→</span>
          </Link>
        </div>
        <div
          className="sync-illustration"
          aria-label="Conceptual illustration: a JSON write travels through Sync Store to another client. Not live data."
        >
          <div className="illustration-bar">
            <span className="window-dots">
              <i />
              <i />
              <i />
            </span>
            <span>One write. A shared experience.</span>
            <span className="illustration-label">CONCEPT</span>
          </div>
          <div className="sync-stage">
            <div className="sync-endpoint">
              <span className="endpoint-label">
                <b>A</b> YOUR APPLICATION
              </span>
              <code>
                <span className="code-purple">await</span> store.
                <span className="code-blue">setItem</span>(<br />
                &nbsp; <span className="code-green">&apos;theme&apos;</span>,{" "}
                <span className="code-green">&apos;light&apos;</span>
                <br />
                );
              </code>
              <span className="endpoint-foot">A small change.</span>
            </div>
            <div className="sync-bridge" aria-hidden="true">
              <span className="bridge-line" />
              <div className="bridge-logo">
                <Logo size={48} />
              </div>
              <span className="bridge-line" />
              <span className="bridge-caption">SYNC STORE</span>
            </div>
            <div className="sync-endpoint replica">
              <span className="endpoint-label">
                <b>B</b> ANOTHER INSTANCE
              </span>
              <div className="replica-value">
                <span>theme</span>
                <strong>light</strong>
                <span className="value-check" aria-hidden="true">
                  ✓
                </span>
              </div>
              <span className="endpoint-foot">The same state.</span>
            </div>
          </div>
          <div className="illustration-footer">
            <span>TypeScript-first</span>
            <span>WebSocket + HTTP</span>
            <span>Offline outbox</span>
          </div>
        </div>
      </section>
      <section className="home-paths" aria-labelledby="paths-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">FROM IDEA TO IMPLEMENTATION</p>
            <h2 id="paths-title">Find your starting point.</h2>
          </div>
          <Link href="/docs" className="button-text">
            All documentation ↗
          </Link>
        </div>
        <div className="path-grid">
          {paths.map((path) => (
            <Link className="path-card" href={path.href} key={path.number}>
              <div className="path-top">
                <span>{path.number}</span>
                <span className="path-icon" aria-hidden="true">
                  {path.icon}
                </span>
              </div>
              <h3>{path.title}</h3>
              <p>{path.description}</p>
              <span className="path-link">
                {path.label} <span aria-hidden="true">→</span>
              </span>
            </Link>
          ))}
        </div>
      </section>
      <section className="reference-section" aria-labelledby="reference-title">
        <div>
          <p className="eyebrow">DESIGNED TO BE UNDERSTOOD</p>
          <h2 id="reference-title">
            The details.
            <br />
            Without the guesswork.
          </h2>
          <p>
            Understand what happens between a local write and a remote update. Know the boundaries
            before you ship.
          </p>
          <Link href="/docs/guides/offline-sync" className="button-text">
            How synchronization works →
          </Link>
        </div>
        <div className="reference-links">
          {[
            ["React integration", "Hooks, state and component lifecycles", "/docs/guides/react"],
            ["API reference", "HTTP endpoints and Socket.IO events", "/docs/reference/http-api"],
            [
              "Configuration",
              "Server, client and environment settings",
              "/docs/reference/configuration",
            ],
            [
              "Security & deployment",
              "API keys, access boundaries and operations",
              "/docs/guides/deployment",
            ],
            ["Troubleshooting", "Find the cause. Get back to building.", "/docs/troubleshooting"],
          ].map(([title, description, href]) => (
            <Link key={href} href={href}>
              <div>
                <h3>{title}</h3>
                <p>{description}</p>
              </div>
              <span aria-hidden="true">↗</span>
            </Link>
          ))}
        </div>
      </section>
      <footer className="home-footer">
        <span>
          <Logo size={22} /> Sync Store <span className="footer-divider">/</span> Built for
          connected experiences.
        </span>
        <a href="https://github.com/ali-master/sync-store">Open source on GitHub ↗</a>
      </footer>
    </div>
  );
}
