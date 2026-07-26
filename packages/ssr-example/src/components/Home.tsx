import { ssr } from "../../config";
import Counter from "./Counter.island";
import { ManualSection, ManualShell } from "./ManualShell";
import Viewport from "./Viewport.client";

export default ssr(async (c) => {
  c.get("page").title = "@k2b/ssr Example";

  return () => (
    <ManualShell
      active="overview"
      title="@k2b/ssr"
      summary="Server-rendered SolidJS components with explicit islands for Bun."
    >
      <ManualSection label="NAME">
        <p>
          <strong>ssr</strong> — render complete pages without turning the
          application into a client bundle.
        </p>
      </ManualSection>

      <ManualSection label="SYNOPSIS">
        <pre class="code-sample">
          <code>{`import Counter from "./Counter.island";

export default () => () => (
  <main>
    <h1>Rendered on the server</h1>
    <Counter initial={0} />
  </main>
);`}</code>
        </pre>
      </ManualSection>

      <ManualSection label="EXAMPLES">
        <div class="runtime-example">
          <div>
            <code class="runtime-file">Counter.island.tsx</code>
            <p>
              Server-rendered markup with local browser state. Use the buttons
              or the <kbd>+</kbd>, <kbd>−</kbd> and <kbd>0</kbd> keys.
            </p>
          </div>
          <Counter initial={0} />
        </div>
        <div class="runtime-example">
          <div>
            <code class="runtime-file">Viewport.client.tsx</code>
            <p>Client-only output that reads the current browser viewport.</p>
          </div>
          <Viewport />
        </div>
      </ManualSection>

      <ManualSection label="RENDERED">
        <p>
          This document was rendered on the server at{" "}
          <time dateTime={new Date().toISOString()}>
            {new Date().toISOString()}
          </time>
          .
        </p>
      </ManualSection>

      <ManualSection label="SEE ALSO">
        <nav class="manual-links" aria-label="Related examples">
          <a href="/about">architecture(7)</a>
          <a href="/api-test">hono-api(7)</a>
          <a href="/nav-demo">navigation(7)</a>
        </nav>
      </ManualSection>
    </ManualShell>
  );
});
