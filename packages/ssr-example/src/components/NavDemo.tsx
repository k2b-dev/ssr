import { ssr } from "../../config";
import { ShowcaseSection, ShowcaseShell } from "./ShowcaseShell";
import NavDemoIsland from "./NavDemo.island";

type View = "alpha" | "beta";

const parseView = (value: string | undefined): View =>
  value === "beta" ? "beta" : "alpha";

export default ssr(async (c) => {
  c.get("page").title = "Navigation · @k2b/ssr";

  const initialView = parseView(c.req.query("view"));

  return () => (
    <ShowcaseShell
      active="navigation"
      title="Client navigation"
      summary="Change the URL and content without discarding island or scroll state."
    >
      <ShowcaseSection
        label="Live navigation"
        description="Increment, scroll and switch views. Then use browser Back and Forward."
        runtime="island"
      >
        <NavDemoIsland initialView={initialView} />
      </ShowcaseSection>

      <ShowcaseSection
        label="What this demonstrates"
        description="The links remain valid anchors before JavaScript loads."
      >
        <ul class="behavior-list">
          <li><strong>Real URLs</strong><span>Each view is addressable and reloadable.</span></li>
          <li><strong>History</strong><span>Back and Forward update the active view.</span></li>
          <li><strong>Preserved state</strong><span>Counter and keyed scroll regions survive navigation.</span></li>
        </ul>
      </ShowcaseSection>
    </ShowcaseShell>
  );
});
