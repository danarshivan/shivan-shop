import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../luxury-theme.css", import.meta.url), "utf8");
const build = await readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8");

assert.match(html, /<link rel="stylesheet" href="\/luxury-theme\.css">/, "the storefront loads the redesign stylesheet");
assert.ok(build.includes('"luxury-theme.css"'), "the production build copies the redesign stylesheet");
for (const token of ["--shivan-burgundy:#1b0610", "--shivan-plum:#2b0a1b", "--shivan-wine:#4a1029", "--shivan-pink:#ff9fc2"]) {
  assert.ok(css.includes(token), `the reference palette includes ${token}`);
}
for (const selector of [
  ".shop-startup-splash", ".shop-promo-onboarding", "#authPage.auth", ".topbar", ".hero", ".categories", ".products", ".detail-gallery",
  ".cart-item", ".order-card", ".profile-card", ".owner-admin-shell", ".owner-dashboard-banner", ".owner-product-editor",
  ".owner-category-manager", ".owner-orders-controls", ".owner-inventory-scroll", ".owner-settings-form", ".owner-staff-account-card",
  ".owner-smart-alert-panel", ".owner-customer-notifications", "[dir=\"rtl\"] .hero-overlay", "[dir=\"rtl\"] .owner-dashboard-nav-item.active",
]) assert.ok(css.includes(selector), `redesign styling covers ${selector}`);
assert.match(css, /@media\s*\(max-width:760px\)/, "mobile layout rules are present");
assert.match(css, /@media\s*\(min-width:900px\)/, "wide-screen layouts are present");
assert.match(css, /prefers-reduced-motion:reduce/, "the redesign respects reduced-motion preferences");
assert.match(css, /overflow:clip/, "the redesigned app frame prevents accidental horizontal overflow");

let depth = 0;
for (const character of css) {
  if (character === "{") depth += 1;
  if (character === "}") depth -= 1;
  assert.ok(depth >= 0, "stylesheet braces never close before they open");
}
assert.equal(depth, 0, "stylesheet blocks are balanced");

console.log("Luxury redesign wiring checks passed: reference palette, all-screen coverage, RTL rules, responsive breakpoints, reduced motion, and production asset copy.");
