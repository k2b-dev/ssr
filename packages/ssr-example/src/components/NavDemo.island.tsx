import { Link, listenPopState, type LinkNavigateEvent } from "@k2b/ssr/nav";
import { createMemo, createSignal, For, onCleanup, onMount } from "solid-js";

type View = "alpha" | "beta";

type Props = {
  initialView: View;
};

const isView = (value: string | null): value is View =>
  value === "alpha" || value === "beta";

export default function NavDemo(props: Props) {
  const [view, setView] = createSignal<View>(props.initialView);
  const [count, setCount] = createSignal(0);
  const [scrollTop, setScrollTop] = createSignal(0);
  const [lastEvent, setLastEvent] = createSignal(`load:${props.initialView}`);

  const items = createMemo(() =>
    Array.from({ length: 36 }, (_, index) => ({
      id: `${view()}-${index + 1}`,
      label: `${view() === "alpha" ? "Alpha" : "Beta"} row ${index + 1}`,
    })),
  );

  onMount(() => {
    onCleanup(
      listenPopState(({ url }) => {
        const nextView =
          url.searchParams.get("view") === "beta" ? "beta" : "alpha";
        setView(nextView);
        setLastEvent(`pop:${nextView}`);
      }),
    );
  });

  const openView = (nav: LinkNavigateEvent) => {
    const nextView = nav.url.searchParams.get("view");
    if (!isView(nextView)) {
      nav.fallback();
      return;
    }
    const changed = nextView !== view();
    setView(nextView);
    if (!changed) {
      nav.replaceWith(`/nav-demo?view=${nextView}`, { scroll: "preserve" });
      setLastEvent(`replace:${nextView}`);
      return;
    }
    nav.push(`/nav-demo?view=${nextView}`, { scroll: "preserve" });
    setLastEvent(`push:${nextView}`);
  };

  return (
    <div class="navigation-demo">
      <div class="navigation-demo__controls">
        <nav class="view-tabs" aria-label="Dataset view">
          <Link
            href="/nav-demo?view=alpha"
            scroll="preserve"
            onNavigate={openView}
            class={view() === "alpha" ? "is-active" : undefined}
            aria-current={view() === "alpha" ? "page" : undefined}
          >
            alpha
          </Link>
          <Link
            href="/nav-demo?view=beta"
            scroll="preserve"
            onNavigate={openView}
            class={view() === "beta" ? "is-active" : undefined}
            aria-current={view() === "beta" ? "page" : undefined}
          >
            beta
          </Link>
        </nav>

        <button
          type="button"
          onClick={() => {
            setCount((value) => value + 1);
            setLastEvent("state:increment");
          }}
          class="count-button"
        >
          Increment <output aria-label={`Counter value ${count()}`}>{count()}</output>
        </button>
      </div>

      <dl class="navigation-demo__status" aria-live="polite">
        <div>
          <dt>view</dt>
          <dd>{view()}</dd>
        </div>
        <div>
          <dt>scroll</dt>
          <dd>{Math.round(scrollTop())} px</dd>
        </div>
        <div>
          <dt>last event</dt>
          <dd>{lastEvent()}</dd>
        </div>
      </dl>

      <div
        data-scroll-preserve="nav-demo-list"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        class="nav-demo-scroll"
        tabindex="0"
        aria-label={`${view()} dataset`}
      >
        <For each={items()}>
          {(item, index) => (
            <div class="dataset-row">
              <code>{(index() + 1).toString().padStart(2, "0")}</code>
              <strong>{item.label}</strong>
              <span>preserved scroll region</span>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
