"use strict";
// Editorial mapping only. All numeric prices remain in service-catalog.js.
const { source } = require("./website-catalog.cjs");
const services = require("../../apps/public-site/lib/service-list.json");
// Keep the staging fixture's public tuple interface for existing callers.
const pages = services.map((s) => [
  s.ref,
  s.slug,
  s.name,
  s.category,
  s.category_slug,
  s.subcategory,
  s.subcategory_slug,
  s.synonyms,
]);
async function seedWebsite(db) {
  for (const [i, service] of services.entries()) {
    const {
      ref,
      slug,
      name: title,
      category,
      category_slug: categorySlug,
      subcategory,
      subcategory_slug: subcategorySlug,
      synonyms,
      description,
    } = service;
    const s = source(ref);
    if (!s) throw Error("Unknown shared service reference");
    const id = "web_" + slug.replaceAll("-", "_");
    await db.query(
      "insert into client_catalog(id,category,name,description,unit,price_type,price,conditions,city,published,confirmed,available) values($1,$2,$3,$4,$5,'clarify',null,'Работы и материалы согласуются до выполнения','Санкт-Петербург',true,false,true) on conflict do nothing",
      [id, category, title, description, s.unit],
    );
    await db.query(
      "insert into website_service_pages(service_id,source_ref,public_title,slug,short_description,full_description,category,category_slug,subcategory,subcategory_slug,image,included_text,excluded_text,synonyms,published,sort_order) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,true,$15) on conflict do nothing",
      [
        id,
        ref,
        title,
        slug,
        description,
        description,
        category,
        categorySlug,
        subcategory,
        subcategorySlug,
        "/illustrations/" + categorySlug + ".svg",
        "Состав работ будет указан в согласованной смете.",
        "Материалы, демонтаж и дополнительные работы согласуются отдельно.",
        synonyms,
        i,
      ],
    );
  }
}
module.exports = { seedWebsite, pages };
