// Builds bake-n-take.xlsx from bake-n-take.json (the real Wolt menu).
// Run: node tests/fixtures/build-xlsx.mjs
import * as XLSX from "xlsx";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = dirname(fileURLToPath(import.meta.url));
const menu = JSON.parse(readFileSync(join(dir, "bake-n-take.json"), "utf8"));

// One item out of stock so the in_stock=FALSE path is exercised.
const OUT_OF_STOCK = "Halloumi Pie";

const rows = menu.map((m) => ({
  category: m.category.trim(),
  name: m.name,
  description: m.description,
  image_url: m.image_url,
  price: m.price, // integer minor units, e.g. 250 = €2.50
  in_stock: m.name !== OUT_OF_STOCK,
}));

const ws = XLSX.utils.json_to_sheet(rows, {
  header: ["category", "name", "description", "price", "image_url", "in_stock"],
});
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "menu");
const out = join(dir, "bake-n-take.xlsx");
const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
writeFileSync(out, buf);
console.log(`wrote ${out} (${rows.length} rows, 1 out of stock)`);
