import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("../index.html", import.meta.url)), "utf8");

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Expected function ${name}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index++) {
    if (source[index] === "{") depth++;
    else if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`Could not find the end of ${name}`);
}

const sandbox = {};
runInNewContext([
  extractFunction("getProductPricing"),
  extractFunction("productDiscountPercent"),
  extractFunction("prioritizeDiscountedProducts"),
  "globalThis.sortDiscountedFirst = prioritizeDiscountedProducts;"
].join("\n\n"), sandbox);

const products = [
  { id: "regular-first", price: 100 },
  { id: "discount-20", price: 100, discount: 20 },
  { id: "discount-5", price: 100, discount: "5" },
  { id: "zero-discount", price: 100, discount: 0 },
  { id: "invalid-discount", price: 100, discount: 100 },
  { id: "discount-99", price: 100, discount: 99 },
  { id: "regular-last", price: 100 }
];
const originalOrder = products.map(product => product.id);
const sorted = sandbox.sortDiscountedFirst(products);

assert.deepEqual(
  Array.from(sorted, product => product.id),
  ["discount-20", "discount-5", "discount-99", "regular-first", "zero-discount", "invalid-discount", "regular-last"],
  "valid discounts move first while each group retains its relative order"
);
assert.deepEqual(products.map(product => product.id), originalOrder, "sorting does not mutate the shared products array");
assert.equal(sandbox.sortDiscountedFirst(null).length, 0, "missing lists are safe");

const renderProducts = extractFunction("renderProducts");
assert.match(renderProducts, /const displayList=prioritizeDiscountedProducts\(list\)/, "all shared customer product grids use the stable display ordering");
assert.match(renderProducts, /displayList\.map\(p=>/, "ordered items are what the shared grid renders");
assert.match(extractFunction("searchProducts"), /renderProducts\(result,forceTarget/, "search continues through the shared grid renderer");
assert.match(extractFunction("filterCategory"), /renderProducts\(result\)/, "category results continue through the shared grid renderer");
assert.match(extractFunction("renderVisibleProductGrid"), /renderProducts\(/, "Home refreshes continue through the shared grid renderer");

const resetRecommendations = extractFunction("resetDetailRecommendations");
assert.match(resetRecommendations, /detailRecommendationPool\.sort\([\s\S]*?prioritizeDiscountedProducts\(detailRecommendationPool\)/, "recommendations retain category relevance, then put discounts first");
assert.match(extractFunction("loadMoreDetailRecommendations"), /prioritizeDiscountedProducts\(detailRecommendationPool\)/, "paginated recommendation cycles keep discounted items first");
assert.doesNotMatch(extractFunction("renderOwnerProducts"), /prioritizeDiscountedProducts/, "Owner product editing order is untouched");

console.log("Discount-first ordering checks passed: stable groups, valid 1–99% discounts, Home, category, Search, recommendations, and unchanged Owner ordering.");
