/**
 * Scroll reveal + stagger helpers (respects prefers-reduced-motion).
 */
(function initMotion() {
  const prefersReduced =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (prefersReduced) return;

  const autoRevealSelectors = [
    ".card",
    ".metric",
    ".schedule-item",
    ".stats-hero",
    ".group-scan-panel",
    ".wc-kpi",
    ".wc-match-card"
  ];

  document.querySelectorAll(autoRevealSelectors.join(",")).forEach((el, index) => {
    if (el.closest(".reveal-stagger")) return;
    el.classList.add("reveal-on-scroll");
    el.style.transitionDelay = `${Math.min(index * 0.06, 0.36)}s`;
  });

  const metricsRow = document.querySelector(".metrics-row, .stats-metrics");
  if (metricsRow) {
    metricsRow.classList.add("reveal-stagger");
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { rootMargin: "0px 0px -6% 0px", threshold: 0.08 }
  );

  document.querySelectorAll(".reveal-on-scroll").forEach((el) => observer.observe(el));
})();
