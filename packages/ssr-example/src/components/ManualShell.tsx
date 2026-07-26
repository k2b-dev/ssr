import type { JSX } from "solid-js";

type Page = "overview" | "architecture" | "api" | "navigation";

type ManualShellProps = {
  active: Page;
  title: string;
  summary: string;
  children: JSX.Element;
};

type ManualSectionProps = {
  label: string;
  id?: string;
  children: JSX.Element;
};

const pages: Array<{ id: Page; href: string; label: string }> = [
  { id: "overview", href: "/", label: "Overview" },
  { id: "architecture", href: "/about", label: "Architecture" },
  { id: "api", href: "/api-test", label: "API" },
  { id: "navigation", href: "/nav-demo", label: "Navigation" },
];

export function ManualShell(props: ManualShellProps) {
  return (
    <div class="manual-shell">
      <header class="manual-bar">
        <a class="manual-bar__brand" href="/">
          @k2b/ssr(7)
        </a>
        <nav class="manual-bar__nav" aria-label="Example pages">
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
        <a class="manual-bar__source" href="https://github.com/k2b-dev/ssr">
          Source ↗
        </a>
      </header>

      <main class="manual-page">
        <header class="manual-title">
          <h1>{props.title}</h1>
          <p>{props.summary}</p>
        </header>
        {props.children}
      </main>

      <footer class="manual-footer">
        <span>@k2b/ssr</span>
        <span>SolidJS islands for Bun</span>
      </footer>
    </div>
  );
}

export function ManualSection(props: ManualSectionProps) {
  return (
    <section class="manual-section" id={props.id}>
      <h2>{props.label}</h2>
      <div class="manual-section__content">{props.children}</div>
    </section>
  );
}
