import { createSignal, onCleanup, onMount } from "solid-js";

export default () => {
  const [size, setSize] = createSignal("...");

  onMount(() => {
    const update = () => setSize(`${window.innerWidth}x${window.innerHeight}`);
    update();
    window.addEventListener("resize", update);
    onCleanup(() => window.removeEventListener("resize", update));
  });

  return <output class="viewport-output" aria-label="Browser viewport">{size()}</output>;
};
