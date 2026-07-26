import { ssr } from "../../config";
import ApiFetchIsland from "./ApiFetch.island";
import { ManualSection, ManualShell } from "./ManualShell";

export default ssr(async (c) => {
  c.get("page").title = "Hono API · @k2b/ssr";

  return () => (
    <ManualShell
      active="api"
      title="hono-api"
      summary="A typed client request inside one isolated browser boundary."
    >
      <ManualSection label="NAME">
        <p>
          <strong>hono-api</strong> — call a Hono endpoint without adding client
          state to the surrounding page.
        </p>
      </ManualSection>

      <ManualSection label="REQUEST">
        <ApiFetchIsland />
      </ManualSection>

      <ManualSection label="CONTRACT">
        <dl class="definition-list">
          <div>
            <dt>Transport</dt>
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
            <dt>Browser scope</dt>
            <dd>Request control and response output only</dd>
          </div>
        </dl>
      </ManualSection>
    </ManualShell>
  );
});
