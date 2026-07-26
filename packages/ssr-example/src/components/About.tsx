import { ssr } from "../../config";
import { ManualSection, ManualShell } from "./ManualShell";

export default ssr(async (c) => {
  c.get("page").title = "Architecture · @k2b/ssr";

  return () => (
    <ManualShell
      active="architecture"
      title="architecture"
      summary="The filename states which runtime owns a component."
    >
      <ManualSection label="DESCRIPTION">
        <p>
          Routes render SolidJS components into complete HTML. Interactive
          islands are rendered on the server and continue in the browser with
          serialized props. Client components mount only in the browser.
        </p>
      </ManualSection>

      <ManualSection label="FILES">
        <dl class="definition-list definition-list--files">
          <div>
            <dt>
              <mark>*.tsx</mark>
            </dt>
            <dd>Server-only page and layout components</dd>
            <dd class="definition-list__meta">render</dd>
          </div>
          <div>
            <dt>
              <mark>*.island.tsx</mark>
            </dt>
            <dd>Server markup with scoped interactive state</dd>
            <dd class="definition-list__meta">rerender</dd>
          </div>
          <div>
            <dt>
              <mark>*.client.tsx</mark>
            </dt>
            <dd>Browser-only components for platform APIs</dd>
            <dd class="definition-list__meta">mount</dd>
          </div>
        </dl>
      </ManualSection>

      <ManualSection label="SEQUENCE">
        <ol class="sequence">
          <li>
            <code>01</code>
            <span>Hono resolves the request and page data.</span>
          </li>
          <li>
            <code>02</code>
            <span>Solid renders the complete response body.</span>
          </li>
          <li>
            <code>03</code>
            <span>Only named island and client entries reach the browser.</span>
          </li>
        </ol>
      </ManualSection>

      <ManualSection label="BOUNDARY">
        <p>
          Island props cross a serialization boundary. Pass data values, not
          functions, signals, DOM nodes or class instances.
        </p>
      </ManualSection>
    </ManualShell>
  );
});
