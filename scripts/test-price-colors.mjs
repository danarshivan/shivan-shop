import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("../index.html", import.meta.url)), "utf8");

function cssRule(selector) {
  const escaped = selector.replaceAll(".", "\\.");
  const match = source.match(new RegExp(`(?:^|[}\\n])\\s*${escaped}\\s*\\{([^}]*)\\}`, "m"));
  assert.ok(match, `Expected standalone CSS rule for ${selector}`);
  return match[1];
}

for (const selector of [".price", ".detail-price", ".discounted-price", ".order-item-price"]) {
  assert.match(cssRule(selector), /color\s*:\s*var\(--shop-primary,#8966ff\)/i, `${selector} uses the globally selected primary accent`);
}
assert.match(cssRule(".original-price"), /color\s*:\s*#9b9eaa/i, "original crossed-out price stays subdued");

assert.match(source, /\.owner-orders-stat\.sales strong,\.total-price,\.detail-stock \.stock-line,\.price,\.detail-price,\.discounted-price,\.order-item-price[^\n]*\{color:"\+readablePrimary\+"!important\}/, "saved Owner appearance applies its readable primary color to final prices");
assert.match(source, /\.original-price\{color:#9b9eaa!important\}/, "saved Owner appearance keeps original prices subdued");
assert.match(source, /<del class="original-price">\$\{formatPrice\(originalPrice\)\}<\/del>/, "original-price rendering remains intact");
assert.match(source, /<strong class="discounted-price">\$\{formatPrice\(finalPrice\)\}<\/strong>/, "final-price rendering remains intact");

console.log("Price color checks passed for cards, details, cart/order item displays, and Owner appearance overrides.");
