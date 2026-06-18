import { useCallback, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";

import "./GraphCanvas.css";

import { useGraph } from "../../state/graphStore";
import { computeGraphLayout } from "../../lib/graphLayout";
import { GraphNode } from "./GraphNode";

/** Pan/zoom transform state of the inner layer. */
interface ViewTransform {
  /** Horizontal pan offset in screen pixels. */
  x: number;
  /** Vertical pan offset in screen pixels. */
  y: number;
  /** Zoom scale, clamped to [MIN_SCALE, MAX_SCALE]. */
  scale: number;
}

const MIN_SCALE = 0.25;
const MAX_SCALE = 2.5;
const ZOOM_STEP = 0.0015;

const INITIAL_TRANSFORM: ViewTransform = { x: 0, y: 0, scale: 1 };

const clampScale = (scale: number) =>
  Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

export interface GraphCanvasProps {
  /**
   * Stable activation hook forwarded to every node for wi-07 to attach actions.
   * Unused by this item beyond plumbing.
   */
  onActivateNode?: (nodeId: string) => void;
}

/**
 * The sessions-graph renderer mounted into wi-05's container slot.
 *
 * It subscribes the wi-04 store via {@link useGraph} (so the graph reflects
 * store updates live with no manual refresh), runs the pure {@link
 * computeGraphLayout} — memoized on tree identity so panning/zooming never
 * re-lays-out — and renders an SVG edge layer plus one {@link GraphNode} per
 * node inside a single CSS-transform layer. Wheel = zoom (clamped), drag = pan;
 * the transform is the ONLY thing that changes on interaction, keeping it
 * GPU-composited and cheap with dozens of nodes.
 *
 * No interactions beyond pan/zoom live here — click/pause/kill are wi-07, wired
 * through `onActivateNode`.
 */
export function GraphCanvas({ onActivateNode }: GraphCanvasProps) {
  const roots = useGraph();
  // Memoized on forest identity: the engine replaces `roots` on any change, so
  // a new layout is computed exactly when the tree changes — never on pan/zoom.
  const layout = useMemo(() => computeGraphLayout(roots), [roots]);

  const [transform, setTransform] = useState<ViewTransform>(INITIAL_TRANSFORM);
  // Active pointer drag (pan). Tracked in a ref so the move handler does not
  // re-subscribe on every frame.
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(
    null,
  );
  const surfaceRef = useRef<HTMLDivElement>(null);

  const onWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    // Zoom toward the cursor: keep the point under the pointer fixed as scale
    // changes, so zooming feels anchored rather than drifting to the origin.
    const surface = surfaceRef.current;
    if (!surface) return;
    const rect = surface.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;

    setTransform((prev) => {
      const nextScale = clampScale(prev.scale * (1 - event.deltaY * ZOOM_STEP));
      if (nextScale === prev.scale) return prev;
      const ratio = nextScale / prev.scale;
      return {
        scale: nextScale,
        x: px - (px - prev.x) * ratio,
        y: py - (py - prev.y) * ratio,
      };
    });
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      // Only start a pan from the surface/background, never from a node button
      // (so wi-07's node clicks are not swallowed by a drag).
      if ((event.target as HTMLElement).closest(".graph-node")) return;
      const surface = surfaceRef.current;
      if (!surface) return;
      surface.setPointerCapture(event.pointerId);
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: transform.x,
        originY: transform.y,
      };
    },
    [transform.x, transform.y],
  );

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    setTransform((prev) => ({ ...prev, x: drag.originX + dx, y: drag.originY + dy }));
  }, []);

  const endDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    surfaceRef.current?.releasePointerCapture(event.pointerId);
    dragRef.current = null;
  }, []);

  return (
    <div
      ref={surfaceRef}
      className="graph-canvas"
      data-testid="graph-canvas"
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div
        className="graph-canvas-layer"
        data-testid="graph-canvas-layer"
        style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
        }}
      >
        <svg
          className="graph-edges"
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          aria-hidden="true"
        >
          {layout.edges.map((edge) => {
            const from = layout.nodes.find((n) => n.node.id === edge.fromId);
            const to = layout.nodes.find((n) => n.node.id === edge.toId);
            if (!from || !to) return null;
            return (
              <path
                key={`${edge.fromId}->${edge.toId}`}
                className="graph-edge"
                // A smooth vertical S-curve between tiers reads cleaner than a
                // straight diagonal for a top-down tree.
                d={`M ${from.x} ${from.y} C ${from.x} ${(from.y + to.y) / 2}, ${to.x} ${(from.y + to.y) / 2}, ${to.x} ${to.y}`}
                fill="none"
              />
            );
          })}
        </svg>

        {layout.nodes.map((positioned) => (
          <GraphNode
            key={positioned.node.id}
            node={positioned.node}
            x={positioned.x}
            y={positioned.y}
            onActivate={onActivateNode}
          />
        ))}
      </div>

      {layout.nodes.length === 0 && (
        <p className="graph-canvas-empty" data-testid="graph-canvas-empty">
          No sessions yet.
        </p>
      )}
    </div>
  );
}

export default GraphCanvas;
