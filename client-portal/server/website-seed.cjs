"use strict";
// Editorial mapping only. All numeric prices remain in service-catalog.js.
const { source } = require("./website-catalog.cjs");
const pages = [
  [
    "standard:standard_005",
    "ustanovka-karniza",
    "Установка карниза",
    "Карнизы и шторы",
    "curtains",
    "Карнизы",
    "rods",
    ["повесить карниз", "крепление карниза"],
  ],
  [
    "standard:standard_010",
    "rulonnye-shtory",
    "Монтаж рулонных штор",
    "Карнизы и шторы",
    "curtains",
    "Шторы и жалюзи",
    "blinds",
    ["установить шторы", "день ночь", "жалюзи"],
  ],
  [
    "avito:mixer",
    "zamena-smesitelya",
    "Замена смесителя",
    "Сантехника",
    "plumbing",
    "Смесители",
    "mixers",
    ["течёт кран", "течет кран", "капает кран", "смеситель"],
  ],
  [
    "avito:toilet",
    "ustanovka-unitaza",
    "Установка унитаза",
    "Сантехника",
    "plumbing",
    "Санфаянс",
    "sanitary",
    ["унитаз", "бачок"],
  ],
  [
    "avito:socket_replace",
    "zamena-rozetki",
    "Замена розетки",
    "Электрика",
    "electrical",
    "Розетки и выключатели",
    "sockets",
    ["заменить розетку", "не работает розетка", "выключатель"],
  ],
  [
    "avito:chandelier",
    "ustanovka-lyustry",
    "Установка люстры",
    "Электрика",
    "electrical",
    "Освещение",
    "lighting",
    ["светильник", "повесить люстру"],
  ],
  [
    "avito:tv_bracket",
    "televizor-na-stenu",
    "Телевизор на стену",
    "Мелкий ремонт",
    "handyman",
    "Настенный монтаж",
    "mounting",
    ["повесить телевизор", "кронштейн тв"],
  ],
  [
    "avito:shelf",
    "naveska-polok",
    "Навеска полок",
    "Мелкий ремонт",
    "handyman",
    "Настенный монтаж",
    "mounting",
    ["повесить полку", "закрепить полку"],
  ],
  [
    "avito:dishwasher_washer",
    "podklyuchenie-mashiny",
    "Подключение стиральной машины",
    "Бытовая техника",
    "appliances",
    "Подключение",
    "connection",
    ["подключить стиральную машину", "посудомойка", "посудомоечная машина"],
  ],
  [
    "avito:furniture",
    "sborka-mebeli",
    "Сборка и ремонт мебели",
    "Мебель",
    "furniture",
    "Сборка",
    "assembly",
    ["собрать шкаф", "сборка мебели", "комод"],
  ],
];
async function seedWebsite(db) {
  for (const [
    i,
    [
      ref,
      slug,
      title,
      category,
      categorySlug,
      subcategory,
      subcategorySlug,
      synonyms,
    ],
  ] of pages.entries()) {
    const s = source(ref);
    if (!s) throw Error("Unknown shared service reference");
    const id = "web_" + slug.replaceAll("-", "_");
    const description = `${title} с предварительным уточнением задачи, объёма и условий на объекте.`;
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
        "Расскажите, что нужно сделать, укажите размеры и приложите фотографии. Перед визитом согласуем состав работ и стоимость. Желаемое время подтверждается отдельно.",
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
