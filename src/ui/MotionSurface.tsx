import type { PointerEvent, ReactNode } from "react";
import { useCallback, useLayoutEffect, useRef } from "react";

type RowSnapshot = { rect: DOMRect; node: HTMLElement };

export function MotionSurface({ scene, children }: { scene: string; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const previousScene = useRef(scene);
  const rows = useRef(new Map<string, RowSnapshot>());
  const animations = useRef<Animation[]>([]);
  const ghosts = useRef<HTMLElement[]>([]);

  const cancelAnimation = useCallback((animation: Animation) => {
    animation.finished.catch(() => undefined);
    try {
      animation.cancel();
    } catch {
      // Test DOMs can throw when an already-finished animation is cancelled.
    }
  }, []);

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const animate = (node: HTMLElement, frames: Keyframe[], duration = 380) => {
      if (!reduced && typeof node.animate === "function") {
        const animation = node.animate(frames, { duration, easing: "cubic-bezier(.2,.8,.2,1)" });
        animation.finished.catch(() => undefined);
        animations.current.push(animation);
      }
    };
    const sameScene = previousScene.current === scene;
    if (!sameScene) {
      animations.current.forEach((animation) => {
        cancelAnimation(animation);
      });
      animations.current = [];
      ghosts.current.forEach((ghost) => {
        ghost.remove();
      });
      ghosts.current = [];
      animate(
        element,
        [
          { opacity: 0, transform: "translateY(12px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        280,
      );
    }
    const next = new Map<string, RowSnapshot>();
    element.querySelectorAll<HTMLElement>("[data-motion-row]").forEach((node) => {
      const id = node.dataset.motionRow ?? "";
      const rect = node.getBoundingClientRect();
      const old = sameScene ? rows.current.get(id) : undefined;
      if (old) {
        const dy = old.rect.top - rect.top;
        if (Math.abs(dy) > 1)
          animate(node, [{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }]);
      } else if (sameScene && rows.current.size > 0) {
        animate(node, [
          { opacity: 0, transform: "translateY(-10px) scale(.97)" },
          { opacity: 1, transform: "translateY(0) scale(1)" },
        ]);
      }
      next.set(id, { rect, node: node.cloneNode(true) as HTMLElement });
    });
    if (sameScene && !reduced)
      rows.current.forEach((old, id) => {
        if (next.has(id) || !element.querySelector("[data-motion-row]")) return;
        const ghost = old.node;
        ghost.setAttribute("aria-hidden", "true");
        ghost.inert = true;
        Object.assign(ghost.style, {
          position: "fixed",
          pointerEvents: "none",
          zIndex: "10",
          margin: "0",
          top: `${old.rect.top}px`,
          left: `${old.rect.left}px`,
          width: `${old.rect.width}px`,
        });
        ghost.classList.add("pixel-row-ghost");
        document.body.append(ghost);
        ghosts.current.push(ghost);
        if (typeof ghost.animate === "function") {
          const exit = ghost.animate(
            [
              { opacity: 0.8, transform: "translateX(0)" },
              { opacity: 0, transform: "translateX(18px) scale(.96)" },
            ],
            { duration: 260, fill: "forwards" },
          );
          exit.onfinish = () => ghost.remove();
          exit.finished.catch(() => undefined);
          animations.current.push(exit);
        } else ghost.remove();
      });
    rows.current = next;
    previousScene.current = scene;
  });

  useLayoutEffect(
    () => () => {
      animations.current.forEach(cancelAnimation);
      ghosts.current.forEach((ghost) => {
        ghost.remove();
      });
    },
    [cancelAnimation],
  );

  function press(event: PointerEvent<HTMLDivElement>) {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>("button");
    if (
      !button ||
      button.disabled ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    )
      return;
    button.animate?.(
      [
        { transform: "translateY(0)" },
        { transform: "translateY(3px)" },
        { transform: "translateY(0)" },
      ],
      { duration: 180 },
    );
  }
  return (
    <div className="pixel-motion-surface" ref={root} onPointerDownCapture={press}>
      {children}
    </div>
  );
}
