import { createSignal, onMount, onCleanup } from "solid-js";

export default ({ initial = 0 }: { initial?: number }) => {
  const [count, setCount] = createSignal(initial);

  onMount(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "+") setCount((c) => c + 1);
      if (e.key === "-") setCount((c) => c - 1);
      if (e.key === "0") setCount(0);
    };
    window.addEventListener("keydown", handler);
    onCleanup(() => window.removeEventListener("keydown", handler));
  });

  return (
    <div class="counter">
      <button
        type="button"
        aria-label="Decrease counter"
        onClick={() => setCount((c) => c - 1)}
      >
        −
      </button>
      <output aria-label={`Counter value ${count()}`}>
        {count()}
      </output>
      <button
        type="button"
        aria-label="Increase counter"
        onClick={() => setCount((c) => c + 1)}
      >
        +
      </button>
    </div>
  );
};
