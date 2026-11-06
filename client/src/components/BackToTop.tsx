import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";

/**
 * Square red "back to top" arrow, bottom-left, that fades in once the shopper
 * has scrolled a screen's worth down (so it is always there by the time they
 * reach the footer). Bottom-left keeps it clear of the Ask CPulls chat.
 */
export function BackToTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setShow(window.scrollY > Math.max(480, window.innerHeight * 0.9));
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); if (raf) cancelAnimationFrame(raf); };
  }, []);
  return (
    <button
      type="button"
      className={`pc-totop ${show ? "is-show" : ""}`}
      onClick={() => window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })}
      aria-label="Back to top"
      title="Back to top"
      tabIndex={show ? 0 : -1}
      aria-hidden={!show}
      data-testid="button-back-to-top"
    >
      <ArrowUp className="h-5 w-5" strokeWidth={2.5} />
    </button>
  );
}
