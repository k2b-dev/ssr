import { ssr } from "../../config";
import { ManualSection, ManualShell } from "./ManualShell";
import NavDemoIsland from "./NavDemo.island";

type View = "alpha" | "beta";

const parseView = (value: string | undefined): View =>
  value === "beta" ? "beta" : "alpha";

export default ssr(async (c) => {
  c.get("page").title = "Navigation · @k2b/ssr";

  const initialView = parseView(c.req.query("view"));

  return () => (
    <ManualShell
      active="navigation"
      title="navigation"
      summary="Progressively enhanced links that preserve local island state."
    >
      <ManualSection label="NAME">
        <p>
          <strong>navigation</strong> — update the URL and visible dataset
          without replacing the document.
        </p>
      </ManualSection>

      <ManualSection label="DEMO">
        <NavDemoIsland initialView={initialView} />
      </ManualSection>

      <ManualSection label="BEHAVIOR">
        <p>
          Scroll the dataset, increment the counter and switch views. Browser
          Back and Forward reconcile the active view from the URL while the
          island keeps its local state.
        </p>
      </ManualSection>
    </ManualShell>
  );
});
