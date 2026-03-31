import { MODULE_NAME } from "./utils/constants";

type BarPosition = "left" | "right" | "top" | "bottom";

const DEFAULT_SIZES = {
  left: 200,
  right: 200,
  top: 180,
  bottom: 180,
} as const;

const HANDLE_THICKNESS = 4;
const HANDLE_LENGTH_RATIO = 0.6;
const SAVE_DEBOUNCE_MS = 400;
const OBSERVER_DEBOUNCE_MS = 80;

// State per bar instance
const handles = new WeakMap<HTMLElement, HTMLElement>();
const resizeObservers = new WeakMap<HTMLElement, ResizeObserver>();
const mutationObservers = new WeakMap<
  HTMLElement,
  { disconnect: () => void }
>();
const windowHandlers = new WeakMap<HTMLElement, () => void>();

// ── Helpers ──────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function debounce<F extends (...args: any[]) => void>(
  fn: F,
  delay: number,
): (...args: Parameters<F>) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: Parameters<F>) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      fn(...args);
    }, delay);
  };
}

function getPosition(bar: HTMLElement): BarPosition | null {
  if (bar.classList.contains("left")) return "left";
  if (bar.classList.contains("right")) return "right";
  if (bar.classList.contains("top")) return "top";
  if (bar.classList.contains("bottom")) return "bottom";
  return null;
}

function isVertical(pos: BarPosition): boolean {
  return pos === "left" || pos === "right";
}

function innerEdge(
  pos: BarPosition,
): "right" | "left" | "bottom" | "top" {
  const map = {
    left: "right" as const,
    right: "left" as const,
    top: "bottom" as const,
    bottom: "top" as const,
  };
  return map[pos];
}

function isMinimized(bar: HTMLElement): boolean {
  return bar.classList.contains("minimized");
}

function getBarZIndex(bar: HTMLElement): number {
  const z = parseInt(window.getComputedStyle(bar).zIndex);
  return isNaN(z) ? 60 : z;
}

function loadSize(pos: BarPosition): number {
  try {
    const sizes = game.settings?.get(MODULE_NAME, "savedBarSizes");
    const val = sizes?.[pos];
    return typeof val === "number" ? val : DEFAULT_SIZES[pos];
  } catch {
    return DEFAULT_SIZES[pos];
  }
}

const saveSize = debounce((pos: BarPosition, size: number) => {
  try {
    const sizes = Object.assign(
      {},
      game.settings?.get(MODULE_NAME, "savedBarSizes"),
    );
    sizes[pos] = size;
    void game.settings?.set(MODULE_NAME, "savedBarSizes", sizes);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(MODULE_NAME + " | save bar size error:", e);
  }
}, SAVE_DEBOUNCE_MS);

// ── Size application ─────────────────────────────────────────

/**
 * Applies CSS custom properties --av-width / --av-height to the bar.
 * Foundry v13 uses these variables to size individual .camera-view tiles.
 * We use a fixed 4:3 aspect ratio to compute the dependent dimension.
 */
function applyCameraSize(bar: HTMLElement, pos: BarPosition, size: number): void {
  const RATIO_W = 4;
  const RATIO_H = 3;

  if (isVertical(pos)) {
    // size = bar width → camera tile width; compute height from aspect ratio
    bar.style.setProperty("--av-width", String(size) + "px");
    bar.style.setProperty(
      "--av-height",
      String(Math.round((size * RATIO_H) / RATIO_W)) + "px",
    );
  } else {
    // size = bar height → camera tile height; compute width from aspect ratio
    bar.style.setProperty("--av-height", String(size) + "px");
    bar.style.setProperty(
      "--av-width",
      String(Math.round((size * RATIO_W) / RATIO_H)) + "px",
    );
  }
}

function applySize(
  bar: HTMLElement,
  pos: BarPosition,
  size: number,
): void {
  if (isMinimized(bar)) return;
  if (isVertical(pos)) {
    bar.style.width = String(size) + "px";
  } else {
    bar.style.height = String(size) + "px";
  }
  applyCameraSize(bar, pos, size);
}

function clearInlineSize(bar: HTMLElement): void {
  bar.style.width = "";
  bar.style.height = "";
  bar.style.removeProperty("--av-width");
  bar.style.removeProperty("--av-height");
}

// ── Handle positioning ───────────────────────────────────────

function positionHandle(bar: HTMLElement, handle: HTMLElement): void {
  const pos = getPosition(bar);
  if (!pos) return;

  if (isMinimized(bar)) {
    handle.style.display = "none";
    return;
  }
  handle.style.display = "";

  const edge = innerEdge(pos);
  const rect = bar.getBoundingClientRect();
  handle.style.zIndex = String(getBarZIndex(bar) + 1);

  if (edge === "right") {
    const len = Math.round(rect.height * HANDLE_LENGTH_RATIO);
    handle.style.left = String(rect.right - HANDLE_THICKNESS) + "px";
    handle.style.top =
      String(rect.top + rect.height / 2 - len / 2) + "px";
    handle.style.width = String(HANDLE_THICKNESS) + "px";
    handle.style.height = String(len) + "px";
    handle.style.cursor = "ew-resize";
  } else if (edge === "left") {
    const len = Math.round(rect.height * HANDLE_LENGTH_RATIO);
    handle.style.left = String(rect.left) + "px";
    handle.style.top =
      String(rect.top + rect.height / 2 - len / 2) + "px";
    handle.style.width = String(HANDLE_THICKNESS) + "px";
    handle.style.height = String(len) + "px";
    handle.style.cursor = "ew-resize";
  } else if (edge === "bottom") {
    const len = Math.round(rect.width * HANDLE_LENGTH_RATIO);
    handle.style.left =
      String(rect.left + rect.width / 2 - len / 2) + "px";
    handle.style.top = String(rect.bottom - HANDLE_THICKNESS) + "px";
    handle.style.width = String(len) + "px";
    handle.style.height = String(HANDLE_THICKNESS) + "px";
    handle.style.cursor = "ns-resize";
  } else {
    // top
    const len = Math.round(rect.width * HANDLE_LENGTH_RATIO);
    handle.style.left =
      String(rect.left + rect.width / 2 - len / 2) + "px";
    handle.style.top = String(rect.top) + "px";
    handle.style.width = String(len) + "px";
    handle.style.height = String(HANDLE_THICKNESS) + "px";
    handle.style.cursor = "ns-resize";
  }
}

// ── Handle creation ──────────────────────────────────────────

function createHandle(bar: HTMLElement): void {
  handles.get(bar)?.remove();

  const pos = getPosition(bar);
  if (!pos) return;

  const handle = document.createElement("div");
  handle.className = "lk-resize-handle";
  handle.title =
    game.i18n?.localize("LIVEKITAVCLIENT.resizeHandleTooltip") ??
    "Drag to resize";
  handle.style.opacity = "0";

  handle.addEventListener("mouseenter", () => {
    handle.style.opacity = "0.7";
  });
  handle.addEventListener("mouseleave", () => {
    handle.style.opacity = "0";
  });

  // Double-click to reset to default size
  handle.addEventListener("dblclick", (e) => {
    e.preventDefault();
    const p = getPosition(bar);
    if (!p) return;
    const def = DEFAULT_SIZES[p];
    applySize(bar, p, def);
    saveSize(p, def);
    positionHandle(bar, handle);
  });

  // Drag to resize
  handle.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();

    const p = getPosition(bar);
    if (!p) return;
    const settings = game.settings;
    if (!settings) return;
    const vert = isVertical(p);
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = bar.offsetWidth;
    const startH = bar.offsetHeight;
    const minSize = Number(
      settings.get(MODULE_NAME, "resizableBarMinSize"),
    );
    const maxW = Number(
      settings.get(MODULE_NAME, "resizableBarMaxWidth"),
    );
    const maxH = Number(
      settings.get(MODULE_NAME, "resizableBarMaxHeight"),
    );
    let rafPending = false;

    const onMove = (ev: MouseEvent) => {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        let newSize: number;
        if (vert) {
          const dx =
            p === "left" ? ev.clientX - startX : startX - ev.clientX;
          newSize = Math.min(maxW, Math.max(minSize, startW + dx));
          bar.style.width = String(newSize) + "px";
        } else {
          const dy =
            p === "top" ? ev.clientY - startY : startY - ev.clientY;
          newSize = Math.min(maxH, Math.max(minSize, startH + dy));
          bar.style.height = String(newSize) + "px";
        }
        applyCameraSize(bar, p, newSize);
        saveSize(p, newSize);
        positionHandle(bar, handle);
      });
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  document.body.appendChild(handle);
  positionHandle(bar, handle);
  handles.set(bar, handle);
}

// ── Cleanup ──────────────────────────────────────────────────

function cleanupObservers(bar: HTMLElement): void {
  resizeObservers.get(bar)?.disconnect();
  mutationObservers.get(bar)?.disconnect();
  const wh = windowHandlers.get(bar);
  if (wh) window.removeEventListener("resize", wh);
}

// ── Main init ────────────────────────────────────────────────

const MAX_INIT_RETRIES = 20;

function initBar(bar: HTMLElement, retries = 0): void {
  if (bar.id !== "camera-views") return;

  const pos = getPosition(bar);
  if (!pos) {
    if (retries >= MAX_INIT_RETRIES) {
      // eslint-disable-next-line no-console
      console.warn(
        MODULE_NAME +
          " | resizableBar: position class never appeared, giving up.",
      );
      return;
    }
    setTimeout(() => {
      initBar(bar, retries + 1);
    }, 150);
    return;
  }

  cleanupObservers(bar);

  if (!isMinimized(bar)) {
    applySize(bar, pos, loadSize(pos));
  }

  createHandle(bar);

  // Reposition handle on window resize
  const onWinResize = debounce(() => {
    const h = handles.get(bar);
    if (h) positionHandle(bar, h);
  }, 60);
  window.addEventListener("resize", onWinResize);
  windowHandlers.set(bar, onWinResize);

  // Watch for class changes (minimize/dock position)
  const moClass = new MutationObserver(
    debounce(() => {
      if (isMinimized(bar)) {
        clearInlineSize(bar);
        const h = handles.get(bar);
        if (h) positionHandle(bar, h);
      } else {
        const newPos = getPosition(bar);
        if (!newPos) return;
        createHandle(bar);
        applySize(bar, newPos, loadSize(newPos));
      }
    }, OBSERVER_DEBOUNCE_MS),
  );
  moClass.observe(bar, { attributes: true, attributeFilter: ["class"] });
  mutationObservers.set(bar, moClass);

  // Watch for size changes to reposition handle
  const ro = new ResizeObserver(
    debounce(() => {
      const h = handles.get(bar);
      if (h) positionHandle(bar, h);
    }, 60),
  );
  ro.observe(bar);
  resizeObservers.set(bar, ro);
}

// ── Public API ───────────────────────────────────────────────

export function initResizableBar(cameraViewsElement: HTMLElement): void {
  const enabled = game.settings?.get(MODULE_NAME, "resizableBar");
  if (!enabled) return;

  const bar =
    cameraViewsElement.id === "camera-views"
      ? cameraViewsElement
      : cameraViewsElement.querySelector<HTMLElement>("#camera-views");
  if (bar) initBar(bar);
}
