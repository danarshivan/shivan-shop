import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const api = await readFile(new URL("../functions/api/[[path]].js", import.meta.url), "utf8");
const functionSource = (source, name) => {
  const match = source.match(new RegExp(`function ${name}\\([^\\n]*\\)\\s*\\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `Expected ${name} to exist`);
  return match[0];
};

const getProductPricingSource = functionSource(html, "getProductPricing");
const productDiscountPercentSource = functionSource(html, "productDiscountPercent");
const formatCountdownSource = functionSource(html, "formatDiscountCountdown");
const renderCountdownSource = functionSource(html, "renderTimedDiscountBadge");
const timerInputValueSource = functionSource(html, "discountTimerInputValue");
const timerEndIsoSource = functionSource(html, "ownerDiscountTimerEndIso");
const timerControlsSource = functionSource(html, "updateOwnerDiscountTimerControls");
const ownerDiscountPreviewSource = functionSource(html, "updateOwnerDiscountPreview");
const browserCountdown = runInNewContext(
  `${getProductPricingSource}\n${productDiscountPercentSource}\n${formatCountdownSource}\n${renderCountdownSource}\n({formatDiscountCountdown,renderTimedDiscountBadge})`,
  { escapeHtml: value => String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;") },
);

const now = Date.parse("2026-11-02T20:00:00.000Z");
const endsAt = new Date(now + (2 * 1440 + 14 * 60 + 36) * 60000).toISOString();
const discountedProduct = { id: 23, price: 10000, discount: 25, discountTimerEnabled: true, discountEndsAt: endsAt };
assert.equal(browserCountdown.formatDiscountCountdown(Date.parse(endsAt), now), "02d 14h 36m");
const activeBadge = browserCountdown.renderTimedDiscountBadge(discountedProduct, now);
assert.match(activeBadge, /class="product-countdown-badge"/);
assert.match(activeBadge, /<svg[\s\S]*?circle/);
assert.match(activeBadge, /02d 14h 36m/);
assert.match(activeBadge, /aria-live="off"/);
assert.equal(browserCountdown.renderTimedDiscountBadge({ ...discountedProduct, discountTimerEnabled: false }, now), "", "disabled timers must not render");
assert.equal(browserCountdown.renderTimedDiscountBadge({ ...discountedProduct, discount: 0 }, now), "", "a timer without an active discount must not render");
assert.equal(browserCountdown.renderTimedDiscountBadge({ ...discountedProduct, discountEndsAt: new Date(now).toISOString() }, now), "", "expired timers must not render");
assert.equal(browserCountdown.renderTimedDiscountBadge({ price: 10000, discount: 25 }, now), "", "regular discounts without an end time must keep the existing display");

const ownerEndInput = { value: "2030-01-02T03:04", setAttribute(name, value) { this[name] = value; } };
const ownerTimerToggle = { checked: true };
const ownerTimerFields = { hidden: true };
const ownerTimerStatus = { textContent: "", dataset: {} };
const ownerPricePreview = { textContent: "" };
const ownerDiscountInput = { value: "25", setAttribute(name, value) { this[name] = value; } };
const ownerPriceInput = { value: "10000" };
const ownerElements = new Map([
  ["ownerProductPrice", ownerPriceInput],
  ["ownerProductDiscount", ownerDiscountInput],
  ["ownerDiscountPreview", ownerPricePreview],
  ["ownerProductDiscountTimerEnabled", ownerTimerToggle],
  ["ownerProductDiscountEndsAt", ownerEndInput],
  ["ownerDiscountTimerFields", ownerTimerFields],
  ["ownerDiscountTimerStatus", ownerTimerStatus],
]);
const ownerControls = runInNewContext(
  `${getProductPricingSource}\n${timerInputValueSource}\n${timerEndIsoSource}\n${ownerDiscountPreviewSource}\n${timerControlsSource}\n({discountTimerInputValue,ownerDiscountTimerEndIso,updateOwnerDiscountPreview,updateOwnerDiscountTimerControls})`,
  {
    document: { getElementById: id => ownerElements.get(id) || null },
    Date,
    Number,
    BigInt,
    formatPrice: price => `${Number(price).toLocaleString("en-US")} IQD`,
  },
);
assert.equal(ownerControls.ownerDiscountTimerEndIso(), new Date(ownerEndInput.value).toISOString(), "the Owner's local date/time converts to an exact ISO timestamp for shared storage");
assert.equal(new Date(ownerControls.discountTimerInputValue(ownerControls.ownerDiscountTimerEndIso())).getTime(), new Date(ownerEndInput.value).getTime(), "editing a saved offer restores the same local date/time");
assert.equal(ownerControls.updateOwnerDiscountTimerControls(), true, "a valid limited-time offer passes the Owner preview");
assert.equal(ownerTimerFields.hidden, false, "enabling a timer reveals its end date/time control");
assert.match(ownerPricePreview.textContent, /7,500 IQD after 25% off 10,000 IQD/);
assert.match(ownerPricePreview.textContent, /Limited-time offer ends/);
assert.match(ownerTimerStatus.textContent, /Offer ends/);
ownerEndInput.value = "";
assert.equal(ownerControls.updateOwnerDiscountPreview(), false, "an enabled timer without an end date/time is rejected");
assert.equal(ownerEndInput["aria-invalid"], "true");
ownerTimerToggle.checked = false;
assert.equal(ownerControls.updateOwnerDiscountTimerControls(), true, "disabling the timer leaves a regular discount valid");
assert.equal(ownerTimerFields.hidden, true, "disabling a timer hides the end date/time control");
ownerDiscountInput.value = "";
assert.equal(ownerControls.updateOwnerDiscountPreview(), true, "products without discounts and timers retain normal pricing");

assert.match(html, /id="ownerProductDiscountTimerEnabled" type="checkbox"/);
assert.match(html, /id="ownerProductDiscountEndsAt" type="datetime-local"/);
assert.match(html, /record\.discountTimerEnabled=true;record\.discountEndsAt=discountTimerEndsAt/);
assert.match(html, /ownerProductDiscountTimerEnabled/);
assert.match(html, /product-image-frame[\s\S]*?renderTimedDiscountBadge\(p\)/);
assert.match(html, /id="detailDiscountCountdown"/);
assert.match(html, /\.product-countdown-badge\{[^\n]*background:rgba\(139,31,48/);
assert.match(api, /validateProductPriceDetails\(parsed\)/);
assert.match(api, /INVALID_PRODUCT_DISCOUNT_TIMER/);

const timerValidationSource = functionSource(api, "productDiscountTimerDetails");
const productPriceDetailsSource = functionSource(api, "productPriceDetails");
const apiPricing = runInNewContext(`${timerValidationSource}\n${productPriceDetailsSource}\n({productPriceDetails})`);
const legacyPricing = apiPricing.productPriceDetails({ price: 10000, discount: 25 });
assert.equal(legacyPricing.finalPrice, 7500);
assert.equal(legacyPricing.discountTimerEnabled, false, "legacy discounts without timers remain valid");
const timedPricing = apiPricing.productPriceDetails(discountedProduct);
assert.equal(timedPricing.discountTimerEnabled, true);
assert.equal(timedPricing.discountEndsAt, endsAt, "the exact selected end time is retained");
assert.equal(apiPricing.productPriceDetails({ ...discountedProduct, discountTimerEnabled: false, discountEndsAt: undefined }).discountTimerEnabled, false);
for (const invalid of [
  { price: 10000, discountTimerEnabled: true, discountEndsAt: endsAt },
  { price: 10000, discount: 25, discountTimerEnabled: true },
  { price: 10000, discount: 25, discountTimerEnabled: true, discountEndsAt: "not a date" },
  { price: 10000, discount: 25, discountTimerEnabled: true, discountEndsAt: "2026-11-03T10:00:00Z" },
  { price: 10000, discount: 25, discountTimerEnabled: "true", discountEndsAt: endsAt },
  { price: 10000, discount: 25, discountEndsAt: endsAt },
]) {
  assert.throws(() => apiPricing.productPriceDetails(invalid), error => error.code === "INVALID_PRODUCT_DISCOUNT_TIMER");
}

let clockNow = now;
let timerCallback = null;
let timerDelay = 0;
let timerId = 0;
const countdownValue = { textContent: "" };
const badge = {
  dataset: { discountEndsAt: endsAt },
  removed: false,
  label: "",
  querySelector: selector => selector === "[data-countdown-value]" ? countdownValue : null,
  setAttribute(name, value) { if (name === "aria-label") this.label = value; },
  remove() { this.removed = true; },
};
class FixedDate extends Date { static now() { return clockNow; } }
const countdownSandbox = {
  Date: FixedDate,
  document: { querySelectorAll: () => badge.removed ? [] : [badge] },
  clearTimeout() {},
  setTimeout(callback, delay) { timerCallback = callback; timerDelay = delay; timerId++; return timerId; },
};
runInNewContext(`let discountCountdownRefreshTimer=0;\n${formatCountdownSource}\n${functionSource(html, "refreshDiscountCountdownBadges")}\nrefreshDiscountCountdownBadges()`, countdownSandbox);
assert.equal(countdownValue.textContent, "02d 14h 36m", "the visible timer initializes from shared product data");
assert.equal(badge.label, "Limited-time offer, 02d 14h 36m remaining");
assert.ok(timerDelay > 0 && timerDelay <= 60010, "countdown refresh is scheduled at a minute boundary rather than every second");
assert.equal(typeof timerCallback, "function");
clockNow = Date.parse(endsAt);
timerCallback();
assert.equal(badge.removed, true, "the countdown badge is removed when the offer expires");
assert.equal(countdownSandbox.document.querySelectorAll("[data-discount-countdown]").length, 0);

console.log("Limited-time discount countdown checks passed.");
