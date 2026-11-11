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

const dedupeSandbox = {};
runInNewContext(
  `${extractFunction("productHasAvailableInventory")}\n${extractFunction("uniqueRecommendationProducts")}\nglobalThis.dedupeRecommendations = uniqueRecommendationProducts;`,
  dedupeSandbox
);

const sourceProducts = [
  { id: 42, name: "Currently open", stock: 4 },
  { id: "dress-a", name: "Same display name", stock: 3 },
  { id: "duplicate-dress", name: "Duplicate source row", stock: 2 },
  { id: "dress-b", name: "Same display name", stock: 5 },
  { id: "duplicate-dress", name: "Duplicate source row", stock: 8 },
  { id: "42", name: "Open product with string ID", stock: 9 },
  { id: "out-of-stock", name: "Unavailable", stock: 0 },
  { name: "Missing stable ID", stock: 5 }
];
const unique = dedupeSandbox.dedupeRecommendations(sourceProducts, "42");
assert.deepEqual(
  Array.from(unique, product => product.id),
  ["dress-a", "duplicate-dress", "dress-b"],
  "stable IDs deduplicate, the open product is excluded, and other IDs remain in source order"
);
assert.equal(unique[0].name, unique[2].name, "different product IDs remain distinct even when names match");
const reopened = dedupeSandbox.dedupeRecommendations(sourceProducts, "dress-a");
assert.equal(Array.from(reopened, product => product.id).includes("dress-a"), false, "reopening a different product excludes that newly opened product");
assert.equal(Array.from(reopened, product => product.id).filter(id => id === "duplicate-dress").length, 1, "source duplicates remain deduplicated after reopening");

const resetSource = extractFunction("resetDetailRecommendations");
assert.match(resetSource, /uniqueRecommendationProducts\(products,currentProduct\.id\)/, "opening a product rebuilds its recommendations by stable ID");
assert.match(resetSource, /detailRecommendationCursor<detailRecommendationPool\.length/, "pagination observer is enabled only when more unique items remain");

const renderedBatches = [];
const grid = {};
const sentinel = { textContent: "" };
const observer = { disconnectCount: 0, disconnect() { this.disconnectCount++; } };
const pagingSandbox = {
  currentProduct: { id: "current" },
  detailRecommendationPool: Array.from({ length: 10 }, (_, index) => ({ id: `product-${index}`, stock: 1 })),
  detailRecommendationCursor: 0,
  detailRecommendationObserver: observer,
  prioritizeDiscountedProducts(list) { return list; },
  document: { getElementById(id) { return id === "detailRecommendations" ? grid : sentinel; } },
  renderProducts(batch, target, append) { renderedBatches.push({ ids: batch.map(product => product.id), target, append }); },
  translateText: value => value
};
runInNewContext(`${extractFunction("loadMoreDetailRecommendations")}\nglobalThis.loadBatch = loadMoreDetailRecommendations;`, pagingSandbox);

pagingSandbox.loadBatch();
pagingSandbox.loadBatch();
pagingSandbox.loadBatch();
const renderedIds = renderedBatches.flatMap(batch => batch.ids);
assert.deepEqual(renderedBatches.map(batch => batch.ids.length), [8, 2], "all recommendations load in bounded pages without truncation");
assert.equal(new Set(renderedIds).size, 10, "pagination renders every product only once");
assert.deepEqual(renderedIds, Array.from({ length: 10 }, (_, index) => `product-${index}`), "pagination preserves the pool order");
assert.equal(observer.disconnectCount, 1, "the observer stops after the final unique item");
assert.equal(sentinel.textContent, "More styles coming soon", "the completed list reports no more items");

const loadSource = extractFunction("loadMoreDetailRecommendations");
assert.match(loadSource, /detailRecommendationPool\.slice\(start,end\)/, "pages use a bounded non-wrapping slice");
assert.doesNotMatch(loadSource, /%detailRecommendationPool\.length|Math\.random/, "completed pools are not recycled into duplicate cards");

console.log("Recommendation checks passed: stable product-ID deduplication, open-product exclusion, same-name distinct products, full pagination, no repeat cycles, and clean reopen behavior.");
