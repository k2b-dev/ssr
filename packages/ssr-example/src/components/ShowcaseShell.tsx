import type { JSX } from "solid-js";

type Page = "overview" | "api" | "navigation";

type ShowcaseShellProps = {
  active: Page;
  title: string;
  summary: string;
  children: JSX.Element;
};

type ShowcaseSectionProps = {
  label: string;
  description?: string;
  runtime?: "server" | "island" | "client";
  id?: string;
  children: JSX.Element;
};

const pages: Array<{ id: Page; href: string; label: string }> = [
  { id: "overview", href: "/", label: "Overview" },
  { id: "api", href: "/api-test", label: "API example" },
  { id: "navigation", href: "/nav-demo", label: "Navigation" },
];

export function ShowcaseShell(props: ShowcaseShellProps) {
  return (
    <div class="showcase-shell">
      <header class="site-header">
        <a class="site-header__brand" href="/">
          <strong>@k2b/ssr</strong>
          <span>example</span>
        </a>
        <nav class="site-nav" aria-label="Example pages">
          {pages.map((page) => (
            <a
              href={page.href}
              class={props.active === page.id ? "is-active" : undefined}
              aria-current={props.active === page.id ? "page" : undefined}
            >
              {page.label}
            </a>
          ))}
        </nav>
        <a class="source-link" href="https://github.com/k2b-dev/ssr">
          GitHub ↗
        </a>
      </header>

      <main class="showcase">
        <header class="page-heading">
          <h1>{props.title}</h1>
          <p>{props.summary}</p>
        </header>
        {props.children}
      </main>

      <footer class="site-footer">
        <span>Running on Bun + Hono</span>
        <span>SolidJS islands</span>
      </footer>
    </div>
  );
}

export function ShowcaseSection(props: ShowcaseSectionProps) {
  return (
    <section class="showcase-section" id={props.id}>
      <header class="section-heading">
        <div>
          <h2>{props.label}</h2>
          {props.description && <p>{props.description}</p>}
        </div>
        {props.runtime && <RuntimeLabel runtime={props.runtime} />}
      </header>
      <div class="showcase-section__content">{props.children}</div>
    </section>
  );
}

export function RuntimeLabel(props: {
  runtime: "server" | "island" | "client";
}) {
  const labels = {
    server: "runs on server",
    island: "server + browser",
    client: "runs in browser",
  };

  return <span class="runtime-label">{labels[props.runtime]}</span>;
}
