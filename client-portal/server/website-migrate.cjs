"use strict";
const fs = require("node:fs/promises"),
  path = require("node:path");
async function migrateWebsite(db) {
  const exists = (
    await db.query(
      "select to_regclass('public.website_schema_version') as name",
    )
  ).rows[0].name;
  if (!exists)
    await db.exec(
      await fs.readFile(
        path.join(
          __dirname,
          "../../supabase/migrations/20261106180000_public_website.sql",
        ),
        "utf8",
      ),
    );
}
module.exports = { migrateWebsite };
