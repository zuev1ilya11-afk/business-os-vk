import { useEffect, useState } from "react";
import { useRouter } from "next/router";

/** Progressive enhancement: the SSR page is always visible and usable.
 * Nothing is hidden while JavaScript, images or the observer load. */
export default function SiteMotion() {
  const router = useRouter();
  const [showLoader, setShowLoader] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (media.matches) return;
    let first = true;
    try {
      first = !sessionStorage.getItem("hm-intro-shown-v2");
      if (first) sessionStorage.setItem("hm-intro-shown-v2", "1");
    } catch { /* Storage may be unavailable. */ }
    if (!first) return;
    setShowLoader(true);
    const timer = window.setTimeout(() => setShowLoader(false), 720);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduced.matches) return;
    const main = document.querySelector("#main");
    if (!main) return;
    const selectors = [
      "[data-reveal]", "[data-stagger]",
      ".hm-approved-section", ".hm-profile", ".hm-facade-highlight",
      ".hm-approved-gallery", ".hm-approved-process", ".hm-approved-partners",
      ".hm-approved-contact", ".hm-page-intro", ".hm-facade-hero",
      ".hm-facade-process", ".hm-contact-band", ".hm-prose"
    ].join(",");
    const elements = Array.from(main.querySelectorAll<HTMLElement>(selectors));
    // Animate only as elements enter the viewport. Offscreen content is never
    // kept invisible, even if the observer is unavailable or the page is printed.
    const observer = "IntersectionObserver" in window ? new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        (entry.target as HTMLElement).classList.add("hm-entered");
        observer?.unobserve(entry.target);
      }
    }, { rootMargin: "0px 0px 32px 0px", threshold: 0.04 }) : null;
    elements.forEach(element => {
      if (element.closest(".hm-approved-hero")) return;
      if (element.parentElement?.closest("[data-reveal], [data-stagger]") &&
          !element.hasAttribute("data-stagger")) return;
      observer?.observe(element);
    });
    const hero = main.querySelector<HTMLElement>(".hm-hero-photo");
    let frame = 0;
    const desktop = window.matchMedia("(min-width: 1000px) and (pointer: fine)");
    const update = () => {
      frame = 0;
      if (!hero) return;
      const distance = !reduced.matches && desktop.matches ? Math.min(56, Math.max(0, window.scrollY * 0.08)) : 0;
      hero.style.setProperty("--hm-parallax", distance + "px");
    };
    const scroll = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    if (hero) {
      window.addEventListener("scroll", scroll, {passive: true});
      window.addEventListener("resize", scroll, {passive: true});
      reduced.addEventListener?.("change", scroll);
      update();
    }
    return () => {
      observer?.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", scroll);
      window.removeEventListener("resize", scroll);
      reduced.removeEventListener?.("change", scroll);
      hero?.style.removeProperty("--hm-parallax");
    };
  }, [router.asPath]);
  return showLoader ? <div className="hm-intro-motion" aria-hidden="true"><div className="hm-intro-line"/><div className="hm-intro-brand"><img src="/brand-house.svg" width="33" height="33" alt=""/><span>Домашний мастер</span></div></div> : null;
}
