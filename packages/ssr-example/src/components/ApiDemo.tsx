import { ssr } from "../../config";
import ApiFetchIsland from "./ApiFetch.island";
import { ShowcaseSection, ShowcaseShell } from "./ShowcaseShell";

export default ssr(async (c) => {
  c.get("page").title = "API example · @k2b/ssr";

  return () => (
    <ShowcaseShell
      active="api"
      title="API example"
      summary="Run a request from an island through a type-safe Hono client."
    >
      <ShowcaseSection
        label="Live request"
        description="The request control and response are the only interactive part of this page."
        runtime="island"
      >
        <ApiFetchIsland />
      </ShowcaseSection>

      <ShowcaseSection
        label="Type contract"
        description="The client infers routes and response types from the server app."
      >
        <dl class="contract-list">
          <div>
            <dt>Client</dt>
            <dd>
              <code>hc&lt;ApiType&gt;</code>
            </dd>
          </div>
          <div>
            <dt>Endpoint</dt>
            <dd>
              <code>GET /api/msg</code>
            </dd>
          </div>
          <div>
            <dt>Response</dt>
            <dd>
              <code>{"{ message: string; time: number }"}</code>
            </dd>
          </div>
        </dl>
      </ShowcaseSection>

      <ShowcaseSection label="Server route" runtime="server">
        <pre class="code-sample">
          <code>{`export const api = new Hono().get("/msg", (c) =>
  c.json({ message: "Hello from Hono!", time: Date.now() }),
);`}</code>
        </pre>
      </ShowcaseSection>
    </ShowcaseShell>
  );
});
