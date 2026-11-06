"use strict";
const crypto = require("node:crypto");
const shared = require("../../service-catalog.js");
function source(ref) {
  if (typeof ref !== "string") return null;
  if (ref.startsWith("standard:")) {
    const x = shared.standard.find((s) => s.id === ref.slice(9));
    return x
      ? {
          id: ref,
          name: x.n,
          unit: x.u || "шт.",
          price: x.p,
          mode: "fixed",
          version: shared.version,
        }
      : null;
  }
  if (ref.startsWith("avito:")) {
    const x = shared.avito.services.find((s) => s.id === ref.slice(6));
    return x
      ? {
          id: ref,
          name: x.name,
          unit: "шт.",
          price: x.requiresReview ? null : x.fromPrice,
          mode: "from",
          version: shared.avito.version,
        }
      : null;
  }
  return null;
}
function fingerprint(page) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify([source(page.source_ref), source(page.upper_source_ref)]),
    )
    .digest("hex");
}
function resolve(page, catalog) {
  const lo = source(page.source_ref),
    hi = source(page.upper_source_ref);
  if (!lo) return null;
  let mode = page.price_display_mode;
  if (
    page.approved_fingerprint !== fingerprint(page) ||
    lo.price === null ||
    (mode === "range" &&
      (!hi ||
        hi.price === null ||
        hi.price < lo.price ||
        hi.unit !== lo.unit)) ||
    (mode === "fixed" && lo.mode === "from")
  )
    mode = "after_inspection";
  const priced = mode !== "after_inspection";
  return {
    ...catalog,
    name: page.public_title,
    description: page.short_description,
    unit: lo.unit,
    price: priced ? lo.price : null,
    price_type:
      mode === "fixed"
        ? "fixed"
        : mode === "after_inspection"
          ? "clarify"
          : "from",
    price_display_mode: mode,
    price_min: priced ? lo.price : null,
    price_max: mode === "range" ? hi.price : mode === "fixed" ? lo.price : null,
    slug: page.slug,
    category: page.category,
    category_slug: page.category_slug,
    subcategory: page.subcategory,
    subcategory_slug: page.subcategory_slug,
    full_description: page.full_description,
    image: page.image,
    duration: page.duration,
    included_text: page.included_text,
    excluded_text: page.excluded_text,
    seo_title: page.seo_title,
    seo_description: page.seo_description,
    synonyms: page.synonyms,
    sort_order: page.sort_order,
    public_title: page.public_title,
  };
}
function normalize(text) {
  return String(text || "")
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim();
}
function search(services, query) {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return services;
  return services
    .map((s) => {
      const hay = normalize(
        [s.name, s.category, s.description, ...(s.synonyms || [])].join(" "),
      );
      return {
        s,
        score: words.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0),
      };
    })
    .filter((x) => x.score === words.length)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.s);
}
module.exports = { source, fingerprint, resolve, search };
