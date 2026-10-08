import type { Component } from "solid-js";
import { createComponent, ErrorBoundary, render } from "solid-js/web";
import { deserialize } from "seroval";

/** Props received by a configured island error fallback component. */
export type IslandErrorProps = {
  error: unknown;
  reset: () => void;
};

const defaultFallback = (reset: () => void): HTMLDivElement => {
  const alert = document.createElement("div");
  alert.setAttribute("role", "alert");
  alert.setAttribute("data-ssr-error", "");
  alert.append("This part of the page could not be displayed. ");
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Try again";
  button.addEventListener("click", reset);
  alert.append(button);
  return alert;
};

const report = (element: HTMLElement, error: unknown, reset: () => void): void => {
  const event = new CustomEvent("ssr:island-error", {
    bubbles: true,
    cancelable: true,
    detail: { error, id: element.dataset.id, reset },
  });
  if (element.dispatchEvent(event)) globalThis.reportError(error);
};

/** Mount each island/client instance in its own error boundary. */
export const mount = <Props extends object>(
  Component: Component<Props>,
  selector: string,
  Fallback?: Component<IslandErrorProps>,
): void => {
  document.querySelectorAll<HTMLElement>(selector).forEach((element) => {
    const mountElement = (): void => {
      try {
        element.innerHTML = "";
        render(() => createComponent(ErrorBoundary, {
          fallback: (error: unknown, reset: () => void) => {
            report(element, error, reset);
            if (!Fallback) return defaultFallback(reset);
            return createComponent(ErrorBoundary, {
              fallback: (fallbackError: unknown) => {
                globalThis.reportError(fallbackError);
                return defaultFallback(reset);
              },
              get children() {
                return createComponent(Fallback, { error, reset });
              },
            });
          },
          get children() {
            return createComponent(Component, deserialize<Props>(element.dataset.props || "{}"));
          },
        }), element);
      } catch (error) {
        report(element, error, mountElement);
        element.replaceChildren(defaultFallback(mountElement));
      }
    };
    mountElement();
  });
};
