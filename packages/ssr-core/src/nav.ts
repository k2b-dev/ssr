/**
 * Opt-in browser navigation helpers for SSR islands.
 *
 * This is not a router. Links remain real anchors and apps decide whether an
 * enhanced click can update client state before committing browser history.
 */
import { mergeProps, splitProps, type JSX } from "solid-js";
import { createDynamic } from "solid-js/web";

type AnchorProps = JSX.AnchorHTMLAttributes<HTMLAnchorElement>;

export type NavigationScrollMode = "top" | "preserve" | "manual";

export type ScrollSnapshot = {
  window: { x: number; y: number };
  regions: Array<{
    key: string;
    x: number;
    y: number;
  }>;
};

export type EnhancedNavigateOptions = {
  replace?: boolean;
  scroll?: NavigationScrollMode;
  scrollSnapshot?: ScrollSnapshot;
  state?: unknown;
  viewTransition?: boolean;
};

export type PopStateNavigationEvent = {
  event: PopStateEvent;
  url: URL;
  state: unknown;
};

export type LinkNavigateEvent = {
  event: MouseEvent;
  href: string;
  url: URL;
  replace: boolean;
  scroll: NavigationScrollMode;
  push: (href?: string, options?: EnhancedNavigateOptions) => void;
  replaceWith: (href?: string, options?: Omit<EnhancedNavigateOptions, "replace">) => void;
  fallback: (href?: string) => void;
  scrollSnapshot: ScrollSnapshot;
  captureScroll: (selector?: string) => ScrollSnapshot;
  restoreScroll: typeof restoreScroll;
};

export type LinkProps = Omit<AnchorProps, "href" | "onClick"> & {
  href: string;
  /** Default history mode for enhanced clicks. Ignored without `onNavigate`. */
  replace?: boolean;
  /** Default scroll mode for enhanced clicks. Ignored without `onNavigate`. */
  scroll?: NavigationScrollMode;
  onClick?: JSX.EventHandlerUnion<HTMLAnchorElement, MouseEvent>;
  /** Enables enhanced same-origin clicks. Without it, `Link` is a native anchor. */
  onNavigate?: (event: LinkNavigateEvent) => void | Promise<void>;
};

const SCROLL_PRESERVE_SELECTOR = "[data-scroll-preserve]";

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void | Promise<void>) => unknown;
};

/**
 * Returns the current URL path + query, without the hash.
 */
export const currentPathWithQuery = (): string => {
  const url = new URL(window.location.href);
  return `${url.pathname}${url.search}`;
};

/**
 * Navigates to the current path + query with a full document navigation.
 */
export const refreshCurrentPath = (): void => {
  window.location.assign(currentPathWithQuery());
};

/**
 * Navigates with a full document navigation.
 */
export const navigateTo = (href: string): void => {
  window.location.assign(href);
};

export const startViewTransition = (callback: () => void | Promise<void>): void => {
  const doc = document as ViewTransitionDocument;
  if (!doc.startViewTransition) {
    void callback();
    return;
  }
  doc.startViewTransition(callback);
};

const restoreRegionScroll = (snapshot: ScrollSnapshot): void => {
  for (const region of snapshot.regions) {
    const selector = `[data-scroll-preserve="${CSS.escape(region.key)}"]`;
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) continue;
    el.scrollLeft = region.x;
    el.scrollTop = region.y;
  }
};

/**
 * Captures window scroll and keyed `[data-scroll-preserve]` regions.
 */
export const captureScroll = (selector = SCROLL_PRESERVE_SELECTOR): ScrollSnapshot => ({
  window: { x: window.scrollX, y: window.scrollY },
  regions: Array.from(document.querySelectorAll<HTMLElement>(selector))
    .map((el) => ({
      key: el.dataset.scrollPreserve ?? "",
      x: el.scrollLeft,
      y: el.scrollTop,
    }))
    .filter((region) => region.key.length > 0),
});

/**
 * Restores a captured scroll snapshot.
 */
export const restoreScroll = (snapshot: ScrollSnapshot, options: { window?: boolean } = {}): void => {
  restoreRegionScroll(snapshot);
  if (options.window === false) return;
  window.scrollTo(snapshot.window.x, snapshot.window.y);
};

/**
 * Subscribes to browser Back/Forward navigation.
 *
 * The application remains responsible for reconciling its island state with
 * the URL. This helper intentionally does not perform route matching.
 */
export const listenPopState = (handler: (navigation: PopStateNavigationEvent) => void): (() => void) => {
  const listener = (event: PopStateEvent) => {
    handler({ event, url: new URL(window.location.href), state: event.state });
  };

  window.addEventListener("popstate", listener);
  return () => window.removeEventListener("popstate", listener);
};

const resolveNavigationUrl = (href: string): URL =>
  new URL(href, document.baseURI || window.location.href);

/**
 * Updates browser history without a document reload.
 *
 * Use this after the current island has already updated its UI or when it is
 * intentionally preserving the current DOM. It does not match routes, load
 * data, or re-render server pages.
 */
export const navigate = (href: string, options: EnhancedNavigateOptions = {}): void => {
  const url = resolveNavigationUrl(href);
  if (url.origin !== window.location.origin) {
    documentNavigate(url.href, { replace: options.replace });
    return;
  }

  const scroll = options.scroll ?? "top";
  const snapshot = scroll === "manual" ? null : (options.scrollSnapshot ?? captureScroll());
  const target = `${url.pathname}${url.search}${url.hash}`;

  const commit = () => {
    const hasExplicitState = Object.prototype.hasOwnProperty.call(options, "state");
    const state = hasExplicitState ? options.state : options.replace ? window.history.state : null;

    if (options.replace) window.history.replaceState(state, "", target);
    else window.history.pushState(state, "", target);

    if (!snapshot) return;
    restoreRegionScroll(snapshot);
    if (scroll === "preserve") {
      window.scrollTo(snapshot.window.x, snapshot.window.y);
      return;
    }
    window.scrollTo(0, 0);
  };

  if (options.viewTransition === false) {
    commit();
    return;
  }
  startViewTransition(commit);
};

export const documentNavigate = (href: string, options: { replace?: boolean } = {}): void => {
  if (options.replace) window.location.replace(href);
  else window.location.assign(href);
};

const shouldEnhanceClick = (event: MouseEvent, anchor: HTMLAnchorElement): boolean => {
  if (event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (anchor.target && anchor.target !== "_self") return false;
  if (anchor.hasAttribute("download")) return false;

  const url = new URL(anchor.href);
  return url.origin === window.location.origin;
};

const callUserClick = (handler: LinkProps["onClick"], event: MouseEvent, anchor: HTMLAnchorElement): void => {
  if (!handler) return;
  const typedEvent = event as MouseEvent & { currentTarget: HTMLAnchorElement; target: Element };

  if (Array.isArray(handler)) {
    handler[0].call(anchor, handler[1], typedEvent);
    return;
  }

  if (typeof handler === "function") {
    handler.call(anchor, typedEvent);
  }
};

/**
 * SSR-safe anchor with opt-in progressive navigation.
 */
export function Link(props: LinkProps) {
  const [local, anchorProps] = splitProps(props, ["href", "replace", "scroll", "onNavigate", "onClick"]);

  const handleClick: JSX.EventHandler<HTMLAnchorElement, MouseEvent> = (event) => {
    callUserClick(local.onClick, event, event.currentTarget);
    const onNavigate = local.onNavigate;
    if (!onNavigate) return;
    if (!shouldEnhanceClick(event, event.currentTarget)) return;

    const href = local.href;
    const url = new URL(event.currentTarget.href);

    const scroll = local.scroll ?? "top";
    const replace = Boolean(local.replace);
    const scrollSnapshot = captureScroll();

    event.preventDefault();

    let navigationOutcome: "none" | "history" | "document" = "none";
    const runNavigation = async () => {
      try {
        await onNavigate({
          event,
          href,
          url,
          replace,
          scroll,
          push: (nextHref = url.href, options = {}) => {
            navigate(nextHref, {
              ...options,
              replace: false,
              scroll: options.scroll ?? scroll,
              scrollSnapshot: options.scrollSnapshot ?? scrollSnapshot,
              viewTransition: false,
            });
            navigationOutcome = "history";
          },
          replaceWith: (nextHref = url.href, options = {}) => {
            navigate(nextHref, {
              ...options,
              replace: true,
              scroll: options.scroll ?? scroll,
              scrollSnapshot: options.scrollSnapshot ?? scrollSnapshot,
              viewTransition: false,
            });
            navigationOutcome = "history";
          },
          fallback: (nextHref = url.href) => {
            documentNavigate(resolveNavigationUrl(nextHref).href, { replace });
            navigationOutcome = "document";
          },
          scrollSnapshot,
          captureScroll,
          restoreScroll,
        });
      } catch (error) {
        console.error("[@k2b/ssr/nav] onNavigate failed; falling back to document navigation.", error);
        if (navigationOutcome === "document") return;
        const historyCommitted = navigationOutcome === "history";
        const fallbackHref = historyCommitted ? window.location.href : url.href;
        documentNavigate(fallbackHref, { replace: historyCommitted || replace });
      }
    };

    startViewTransition(runNavigation);
  };

  return createDynamic(
    () => "a",
    mergeProps(anchorProps, {
      get href() {
        return local.href;
      },
      onClick: handleClick,
    }),
  );
}
