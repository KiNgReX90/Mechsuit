import "@testing-library/jest-dom/vitest";

// jsdom does not implement PointerEvent. The sidebar's drag-to-reorder is driven
// entirely by pointer events, so without this polyfill `fireEvent.pointer*`
// produces events missing `clientX/clientY` and `button` — the drag gesture
// never starts and its tests can't exercise the real interaction. MouseEvent
// (which jsdom does implement) already carries those fields, so extend it and
// layer the pointer-specific props on top.
if (typeof window.PointerEvent === "undefined") {
  class PointerEvent extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly isPrimary: boolean;

    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
      this.pointerType = params.pointerType ?? "mouse";
      this.isPrimary = params.isPrimary ?? true;
    }
  }

  window.PointerEvent = PointerEvent as unknown as typeof window.PointerEvent;
  globalThis.PointerEvent =
    PointerEvent as unknown as typeof globalThis.PointerEvent;
}
