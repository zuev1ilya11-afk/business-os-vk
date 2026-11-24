"use strict";
const list = require("./service-list.json");

// Editorial descriptions for telephone orders have no bookable price or stock.
const services = list.map((s) => ({
  id: s.slug,
  slug: s.slug,
  name: s.name,
  public_title: s.name,
  category: s.category,
  category_slug: s.category_slug,
  subcategory: s.subcategory,
  subcategory_slug: s.subcategory_slug,
  description: s.description,
  full_description: s.description,
  synonyms: s.synonyms,
  unit: "",
  price_display_mode: "after_inspection",
  price_min: null,
  price_max: null,
  image: "/illustrations/" + s.category_slug + ".svg",
  duration: "",
  included_text:
    "Объём установки и перечень работ уточним с вами перед визитом.",
  excluded_text:
    "Материалы, демонтаж и дополнительные работы согласуем отдельно.",
  seo_title: s.name + " в Санкт-Петербурге",
  seo_description: s.description,
  version: 1,
}));
module.exports = services;
