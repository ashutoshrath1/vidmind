"use client";

import { useEffect, useRef } from "react";

/** Rises into place on a spring the first time it scrolls into view; already in place under reduced motion. */
export default function Reveal({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      el.dataset.in = "";
      io.disconnect();
    }, { rootMargin: "0px 0px -10% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <div ref={box} data-reveal className={`spring ${className}`} style={{ transitionDelay: `${delay}ms` }}>{children}</div>;
}
