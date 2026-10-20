import { useCallback, useEffect, useRef } from "react";

/** 鼠标按住拖动超过这个距离才算拖拽，否则仍按点击处理 */
const DRAG_THRESHOLD = 4;

function attachHorizontalScroll(el: HTMLElement): () => void {
  const onWheel = (e: WheelEvent) => {
    const max = el.scrollWidth - el.clientWidth;
    if (max <= 0) return;
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (!delta) return;
    const atStart = delta < 0 && el.scrollLeft <= 0;
    const atEnd = delta > 0 && el.scrollLeft >= max;
    if (atStart || atEnd) return;
    e.preventDefault();
    el.scrollLeft += delta;
  };

  let dragging = false;
  let moved = false;
  let startX = 0;
  let startLeft = 0;

  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    if (!moved) {
      if (Math.abs(dx) < DRAG_THRESHOLD) return;
      moved = true;
      el.style.cursor = "grabbing";
    }
    el.scrollLeft = startLeft - dx;
  };

  const onUp = () => {
    dragging = false;
    el.style.cursor = "";
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 || e.pointerType !== "mouse") return;
    if (el.scrollWidth <= el.clientWidth) return;
    dragging = true;
    moved = false;
    startX = e.clientX;
    startLeft = el.scrollLeft;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // 拖拽结束的那次点击不应触发按钮：拖过就吞掉紧随其后的 click
  const onClickCapture = (e: MouseEvent) => {
    if (!moved) return;
    e.stopPropagation();
    e.preventDefault();
    moved = false;
  };

  el.addEventListener("wheel", onWheel, { passive: false });
  el.addEventListener("pointerdown", onDown);
  el.addEventListener("click", onClickCapture, true);

  return () => {
    el.removeEventListener("wheel", onWheel);
    el.removeEventListener("pointerdown", onDown);
    el.removeEventListener("click", onClickCapture, true);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };
}

/**
 * 让一条横向滚动的容器支持鼠标拖拽与滚轮横向滚动。
 *
 * 返回回调 ref：容器挂载、卸载或被替换时自动绑定 / 解绑监听，
 * 所以即使容器处在会条件渲染的分支里也没问题。
 */
export function useHorizontalScroll<T extends HTMLElement = HTMLDivElement>() {
  const cleanupRef = useRef<(() => void) | null>(null);

  const ref = useCallback((el: T | null) => {
    cleanupRef.current?.();
    cleanupRef.current = el ? attachHorizontalScroll(el) : null;
  }, []);

  useEffect(
    () => () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    },
    [],
  );

  return ref;
}
