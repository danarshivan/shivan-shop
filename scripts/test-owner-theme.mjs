import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const api = await readFile(new URL("../functions/api/[[path]].js", import.meta.url), "utf8");
const constantsStart = html.indexOf("const OWNER_THEME_PRESETS=");
const constantsEnd = html.indexOf("\nlet products = [", constantsStart);
assert.ok(constantsStart >= 0 && constantsEnd > constantsStart, "Owner theme constants and default appearance are present");
const constants = html.slice(constantsStart, constantsEnd);
const functionSource = name => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`(?:async\\s+)?function ${escaped}\\([^\\n]*\\)\\s*\\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `Expected function ${name} to exist`);
  return match[0];
};
const required = [
  "safeAppearanceColor", "isValidAppearanceHex", "safeStoreLogoUrl", "normalizeOwnerAppearance", "normalizeOwnerDeliveryZones", "ownerAppearanceLuminance",
  "ownerAppearanceContrastRatio", "ownerAppearanceContrastText", "ownerAppearanceReadableText",
  "ownerAppearanceContrastIssues", "ownerAppearanceGlobalCss",
  "ownerAppearanceThemePreset", "ownerAppearanceFieldLabel", "ownerAppearanceLocalizedContrastWarning", "ownerAppearanceHexInput", "ownerAppearancePresetMarkup", "ownerAppearancePreviewMarkup",
  "readOwnerAppearanceForm", "setOwnerAppearanceStatus", "renderOwnerAppearancePreview", "renderOwnerAppearance",
  "selectOwnerTheme", "syncOwnerAppearanceColor", "previewOwnerAppearance", "saveOwnerAppearance", "resetOwnerAppearance",
];
const functions = required.map(functionSource).join("\n");

const product = { id: "p-1", name: "Evening dress", price: 85000, discount: 25, image: "/dress.jpg", category: "Dresses" };
const data = new Map();
const elements = new Map();
const makeElement = (value = "") => ({
  value,
  textContent: "",
  innerHTML: "",
  style: {},
  dataset: {},
  attributes: {},
  disabled: false,
  setAttribute(name, item) { this.attributes[name] = item; },
  removeAttribute(name) { delete this.attributes[name]; },
  querySelector() { return this.submitButton || null; },
});
const presets = Object.keys({ burgundy: 1, purple: 1, pink: 1, blue: 1, teal: 1, gold: 1 }).map(name => ({
  dataset: { ownerTheme: name },
  attributes: {},
  label: makeElement(),
  setAttribute(key, value) { this.attributes[key] = value; },
  querySelector() { return this.label; },
}));
const document = {
  head: {},
  getElementById(id) { return elements.get(id) || null; },
  querySelectorAll(selector) { return selector.includes("ownerThemePresets") ? presets : []; },
};
const localStorage = {
  getItem(key) { return data.has(key) ? data.get(key) : null; },
  setItem(key, value) { data.set(key, String(value)); },
  removeItem(key) { data.delete(key); },
};
const context = {
  document,
  localStorage,
  activeLanguage: "en",
  ownerDashboardText: (en, ku = en, ar = en) => context.activeLanguage === "ar" ? ar : context.activeLanguage === "ku" ? ku : en,
  window: { confirm: () => true },
  isOwner: () => true,
  cloudMode: true,
  cloudAccount: { id: "owner-test", role: "owner" },
  products: [product],
  productDiscountPercent: item => Number(item?.discount) >= 1 && Number(item?.discount) <= 99 ? Number(item.discount) : 0,
  getProductPricing: item => ({ originalPrice: item.price, finalPrice: Math.round(item.price * (100 - Number(item.discount || 0)) / 100), discountPercent: Number(item.discount || 0) }),
  productPhotos: item => [{ src: item.image }],
  safeImageUrl: value => value,
  getProductName: item => item.name,
  formatPrice: value => `IQD ${Number(value).toLocaleString("en-US")}`,
  escapeHtml: value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"),
  createOwnerSaveRequestId: () => "theme-test-request",
  confirmCloudShopWrite: async (key, requestId) => {
    if (context.failCloudWrite) throw Object.assign(new Error("Cloud sync unavailable"), { requestId: "theme-cloud-failure" });
    context.confirmedWrites.push({ key, requestId, value: localStorage.getItem(key) });
  },
  confirmedWrites: [],
  showToast: message => { context.lastToast = message; },
  ownerSaveDiagnostic: (stage, details) => { context.lastDiagnostic = { stage, details }; },
  ownerSaveDiagnosticCode: () => "TEST_FAILURE",
  applyOwnerAppearance: () => { context.applyCount = (context.applyCount || 0) + 1; },
  renderAdvertisements: () => { context.adRenders = (context.adRenders || 0) + 1; },
  renderOwnerPanel: () => { context.panelRenders = (context.panelRenders || 0) + 1; },
};
const runtime = runInNewContext(`const OWNER_APPEARANCE_KEY="shivan_shop_owner_appearance";\n${constants}\n${functions}\n({OWNER_THEME_PRESETS,OWNER_FONT_OPTIONS,OWNER_APPEARANCE_COLOR_FIELDS,${required.join(",")},getAppearance:()=>ownerAppearance,setAppearance:value=>ownerAppearance=value,isAppearanceSaved:()=>ownerAppearanceSaved})`, context);

const presetNames = Object.keys(runtime.OWNER_THEME_PRESETS);
assert.deepEqual(presetNames, ["burgundy", "purple", "pink", "blue", "teal", "gold"], "the Burgundy redesign theme is available alongside existing themes");
assert.deepEqual(JSON.parse(JSON.stringify(runtime.OWNER_THEME_PRESETS.burgundy)), {
  primary: "#f17ba9", secondary: "#ffd0df", background: "#1b0610", card: "#340d20", text: "#fff8fb", secondaryText: "#d9bac7", button: "#d94784",
}, "Burgundy matches the new Shivan Shop redesign palette");
assert.deepEqual(JSON.parse(JSON.stringify(runtime.OWNER_THEME_PRESETS.purple)), {
  primary: "#c65d8a", secondary: "#e8a5bc", background: "#200916", card: "#3a102a", text: "#fff5f9", secondaryText: "#d9bac7", button: "#9e315c",
}, "the retained Plum preset stays within the burgundy fashion palette");
const legacyPurpleSaved = { theme: "purple", primary: "#8966ff", secondary: "#b49aff", background: "#03050d", card: "#0b0e18", text: "#ffffff", secondaryText: "#a8a3b5", button: "#7045ff", storeName: "Saved Store" };
const migratedLegacyPurple = runtime.normalizeOwnerAppearance(legacyPurpleSaved);
assert.equal(migratedLegacyPurple.theme, "purple", "the saved theme choice remains recognizable after visual migration");
assert.equal(migratedLegacyPurple.primary, runtime.OWNER_THEME_PRESETS.purple.primary, "legacy saved purple accents render in the new Plum palette");
assert.equal(migratedLegacyPurple.background, runtime.OWNER_THEME_PRESETS.purple.background, "legacy saved purple backgrounds render in the new Plum palette");
assert.equal(migratedLegacyPurple.storeName, "Saved Store", "legacy theme migration preserves store branding");
assert.equal(legacyPurpleSaved.primary, "#8966ff", "normalizing the legacy theme does not mutate saved source data");
assert.equal(runtime.isValidAppearanceHex("#12aBcD"), true, "six-digit HEX accepts mixed-case digits");
for (const invalid of ["#123", "123456", "#12GG56", "red", ""]) assert.equal(runtime.isValidAppearanceHex(invalid), false, `${invalid || "empty input"} is rejected as an invalid HEX color`);

const legacy = runtime.normalizeOwnerAppearance({ accent: "#123456", surface: "#222222", text: "#eeeeee", font: "segoe" });
assert.equal(legacy.primary, "#123456", "legacy saved accent migrates to the primary accent");
assert.equal(legacy.card, "#222222", "legacy saved surface migrates to the card color");
assert.equal(legacy.font, "roboto", "older saved fonts map to a supported available font");
const savedForSecondDevice = JSON.stringify(runtime.normalizeOwnerAppearance({ theme: "teal", ...runtime.OWNER_THEME_PRESETS.teal, font: "inter" }));
const onSecondDevice = runtime.normalizeOwnerAppearance(JSON.parse(savedForSecondDevice));
assert.equal(onSecondDevice.theme, "teal", "a second device can hydrate the same saved theme");
assert.equal(onSecondDevice.primary, runtime.OWNER_THEME_PRESETS.teal.primary);
assert.equal(onSecondDevice.font, "inter");

for (const [name, preset] of Object.entries(runtime.OWNER_THEME_PRESETS)) {
  const presetCss = runtime.ownerAppearanceGlobalCss({ ...preset, theme: name });
  assert.ok(presetCss.includes("--shop-primary:" + preset.primary + ";"), name + " primary accent applies globally");
  assert.ok(presetCss.includes("--shop-secondary:" + preset.secondary + ";"), name + " secondary accent applies globally");
  assert.ok(presetCss.includes("--shop-page-background:" + preset.background + ";"), name + " page background applies globally");
  assert.ok(presetCss.includes("--shop-card-background:" + preset.card + ";"), name + " card background applies globally");
  assert.ok(presetCss.includes("--shop-button:" + preset.button + ";"), name + " button color applies globally");
}

const globalCss = runtime.ownerAppearanceGlobalCss({ ...runtime.OWNER_THEME_PRESETS.pink, font: "poppins" });
for (const value of Object.values(runtime.OWNER_THEME_PRESETS.pink)) assert.ok(globalCss.includes(value), `global theme applies ${value}`);
assert.match(globalCss, /Poppins/);
assert.match(globalCss, /--shop-primary:#ff63a7;/, "the saved primary color is exposed as a centralized document token");
assert.match(globalCss, /body,body \*,button,input,select,textarea\{font-family:"Poppins"/, "the selected font applies to all document content and controls");
for (const selector of [
  ".shop-startup-splash{", ".shop-promo-onboarding{", ".shop-promo-onboarding-media{", ".shop-promo-onboarding-next",
  "#authPage", ".auth-ad,.hero", ".nav-item.active", ".product", ".detail-box", ".cart-item",
  ".profile-card", ".owner-form", ".owner-dashboard-banner", ".owner-orders-heading", ".owner-qr-product-hero",
  ".owner-stat-card", ".owner-customer-card", ".owner-sidebar", ".owner-analytics-bar-fill",
  ".owner-theme-live-preview .owner-theme-preview-product-copy button"
]) assert.ok(globalCss.includes(selector), "global styling covers " + selector);
assert.match(globalCss, /\.owner-orders-stat\.sales strong,\.total-price,\.detail-stock \.stock-line,\.price,\.detail-price,\.discounted-price,\.order-item-price[^\n]*color:#ff63a7!important\}/, "discounted final prices follow the selected primary accent");
assert.match(globalCss, /\.original-price\{color:#9b9eaa!important\}/, "original discounted prices remain subdued");
assert.match(globalCss, /\.owner-theme-live-preview \.owner-theme-preview-final-price\{color:var\(--owner-theme-readable-primary\)!important\}/, "global theme overrides leave the independent preview colors intact");
assert.equal(runtime.ownerAppearanceContrastText("#d83e8a"), "#111111", "button labels use the more readable black or white foreground");
assert.ok(runtime.ownerAppearanceContrastRatio("#ffffff", "#000000") >= 21, "contrast calculation follows WCAG relative luminance");
const lowContrast = runtime.ownerAppearanceContrastIssues({ text: "#111111", secondaryText: "#222222", background: "#000000", card: "#080808", primary: "#333333", secondary: "#444444" });
assert.ok(lowContrast.length >= 3, "the preview identifies custom text and accent combinations that need stronger contrast");
assert.equal(runtime.ownerAppearanceReadableText("#111111", ["#000000", "#080808"]), "#ffffff", "unreadable custom text uses a readable fallback");
const lowContrastCss = runtime.ownerAppearanceGlobalCss({ text: "#111111", secondaryText: "#222222", background: "#000000", card: "#080808", primary: "#333333", secondary: "#444444", button: "#d83e8a" });
assert.match(lowContrastCss, /--shop-readable-text:#ffffff;/, "low-contrast body text receives a readable fallback without changing the selected saved HEX");
assert.match(lowContrastCss, /--shop-button-text:#111111;/, "button foreground is chosen to preserve readable contrast");

const rendered = { innerHTML: "" };
runtime.renderOwnerAppearance(rendered);
assert.match(rendered.innerHTML, /owner-theme-presets/);
assert.equal((rendered.innerHTML.match(/data-owner-theme=/g) || []).length, 6, "the editor renders Burgundy and all five existing theme choices");
assert.equal((rendered.innerHTML.match(/type="color"/g) || []).length, 7, "each custom color has a native color picker");
assert.equal((rendered.innerHTML.match(/type="text"[^>]*pattern=/g) || []).length, 7, "each custom color has an editable validated HEX field");
for (const font of ["Poppins", "Roboto", "Inter", "Montserrat", "Tahoma"]) assert.ok(rendered.innerHTML.includes(font), `${font} is offered`);
for (const part of ["owner-theme-preview-header", "owner-theme-preview-nav", "owner-theme-preview-product", "owner-theme-preview-image", "owner-theme-preview-prices", "owner-theme-preview-discount", "owner-theme-preview-category", "Add to cart"]) assert.ok(rendered.innerHTML.includes(part), `live preview includes ${part}`);
assert.match(rendered.innerHTML, /Evening dress/);
assert.match(rendered.innerHTML, /25%/);
assert.match(rendered.innerHTML, /Save Changes/);
assert.match(rendered.innerHTML, /Reset to Default/);
context.activeLanguage = "ku"; runtime.renderOwnerAppearance(rendered);
assert.match(rendered.innerHTML, /ڕەنگ و فۆنت/, "the Appearance section has Kurdish translations");
assert.match(rendered.innerHTML, /پاشەکەفت بکە/, "Kurdish theme controls are translated");
assert.match(rendered.innerHTML, /ڕەنگا سەرەکی/, "Kurdish color field labels are translated");
context.activeLanguage = "ar"; runtime.renderOwnerAppearance(rendered);
assert.match(rendered.innerHTML, /الألوان والخط/, "the Appearance section has Arabic translations");
assert.match(rendered.innerHTML, /احفظ التغييرات/, "Arabic theme controls are translated");
assert.match(rendered.innerHTML, /لون التمييز الأساسي/, "Arabic color field labels are translated");
context.activeLanguage = "en"; runtime.renderOwnerAppearance(rendered);
assert.match(rendered.innerHTML, /owner-theme-button-text:#111111/, "the Burgundy live preview selects dark button text for readable contrast");
assert.doesNotMatch(rendered.innerHTML, /ownerBackupSync/, "backup controls have their own Store Settings section rather than being mixed into Appearance");
const contrastPreview = runtime.ownerAppearancePreviewMarkup({ text: "#111111", secondaryText: "#222222", background: "#000000", card: "#080808", primary: "#333333", secondary: "#444444" });
assert.match(contrastPreview, /owner-theme-contrast-note/, "the live preview explains low-contrast custom selections");
assert.match(contrastPreview, /owner-theme-readable-text:#ffffff/, "the live preview matches the storefront text fallback");

const form = makeElement();
form.dataset.theme = "purple";
form.submitButton = makeElement();
elements.set("ownerAppearanceForm", form);
for (const field of runtime.OWNER_APPEARANCE_COLOR_FIELDS) {
  elements.set(`${field.id}Picker`, makeElement(runtime.getAppearance()[field.key]));
  elements.set(`${field.id}Hex`, makeElement(runtime.getAppearance()[field.key].toUpperCase()));
}
elements.set("ownerFont", makeElement("tahoma"));
elements.set("ownerStoreName", makeElement(""));
elements.set("ownerTagline", makeElement(""));
elements.set("ownerHeroTitle", makeElement(""));
elements.set("ownerHeroMessage", makeElement(""));
elements.set("ownerAppearanceStatus", makeElement());
elements.set("ownerThemePreviewMount", makeElement());
elements.set("ownerFontPreview", makeElement());
runtime.selectOwnerTheme("pink");
assert.equal(form.dataset.theme, "pink", "selecting a preset updates the editor's pending theme");
assert.equal(elements.get("ownerThemePrimaryHex").value, "#FF63A7", "preset selection updates HEX inputs");
assert.equal(elements.get("ownerThemePrimaryPicker").value, "#ff63a7", "preset selection updates color pickers");
assert.equal(presets.find(button => button.dataset.ownerTheme === "pink").attributes["aria-pressed"], "true", "selected preset is accessible and clearly indicated");
assert.match(elements.get("ownerThemePreviewMount").innerHTML, /--owner-theme-primary:#ff63a7/);
assert.equal(runtime.getAppearance().theme, "burgundy", "unsaved preview changes do not alter the published global theme");

elements.get("ownerThemeSecondaryHex").value = "#12GG56";
assert.throws(() => runtime.readOwnerAppearanceForm(), /six-digit HEX color/, "invalid custom HEX values block saving");
assert.equal(elements.get("ownerThemeSecondaryHex").attributes["aria-invalid"], "true", "the invalid secondary accent input is marked");
elements.get("ownerThemeSecondaryHex").value = "#FFADD0";
elements.get("ownerThemeSecondaryPicker").value = "#ffadd0";
elements.get("ownerThemeButtonHex").value = "#D83E8A";
elements.get("ownerThemeButtonPicker").value = "#d83e8a";
elements.get("ownerFont").value = "inter";
const draft = runtime.readOwnerAppearanceForm();
assert.equal(draft.secondary, "#ffadd0");
assert.equal(draft.button, "#d83e8a");
assert.equal(draft.font, "inter");
runtime.syncOwnerAppearanceColor("button", "hex");
assert.match(elements.get("ownerThemePreviewMount").innerHTML, /--owner-theme-button:#d83e8a/, "valid custom HEX edits refresh the live preview immediately");

let prevented = false;
await runtime.saveOwnerAppearance({ preventDefault() { prevented = true; }, currentTarget: form });
assert.equal(prevented, true, "theme save does not submit/reload the page");
assert.equal(runtime.isAppearanceSaved(), true);
assert.equal(runtime.getAppearance().font, "inter");
const stored = JSON.parse(localStorage.getItem("shivan_shop_owner_appearance"));
assert.equal(stored.secondary, "#ffadd0");
assert.equal(stored.button, "#d83e8a");
assert.equal(context.confirmedWrites.at(-1).key, "shivan_shop_owner_appearance", "save uses the existing shared Owner appearance key");
assert.equal(JSON.parse(context.confirmedWrites.at(-1).value).theme, "custom", "custom color edits persist through the existing Owner sync mechanism");

context.failCloudWrite = true;
elements.get("ownerThemeButtonHex").value = "#aa33cc";
elements.get("ownerThemeButtonPicker").value = "#aa33cc";
await runtime.saveOwnerAppearance({ preventDefault() {}, currentTarget: form });
assert.equal(elements.get("ownerAppearanceStatus").dataset.state, "error", "unconfirmed shared writes display an inline error");
assert.match(elements.get("ownerAppearanceStatus").textContent, /shared save was not confirmed/i);
assert.equal(JSON.parse(localStorage.getItem("shivan_shop_owner_appearance")).button, "#aa33cc", "a failed shared confirmation retains the safe local copy for retry");
context.failCloudWrite = false;

const oldTheme = runtime.getAppearance();
context.window.confirm = () => false;
await runtime.resetOwnerAppearance();
assert.deepEqual(JSON.parse(JSON.stringify(runtime.getAppearance())), JSON.parse(JSON.stringify(oldTheme)), "cancelled reset leaves every appearance setting unchanged");
assert.ok(localStorage.getItem("shivan_shop_owner_appearance"), "cancelled reset does not delete the saved shared-setting copy");
context.window.confirm = () => true;
const savedStoreInformation = { ...oldTheme, storeName: "Shivan Shop Test", contactEmail: "shop@example.test", deliveryAreas: "Owner-entered coverage", deliveryZones: [{ id: "zone-test-001", name: "Test only zone", fee: 1200 }], deliveryChargingEnabled: true };
runtime.setAppearance(savedStoreInformation);
localStorage.setItem("shivan_shop_owner_appearance", JSON.stringify(savedStoreInformation));
await runtime.resetOwnerAppearance();
assert.equal(runtime.getAppearance().theme, "burgundy", "reset restores the Burgundy design theme");
assert.equal(runtime.getAppearance().storeName, "Shivan Shop Test", "reset preserves the store name");
assert.equal(runtime.getAppearance().contactEmail, "shop@example.test", "reset preserves store contact details");
assert.equal(runtime.getAppearance().deliveryAreas, "Owner-entered coverage", "reset preserves delivery information");
assert.deepEqual(JSON.parse(JSON.stringify(runtime.getAppearance().deliveryZones)), [{ id: "zone-test-001", name: "Test only zone", fee: 1200 }], "reset preserves owner-configured delivery zones and fees");
assert.equal(runtime.getAppearance().deliveryChargingEnabled, true, "reset preserves the delivery charging choice");
assert.ok(localStorage.getItem("shivan_shop_owner_appearance"), "the shared settings value remains when store information is still saved");
runtime.setAppearance(oldTheme);
localStorage.setItem("shivan_shop_owner_appearance", JSON.stringify(oldTheme));
await runtime.resetOwnerAppearance();
assert.equal(localStorage.getItem("shivan_shop_owner_appearance"), null, "confirmed reset removes only the existing Owner appearance key");
assert.equal(runtime.getAppearance().theme, "burgundy");
assert.equal(context.confirmedWrites.at(-1).key, "shivan_shop_owner_appearance", "reset uses the same shared Owner setting");

context.isOwner = () => false;
const protectedBox = { textContent: "", innerHTML: "" };
runtime.renderOwnerAppearance(protectedBox);
assert.match(protectedBox.textContent, /Only the store owner/);
const beforeUnauthorized = localStorage.getItem("shivan_shop_owner_appearance");
await runtime.saveOwnerAppearance({ preventDefault() {}, currentTarget: form });
await runtime.resetOwnerAppearance();
assert.equal(localStorage.getItem("shivan_shop_owner_appearance"), beforeUnauthorized, "non-owners cannot save or reset appearance settings");

assert.match(html, /CLOUD_OWNER_KEYS\s*=\s*new Set\(\[[^\]]*OWNER_APPEARANCE_KEY/);
assert.match(api, /"shivan_shop_owner_appearance"/, "the existing production API allows this shared setting key");
assert.match(api, /if \(account\.role !== "owner"\)/, "shared appearance changes remain protected by server-side Owner authorization");
assert.match(functionSource("confirmCloudShopWrites"), /!isOwner\(\)&&!isStaffSession\(\)/, "shared shop writes require an Owner or staff session before checking individual key permissions");
assert.match(functionSource("cloudCanWriteShopKey"), /if\(isOwner\(\)\)return true;[\s\S]*?return false;/, "staff access is restricted to explicitly permitted shop keys");

console.log("Owner theme regression checks passed: global page coverage, six presets including Burgundy, seven validated HEX color controls, font selection, contrast-safe colors, live preview, shared save/hydration, reset confirmation, and scoped staff authorization.");
