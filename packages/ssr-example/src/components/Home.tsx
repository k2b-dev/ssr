import { ssr } from "../../config";
import Counter from "./Counter.island";
import {
  RuntimeLabel,
  ShowcaseSection,
  ShowcaseShell,
} from "./ShowcaseShell";
import Viewport from "./Viewport.client";

export default ssr(async (c) => {
  c.get("page").title = "@k2b/ssr Example";

  return () => (
    <ShowcaseShell
      active="overview"
      title="SSR and islands in one running example"
      summary="Inspect what renders on the server, what becomes interactive, and what runs only in the browser."
    >
      <div class="runtime-list">
        <section class="runtime-demo">
          <header class="runtime-demo__identity">
            <h2>Server response</h2>
            <code>Home.tsx</code>
          </header>
          <div class="runtime-demo__details">
            <RuntimeLabel runtime="server" />
            <p>The route and document markup require no browser bundle.</p>
          </div>
          <dl class="runtime-facts runtime-demo__output">
            <div>
              <dt>route</dt>
              <dd>GET /</dd>
            </div>
            <div>
              <dt>client entry</dt>
              <dd>none</dd>
            </div>
            <div>
              <dt>rendered</dt>
              <dd>
                <time dateTime={new Date().toISOString()}>
                  {new Date().toISOString()}
                </time>
              </dd>
            </div>
          </dl>
        </section>

        <section class="runtime-demo">
          <header class="runtime-demo__identity">
            <h2>Counter state</h2>
            <code>Counter.island.tsx</code>
          </header>
          <div class="runtime-demo__details">
            <RuntimeLabel runtime="island" />
            <p>Starts as HTML, then owns local state after hydration.</p>
          </div>
          <div class="runtime-demo__output runtime-demo__action">
            <Counter initial={0} />
            <span>
              keys <kbd>+</kbd> <kbd>−</kbd> <kbd>0</kbd>
            </span>
          </div>
        </section>

        <section class="runtime-demo">
          <header class="runtime-demo__identity">
            <h2>Browser viewport</h2>
            <code>Viewport.client.tsx</code>
          </header>
          <div class="runtime-demo__details">
            <RuntimeLabel runtime="client" />
            <p>Mounts in the browser and reads the viewport API.</p>
          </div>
          <div class="runtime-demo__output runtime-demo__action">
            <Viewport />
            <span>resize the window</span>
          </div>
        </section>
      </div>

      <ShowcaseSection
        label="More features"
        description="Open a focused example with live behavior and implementation context."
      >
        <nav class="feature-links" aria-label="Feature examples">
          <a href="/api-test">
            <strong>API example</strong>
            <span>Run a request through hc&lt;ApiType&gt;</span>
          </a>
          <a href="/nav-demo">
            <strong>Client navigation</strong>
            <span>Preserve island and scroll state</span>
          </a>
        </nav>
      </ShowcaseSection>
    </ShowcaseShell>
  );
});
