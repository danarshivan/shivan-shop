import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const constantsStart = html.indexOf("const OWNER_THEME_PRESETS=");
const constantsEnd = html.indexOf("\nlet products = [", constantsStart);
assert.ok(constantsStart >= 0 && constantsEnd > constantsStart, "shared Owner appearance settings are defined");
const constants = html.slice(constantsStart, constantsEnd);
const functionSource = name => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const start = html.indexOf(`function ${name}(`);
  const asyncStart = html.indexOf(`async function ${name}(`);
  const actualStart = asyncStart >= 0 && (start < 0 || asyncStart < start) ? asyncStart : start;
  assert.ok(actualStart >= 0, `Expected function ${name} to exist`);
  const nextFunction = html.indexOf("\nfunction ", actualStart + 1);
  const nextAsyncFunction = html.indexOf("\nasync function ", actualStart + 1);
  const ends = [nextFunction, nextAsyncFunction].filter(index => index >= 0);
  return html.slice(actualStart, ends.length ? Math.min(...ends) : html.length).trim();
};

const required = [
  "safeAppearanceColor", "safeStoreLogoUrl", "normalizeOwnerAppearance", "normalizeOwnerDeliveryZones", "validateOwnerDeliveryZones", "normalizeOwnerNotificationPreferences", "readOwnerNotificationPreferences", "ownerNotificationPreferenceEnabled", "ownerSettingsTranslation", "ownerPanelRoute", "ownerSettingsCardMarkup",
  "renderOwnerSettingsHub", "ownerNavigationHeaderMarkup", "renderOwnerNotificationSettings", "saveOwnerNotificationPreferences", "renderOwnerStoreInformation", "clearOwnerStoreLogoDraft", "previewOwnerStoreInformation", "uploadOwnerStoreLogo",
  "ownerSettingsStatus", "saveOwnerStoreInformation", "ownerDeliveryZoneRowMarkup", "renderOwnerDeliveryZoneRows", "updateOwnerDeliveryZoneDraft", "addOwnerDeliveryZone", "removeOwnerDeliveryZone", "renderOwnerDeliverySettings", "saveOwnerDeliverySettings", "renderCheckoutDeliveryOptions", "getCheckoutDeliverySelection", "updateCheckoutPriceSummary",
  "renderOwnerSecuritySettings", "saveOwnerSecurity", "renderOwnerBackupSync", "refreshOwnerSettingsSync", "renderCheckoutStoreInfo",
];
const functions = required.map(functionSource).join("\n");
const storage = new Map();
const elements = new Map();
const writes = [];
const requests = [];
const toasts = [];
const makeElement = (value = "") => ({ value, textContent: "", innerHTML: "", hidden: false, style: {}, dataset: {}, disabled: false, attributes: {}, tagName: "INPUT", setAttribute(key, item) { this.attributes[key] = item; }, removeAttribute(key) { delete this.attributes[key]; }, replaceWith(node) { this.replacement = node; }, querySelector() { return this.submitButton || null; } });
const document = {
  getElementById(id) { return elements.get(id) || null; },
  querySelector() { return null; },
  querySelectorAll() { return context.deliveryRows || []; },
  createElement(tagName) { return tagName === "canvas" ? { width: 0, height: 0, getContext() { return { drawImage() {} }; } } : { tagName: tagName.toUpperCase(), setAttribute() {}, replaceWith() {}, prepend() {} }; },
};
const localStorage = {
  getItem(key) { return storage.has(key) ? storage.get(key) : null; },
  setItem(key, value) { storage.set(key, String(value)); },
  removeItem(key) { storage.delete(key); },
};
const context = {
  URL,
  location: { origin: "https://shop.example.test" },
  document,
  localStorage,
  activeLanguage: "en",
  ownerPanel: "settings-information",
  ownerDashboardNavKey: "settings-information",
  ownerOrderDetailId: "",
  ownerDashboardNavItems: () => [],
  ownerPanel: "settings-information",
  ownerDashboardNavKey: "settings-information",
  ownerOrderDetailId: "",
  ownerDashboardNavItems: () => [],
  ownerDashboardText: (en, ku = en, ar = en) => context.activeLanguage === "ar" ? ar : context.activeLanguage === "ku" ? ku : en,
  escapeHtml: value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"),
  isOwner: () => context.authorized,
  authorized: true,
  cloudMode: true,
  cloudAccount: { id: "owner-1", role: "owner", name: "Store Owner" },
  currentUser: { role: "owner" },
  ownerSaveDiagnostic() {},
  ownerSaveDiagnosticCode: () => "TEST_ERROR",
  createOwnerSaveRequestId: () => `settings-${writes.length}`,
  confirmCloudShopWrite: async (key, requestId) => {
    if (context.failSharedWrite) throw Object.assign(new Error("Unavailable"), { requestId: "settings-test-failure" });
    writes.push({ key, requestId, value: localStorage.getItem(key) });
  },
  cloudRequest: async (path, options) => { requests.push({ path, options }); return { ok: true }; },
  prepareOwnerCropSource: async () => ({ bitmap: { width: 900, height: 700, close() {} }, objectUrl: "blob:test-logo" }),
  releasePreparedCropSource() { context.logoSourceReleased = true; },
  canvasBlob: async (_canvas, type) => ({ type, size: 128 }),
  uploadOwnerImageToCloud: async blob => { context.logoUploadType = blob.type; return "/api/media/shop/" + "B".repeat(43) + ".webp"; },
  prepareOwnerCropSource: async () => ({ bitmap: { width: 900, height: 700, close() {} }, objectUrl: "blob:test-logo" }),
  releasePreparedCropSource() { context.logoSourceReleased = true; },
  canvasBlob: async (_canvas, type) => ({ type, size: 128 }),
  uploadOwnerImageToCloud: async blob => { context.logoUploadType = blob.type; return "/api/media/shop/" + "B".repeat(43) + ".webp"; },
  refreshCloudData: async () => ({ shop: {} }),
  exportLegacyBackup() {},
  migrateLegacyBackup() {},
  showToast: message => toasts.push(message),
  getCart: () => context.cart || [],
  cartItemPricing: () => ({ finalPrice: 5000 }),
  formatPrice: value => `${Number(value).toLocaleString("en-US")} IQD`,
  applyOwnerAppearance() { context.appearanceApplied = (context.appearanceApplied || 0) + 1; },
  renderAdvertisements() {},
  renderOwnerPanel() {},
  ownerSaveDiagnostic() {},
};
const runtime = runInNewContext(`const OWNER_APPEARANCE_KEY="shivan_shop_owner_appearance";const OWNER_NOTIFICATION_PREFERENCES_KEY="shivan_shop_owner_notification_preferences";const OWNER_NOTIFICATION_EVENT_TYPES=["new_order","low_stock","out_of_stock","discount_expiring","discount_expired"];let ownerDeliveryZonesDraft=[];const MAX_CLOUD_IMAGE_BYTES=1300000;const MAX_OWNER_IMAGE_INPUT_BYTES=15*1024*1024;\n${constants}\n${functions}\n({${required.join(",")},getAppearance:()=>ownerAppearance,setAppearance:value=>ownerAppearance=value,isAppearanceSaved:()=>ownerAppearanceSaved,setDeliveryZones:value=>ownerDeliveryZonesDraft=value,getDeliveryZones:()=>ownerDeliveryZonesDraft})`, context);

const routeNames = ["settings-appearance", "settings-information", "settings-notifications", "settings-delivery", "settings-security", "settings-backup"];
for (const [route, panel] of [["store-settings", "settings"], ...routeNames.map(route => [route, route === "settings-appearance" ? "appearance" : route.replace("settings-", "settings-")])]) {
  assert.equal(runtime.ownerPanelRoute(route).panel, panel, `${route} routes to its dedicated settings panel`);
}
for (const route of routeNames) {
  context.ownerDashboardNavKey = route;
  assert.match(runtime.ownerNavigationHeaderMarkup(), /onclick="ownerNavigateBack\(\)"/, route + " has a clear Back button");
}
assert.match(functionSource("renderOwnerPanel"), /ownerNavigationHeaderMarkup\(\)/, "Owner subsections render the shared Back header");
for (const route of routeNames) {
  context.ownerDashboardNavKey = route;
  assert.match(runtime.ownerNavigationHeaderMarkup(), /onclick="ownerNavigateBack\(\)"/, route + " has a clear Back button");
}
assert.match(functionSource("renderOwnerPanel"), /ownerNavigationHeaderMarkup\(\)/, "Owner subsections render the shared Back header");
const hub = makeElement();
runtime.renderOwnerSettingsHub(hub);
assert.equal((hub.innerHTML.match(/class="owner-settings-card"/g) || []).length, 6, "the settings hub displays exactly six cards");
for (const name of ["Appearance", "Store Information", "Notifications", "Delivery &amp; Orders", "Security", "Backup &amp; Sync"]) assert.ok(hub.innerHTML.includes(name), `the hub includes ${name}`);
for (const route of routeNames) assert.ok(hub.innerHTML.includes(`renderOwnerPanel('${route}')`), `${route} has its own navigation target`);

context.authorized = false;
const denied = makeElement();
runtime.renderOwnerSettingsHub(denied);
assert.match(denied.textContent, /Only the store owner/);
assert.equal(denied.innerHTML, "", "ordinary customers do not receive Store Settings controls");
runtime.renderOwnerStoreInformation(denied);
assert.equal(denied.innerHTML, "", "the Store Information editor remains Owner-only");
runtime.renderOwnerSecuritySettings(denied);
assert.equal(denied.innerHTML, "", "the Security editor remains Owner-only");
runtime.renderOwnerNotificationSettings(denied);
assert.equal(denied.innerHTML, "", "notification preferences remain Owner-only");
context.authorized = true;

assert.equal(runtime.safeStoreLogoUrl("javascript:alert(1)"), "", "script URLs are rejected for the store logo");
assert.equal(runtime.safeStoreLogoUrl("http://untrusted.example/logo.png"), "", "insecure external logo URLs are rejected");
assert.match(runtime.safeStoreLogoUrl("/api/media/shop/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.webp"), /^\/api\/media\/shop\//, "existing shared media addresses are accepted");

for (const language of ["ku", "ar"]) {
  context.activeLanguage = language;
  const translatedInfo = makeElement(), translatedDelivery = makeElement(), translatedSecurity = makeElement(), translatedBackup = makeElement(), translatedHub = makeElement();
  runtime.renderOwnerSettingsHub(translatedHub); runtime.renderOwnerStoreInformation(translatedInfo); runtime.renderOwnerDeliverySettings(translatedDelivery); runtime.renderOwnerSecuritySettings(translatedSecurity); runtime.renderOwnerBackupSync(translatedBackup);
  const expected = language === "ku" ? ["زانیاریێن فرۆشگە", "گەهاندن و داخوازی", "پاراستن", "پاشەکەفتن و هاوکاتکرن"] : ["معلومات المتجر", "التوصيل والطلبات", "الأمان", "النسخ الاحتياطي والمزامنة"];
  for (const phrase of expected) assert.ok([translatedInfo.innerHTML, translatedDelivery.innerHTML, translatedSecurity.innerHTML, translatedBackup.innerHTML, translatedHub.innerHTML].some(markup => markup.includes(phrase)), `${language} Store Settings include ${phrase}`);
}
context.activeLanguage = "en";
const initial = { ...runtime.getAppearance(), theme: "pink", storeName: "Old Shivan Shop", storeLogoUrl: "/api/media/shop/" + "A".repeat(43) + ".webp" };
runtime.setAppearance(initial);
const infoBox = makeElement();
runtime.renderOwnerStoreInformation(infoBox);
assert.match(infoBox.innerHTML, /id="ownerStoreLogoFile"/, "Store Information exposes a logo file picker");
for (const id of ["ownerStoreName", "ownerTagline", "ownerHeroTitle", "ownerStoreDescription", "ownerStoreLogoUrl", "ownerContactPhone", "ownerContactEmail", "ownerStoreAddress", "ownerStoreInformationStatus"]) elements.set(id, makeElement());
elements.get("ownerStoreName").value = "Shivan Boutique";
elements.get("ownerTagline").value = "Everyday fashion";
elements.get("ownerHeroTitle").value = "New arrivals";
elements.get("ownerStoreDescription").value = "New collections weekly";
elements.get("ownerStoreLogoUrl").value = "/api/media/shop/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.webp";
elements.get("ownerContactPhone").value = "+9647500000000";
elements.get("ownerContactEmail").value = "hello@shivan.example";
elements.get("ownerStoreAddress").value = "Erbil";
for (const id of ["ownerStoreInformationPreviewName", "ownerStoreInformationPreviewTagline", "ownerStoreInformationPreviewHeading", "ownerStoreInformationPreviewDescription", "ownerStoreInformationPreviewPhone", "ownerStoreInformationPreviewEmail", "ownerStoreInformationPreviewAddress"]) elements.set(id, makeElement());
const previewLogo = makeElement(); previewLogo.tagName = "IMG";
const previewMount = makeElement(); previewMount.querySelector = () => previewLogo;
elements.set("ownerStoreInformationPreview", previewMount); elements.set("ownerStoreLogoPreview", previewLogo);
const storeForm = makeElement();
storeForm.dataset = {};
storeForm.submitButton = makeElement();
elements.set("ownerStoreInformationForm", storeForm);
runtime.previewOwnerStoreInformation();
assert.equal(elements.get("ownerStoreInformationPreviewName").textContent, "Shivan Boutique", "the preview includes the edited store name");
assert.equal(elements.get("ownerStoreInformationPreviewHeading").textContent, "New arrivals", "the preview includes the banner heading");
assert.equal(elements.get("ownerStoreInformationPreviewDescription").textContent, "New collections weekly", "the preview includes the full description");
assert.equal(elements.get("ownerStoreInformationPreviewPhone").textContent, "+9647500000000", "the preview includes the phone number");
assert.equal(elements.get("ownerStoreInformationPreviewEmail").textContent, "hello@shivan.example", "the preview includes the email address");
assert.equal(elements.get("ownerStoreInformationPreviewAddress").textContent, "Erbil", "the preview includes the store address");
await runtime.saveOwnerStoreInformation({ preventDefault() {}, currentTarget: storeForm });
const storeSettings = JSON.parse(localStorage.getItem("shivan_shop_owner_appearance"));
assert.equal(storeSettings.storeName, "Shivan Boutique", "store information saves through the existing shared appearance record");
assert.equal(storeSettings.heroTitle, "New arrivals", "the optional shop heading persists in shared store settings");
assert.equal(storeSettings.theme, "pink", "saving Store Information preserves the selected appearance theme");
assert.equal(storeSettings.deliveryAreas, "", "saving Store Information leaves delivery settings intact");
assert.equal(writes.at(-1).key, "shivan_shop_owner_appearance", "store information uses the existing shared Owner settings key");
assert.equal(storeForm.dataset.shivanDraftDirty, "false", "a saved Store Information form is no longer marked unsaved");
const oldLogoUrl = storeSettings.storeLogoUrl;
elements.get("ownerStoreLogoUrl").value = "";
await runtime.saveOwnerStoreInformation({ preventDefault() {}, currentTarget: storeForm });
assert.equal(JSON.parse(localStorage.getItem("shivan_shop_owner_appearance")).storeLogoUrl, oldLogoUrl, "a blank logo address preserves the existing logo");
const logoPreview = makeElement();
logoPreview.tagName = "IMG";
const logoPreviewContainer = makeElement();
logoPreviewContainer.querySelector = () => logoPreview;
elements.set("ownerStoreInformationPreview", logoPreviewContainer);
elements.set("ownerStoreLogoPreview", logoPreview);
const logoInput = makeElement();
logoInput.value = "logo.png";
logoInput.files = [{ type: "image/png", size: 1200 }];
elements.set("ownerStoreLogoFile", logoInput);
assert.equal(await runtime.uploadOwnerStoreLogo(logoInput), true, "the Owner logo uses the shared image upload flow");
assert.equal(context.logoUploadType, "image/webp", "logo images are resized and compressed before shared storage");
assert.equal(context.logoSourceReleased, true, "temporary logo image resources are released after upload");
assert.equal(elements.get("ownerStoreLogoUrl").value, "/api/media/shop/" + "B".repeat(43) + ".webp", "the uploaded shared-media URL becomes the form draft");
assert.equal(storeForm.dataset.shivanDraftDirty, "true", "uploading marks the logo as an unsaved form change");
assert.equal(JSON.parse(localStorage.getItem("shivan_shop_owner_appearance")).storeLogoUrl, oldLogoUrl, "upload alone does not publish a Store Settings update");
await runtime.saveOwnerStoreInformation({ preventDefault() {}, currentTarget: storeForm });
assert.equal(JSON.parse(localStorage.getItem("shivan_shop_owner_appearance")).storeLogoUrl, elements.get("ownerStoreLogoUrl").value, "saving the form persists the uploaded logo reference");
elements.get("ownerStoreLogoUrl").value = ""; runtime.clearOwnerStoreLogoDraft();
await runtime.saveOwnerStoreInformation({ preventDefault() {}, currentTarget: storeForm });
assert.equal(JSON.parse(localStorage.getItem("shivan_shop_owner_appearance")).storeLogoUrl, "", "the explicit Remove current logo action clears the saved logo");
const writesBeforeInvalidPhone = writes.length;
elements.get("ownerContactPhone").value = "not a phone";
await runtime.saveOwnerStoreInformation({ preventDefault() {}, currentTarget: storeForm });
assert.match(elements.get("ownerStoreInformationStatus").textContent, /valid public phone number/, "invalid public phone numbers are rejected with clear feedback");
assert.equal(writes.length, writesBeforeInvalidPhone, "invalid phone data is not synchronized");
elements.get("ownerContactPhone").value = "+9647500000000";

const deliveryFormBox = makeElement();
const chargingToggle = makeElement(); chargingToggle.checked = false; elements.set("ownerDeliveryChargingEnabled", chargingToggle);
elements.set("ownerDeliveryZoneRows", makeElement());
runtime.renderOwnerDeliverySettings(deliveryFormBox);
assert.equal(chargingToggle.disabled, true, "delivery charging stays unavailable while no zones are configured");
assert.match(deliveryFormBox.innerHTML, /nothing is prefilled|no locations or prices are supplied/i, "delivery settings do not invent zones or prices");
const validTestZone = [{ id: "zone-test-001", name: "Test only zone", fee: "1200" }];
assert.deepEqual(JSON.parse(JSON.stringify(runtime.validateOwnerDeliveryZones(validTestZone))), [{ id: "zone-test-001", name: "Test only zone", fee: 1200 }], "valid owner-entered zones use whole IQD fees");
for (const fee of ["-1", "12.5", "10000001", ""]) assert.throws(() => runtime.validateOwnerDeliveryZones([{ id: "zone-test-001", name: "Test only zone", fee }]), /IQD fee/, `invalid fee ${fee} is rejected`);
assert.throws(() => runtime.validateOwnerDeliveryZones([{ id: "zone-test-001", name: "Same zone", fee: "0" }, { id: "zone-test-002", name: "same zone", fee: "1" }]), /unique/, "duplicate zone names are rejected");
for (const [id, value] of [["ownerDeliveryAreas", "Erbil, Dohuk"], ["ownerDeliveryEstimate", "1–3 days"], ["ownerCheckoutNotice", "<script>safe text</script>"], ["ownerOrderInstructions", "Check your address"]]) elements.set(id, makeElement(value));
const deliveryForm = makeElement();
deliveryForm.dataset = {};
deliveryForm.submitButton = makeElement();
elements.set("ownerDeliverySettingsForm", deliveryForm);
elements.set("checkoutStoreInfo", makeElement());
await runtime.saveOwnerDeliverySettings({ preventDefault() {}, currentTarget: deliveryForm });
const deliverySettings = JSON.parse(localStorage.getItem("shivan_shop_owner_appearance"));
assert.equal(deliverySettings.deliveryAreas, "Erbil, Dohuk", "delivery areas persist in shared settings");
assert.equal(deliverySettings.deliveryEstimate, "1–3 days", "delivery estimates persist in shared settings");
assert.deepEqual(JSON.parse(JSON.stringify(deliverySettings.deliveryZones)), [], "delivery starts with no invented zones or fees");
assert.equal(deliverySettings.deliveryChargingEnabled, false, "delivery charging starts inactive");
assert.equal(deliverySettings.theme, "pink", "delivery updates preserve the current appearance theme");
assert.equal(elements.get("checkoutStoreInfo").hidden, false, "saved business and delivery details are rendered in checkout");
assert.match(elements.get("checkoutStoreInfo").innerHTML, /&lt;script&gt;safe text&lt;\/script&gt;/, "customer-visible store settings are HTML escaped");
assert.match(deliveryFormBox.innerHTML, /Charging starts off/, "delivery controls clearly start inactive");
context.cart = [{ qty: 1 }];
elements.set("checkoutDeliveryZoneField", makeElement());
elements.set("checkoutPriceSummary", makeElement());
runtime.setDeliveryZones(validTestZone);
chargingToggle.checked = true;
runtime.updateOwnerDeliveryZoneDraft();
assert.equal(chargingToggle.disabled, false, "delivery charging unlocks after a valid owner-entered zone and fee");
await runtime.saveOwnerDeliverySettings({ preventDefault() {}, currentTarget: deliveryForm });
const configuredDelivery = JSON.parse(localStorage.getItem("shivan_shop_owner_appearance"));
assert.equal(configuredDelivery.deliveryChargingEnabled, true, "the Owner can enable a valid configured delivery zone");
assert.deepEqual(JSON.parse(JSON.stringify(configuredDelivery.deliveryZones)), [{ id: "zone-test-001", name: "Test only zone", fee: 1200 }]);
assert.match(elements.get("checkoutDeliveryZoneField").innerHTML, /Test only zone/);
assert.match(elements.get("checkoutDeliveryZoneField").innerHTML, /1,200 IQD/);
assert.equal(elements.get("checkoutPriceSummary").innerHTML.includes("6,200 IQD"), false, "checkout does not show a final total until a delivery zone is selected");
elements.set("checkoutDeliveryZone", makeElement("zone-test-001"));
assert.deepEqual(JSON.parse(JSON.stringify(runtime.getCheckoutDeliverySelection())), { id: "zone-test-001", name: "Test only zone", fee: 1200 });
runtime.updateCheckoutPriceSummary();
assert.match(elements.get("checkoutPriceSummary").innerHTML, /6,200 IQD/, "checkout total includes the selected zone fee");

const notificationBox = makeElement();
runtime.renderOwnerNotificationSettings(notificationBox);
context.activeLanguage = "ku"; runtime.renderOwnerNotificationSettings(notificationBox); assert.match(notificationBox.innerHTML, /ئاگاداری/, "notification preferences have Kurdish text");
context.activeLanguage = "ar"; runtime.renderOwnerNotificationSettings(notificationBox); assert.match(notificationBox.innerHTML, /الإشعارات/, "notification preferences have Arabic text");
context.activeLanguage = "en"; runtime.renderOwnerNotificationSettings(notificationBox);
for (const type of ["new_order", "low_stock", "out_of_stock", "discount_expiring", "discount_expired"]) { elements.set(`ownerNotify_${type}_inApp`, Object.assign(makeElement(), { checked: true })); elements.set(`ownerNotify_${type}_push`, Object.assign(makeElement(), { checked: true })); }
elements.get("ownerNotify_low_stock_inApp").checked = false;
elements.get("ownerNotify_discount_expired_push").checked = false;
const notificationForm = makeElement(); notificationForm.dataset = {}; notificationForm.submitButton = makeElement();
elements.set("ownerNotificationPreferencesForm", notificationForm); elements.set("ownerNotificationPreferencesStatus", makeElement());
await runtime.saveOwnerNotificationPreferences({ preventDefault() {}, currentTarget: notificationForm });
const savedNotificationPreferences = JSON.parse(localStorage.getItem("shivan_shop_owner_notification_preferences"));
assert.equal(savedNotificationPreferences.low_stock.inApp, false, "Owner in-app alert preferences are saved");
assert.equal(savedNotificationPreferences.discount_expired.push, false, "Owner push preferences are saved");
assert.equal(writes.at(-1).key, "shivan_shop_owner_notification_preferences", "Owner preferences sync through the private shared shop key");
assert.match(notificationBox.innerHTML, /renderOwnerPanel\('alerts'\)/, "Notifications links to existing Owner Smart Alerts");
assert.match(notificationBox.innerHTML, /renderOwnerPanel\('customer-notifications'\)/, "Notifications links to existing customer notifications");
const backupBox = makeElement();
runtime.renderOwnerBackupSync(backupBox);
assert.match(backupBox.innerHTML, /id="ownerBackupSync"/, "Backup & Sync keeps the existing restore control");
assert.match(backupBox.innerHTML, /migrateLegacyBackup/, "restore uses the existing import flow");
assert.match(backupBox.innerHTML, /refreshOwnerSettingsSync/, "shared sync can be refreshed from its dedicated section");
assert.match(backupBox.innerHTML, /Signed in to the shared Owner account/, "the panel states the signed-in status without overstating connectivity");

const securityBox = makeElement();
runtime.renderOwnerSecuritySettings(securityBox);
assert.match(securityBox.innerHTML, /autocomplete="current-password"/, "Security asks for the current password without exposing it");
assert.match(securityBox.innerHTML, /minlength="10"/, "Security uses the server's password minimum");
for (const [id, value] of [["ownerCurrentPassword", "current-owner-password"], ["ownerNewPassword", "new-owner-password-strong"], ["ownerConfirmNewPassword", "new-owner-password-strong"], ["ownerSecurityStatus", ""]]) elements.set(id, makeElement(value));
const securityForm = makeElement();
securityForm.dataset = {};
securityForm.submitButton = makeElement();
elements.set("ownerSecurityForm", securityForm);
await runtime.saveOwnerSecurity({ preventDefault() {}, currentTarget: securityForm });
assert.equal(requests.at(-1).path, "/api/auth/owner-password", "password changes use the server-side Owner-only endpoint");
assert.deepEqual(JSON.parse(requests.at(-1).options.body), { oldPassword: "current-owner-password", newPassword: "new-owner-password-strong" }, "only the password endpoint receives password input");
assert.equal(elements.get("ownerNewPassword").value, "", "password inputs are cleared after success");
assert.equal(localStorage.getItem("shivan_shop_owner_appearance").includes("new-owner-password"), false, "passwords never enter shared store settings");

assert.ok(html.includes("@media(max-width:620px){.owner-settings-grid{grid-template-columns:minmax(0,1fr);gap:9px}"), "settings cards collapse to one column on narrow mobile screens");
assert.match(html, /@media\(prefers-reduced-motion:reduce\)\{\.owner-settings-card/, "settings card transitions respect reduced motion");
assert.match(html, /id="checkoutStoreInfo"/, "customer-facing delivery details have a checkout mount point");

console.log("Store Settings checks passed: six Owner-only routes/cards, shared Store Information and Delivery persistence, validated logo/contact input, escaped checkout details, existing notification and backup links, and server-only Owner password handling.");
