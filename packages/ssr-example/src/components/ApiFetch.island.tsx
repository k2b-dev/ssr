import { createSignal } from "solid-js";
import { hc } from "hono/client";
import type { ApiType } from "../api";

const client = hc<ApiType>("/api");

export default () => {
  const [data, setData] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);

  const fetchData = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await client.msg.$get();
      if (!response.ok) {
        throw new Error(`Request failed with ${response.status}`);
      }
      setData(JSON.stringify(await response.json(), null, 2));
    } catch (cause) {
      setData(null);
      setError(cause instanceof Error ? cause.message : "Request failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="api-console">
      <div class="api-console__request">
        <code>GET /api/msg</code>
        <button type="button" onClick={fetchData} disabled={loading()}>
          {loading() ? "Requesting…" : "Send request"}
        </button>
      </div>
      <pre class="api-console__response" aria-live="polite" aria-busy={loading()}>
        <code>
          {error() ??
            data() ??
            `{\n  "status": "idle",\n  "message": "No request sent"\n}`}
        </code>
      </pre>
    </div>
  );
};
