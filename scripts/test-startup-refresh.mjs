import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const sourceOf = (pattern, label) => {
  const match = html.match(pattern)?.[0] || "";
  assert.ok(match, "Could not find " + label + ".");
  return match;
};

const startup = sourceOf(/async function initializeCloud\(\)\{[\s\S]*?\n\}/, "cloud startup");
const refresh = sourceOf(/async function refreshCloudData\(\)\{[\s\S]*?\n\}/, "cloud refresh");
const apply = sourceOf(/function applyCloudData\(data\)\{[\s\S]*?\n\}/, "cloud data application");
const finishSplash = sourceOf(/function finishShopStartupSplash\(\)\{[\s\S]*?\n\}/, "branded splash");
const startupHandler = sourceOf(/document\.addEventListener\("DOMContentLoaded",\(\)=>\{[\s\S]*?\n\}\);/, "page startup handler");
const splashMarkup = sourceOf(/<section id="shopStartupSplash"[\s\S]*?<\/section>/, "animated brand startup screen");

assert.match(html, /SHOP_BRANDED_SPLASH_MS=2800/, "the branded logo should cover exactly 2.8 seconds");
assert.match(html, /window\.__SHIVAN_STARTUP_STARTED_AT=performance\.now\(\)/, "startup timing should begin in the document head, before cloud requests");
assert.match(splashMarkup, /<span class="shop-startup-logo" role="img" aria-label="Shivan Shop monogram">SH<\/span>/, "the startup screen should render the approved white SH monogram");
assert.match(splashMarkup, /<strong class="shop-startup-brand">BRAND SHIVAN SHOP<\/strong>/, "the startup screen should show the approved brand text");
assert.doesNotMatch(splashMarkup, /loading|preparing|spinner/i, "the startup screen should not show loading copy or a spinner");
assert.ok(html.indexOf('<body>') < html.indexOf('id="shopStartupSplash"') && html.indexOf('id="shopStartupSplash"') < html.indexOf('class="language-switcher"'), "the splash should paint before the rest of the page markup");
assert.match(html, /\.shop-startup-splash\{[^}]*place-items:center/, "the logo should be centered in the dark splash");
assert.match(html, /\.shop-startup-splash\{[^}]*background:radial-gradient\([^}]*#03050d/, "the splash should retain its dark background with a soft purple glow");
assert.match(html, /\.shop-startup-logo\{[^}]*border-radius:25px[^}]*color:#fff/, "the SH mark should remain white inside a rounded purple logo");
assert.match(html, /shop-startup-aura[^}]*animation:shopStartupAuraIn/, "a soft purple glow should appear first");
assert.match(html, /animation:shopStartupLogoIn 1\.8s cubic-bezier\(\.2,\.72,\.24,1\) \.12s both,shopStartupLogoPulse 2\.2s ease-in-out \.15s 1 both/, "the logo should fade and scale in over 1.8 seconds with a very gentle purple glow");
assert.match(html, /animation:shopStartupBrandIn \.85s[^}]*1\.15s both/, "the unchanged brand text should fade and slide gently into view");
assert.match(html, /animation:shopStartupSparkle 1\.35s ease-out \.55s 1 both/, "any sparkle should remain faint and slow rather than flash");
assert.match(html, /animation:shopStartupSplashOut \.55s ease-in-out/, "the splash should transition smoothly after its timed display");
assert.ok(html.includes("SHOP_BRANDED_SPLASH_MS=2800") && html.includes("},550);"), "the 2.8-second splash should transition smoothly into Shop");
assert.ok(.12 + 1.8 < 2.8 && .15 + 2.2 < 2.8 && 1.15 + .85 < 2.8 && .55 + 1.35 < 2.8, "the logo and gentle effects should finish before the 2.8-second transition");
assert.doesNotMatch(html, /shopStartupLightSweep|shopStartupLogoReveal/, "the splash should not use the superseded sweeping or logo-only animation");
assert.match(html, /@keyframes shopStartupShopIn/, "the shop should use a fade-and-slide entrance");
assert.match(startupHandler, /loadProducts\(\)[\s\S]*?renderProducts\(products\)[\s\S]*?initializeCloud\(\)/, "cached products must render before network startup");
assert.doesNotMatch(startupHandler, /showShopOnboardingIfNeeded/, "the branded splash should lead directly to Shop / Models");
assert.ok(startup.indexOf('cloudRequest("/api/bootstrap"') < startup.indexOf('cloudRequest("/api/auth/me"'), "both startup requests should begin together");
assert.ok(startup.indexOf('cloudRequest("/api/auth/me"') < startup.indexOf("await authPromise"), "auth should be awaited only after both startup requests have started");
assert.match(startup, /if\(cachedShopWasOpened\)\{[\s\S]*?openMain\(\{resumeIntent:false\}\)[\s\S]*?finishShopStartupSplash\(\)/, "a returning visitor should see cached shop content before cloud checks finish");
assert.match(startup, /openMain\(\{preserveProductGrid:cachedShopWasOpened\}\)/, "auth confirmation should preserve the displayed product grid");
assert.match(startup, /openMain\(\{resumeIntent:false\}\)/, "cached guest rendering must not consume a pending purchase intent before authentication is checked");
assert.doesNotMatch(startup, /location\.reload\(/, "startup and refresh must not reload the document");
assert.match(html, /if\(!changed\)return;/, "unchanged cloud data should not trigger a rerender");
assert.match(apply, /if\(productsChanged\)loadProducts\(\)/, "only product changes should re-read the product cache");
assert.match(apply, /if\(productsChanged\|\|favoritesChanged\)renderVisibleProductGrid\(\)/, "a product or favorite update should refresh the active browsing grid");
assert.match(finishSplash, /shopStartupCompleted=true;\s*showShopOnboardingIfNeeded\(\)/, "the model-selection flow should show onboarding after the branded splash");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const splashEvents = [];
let onboardingShown = 0;
let now = 1000;
const splashClasses = new Set();
const mainClasses = new Set();
const splashNode = { hidden: false, classList: { add: name => splashClasses.add(name), remove: name => splashClasses.delete(name) } };
const mainNode = { style: { display: "none" }, classList: { add: name => mainClasses.add(name), remove: name => mainClasses.delete(name) } };
const openedWith = [];
const splashSandbox = {
  SHOP_BRANDED_SPLASH_MS: 2800,
  shopStartupStartedAt: 1000,
  shopStartupSplashTimer: null,
  shopStartupHideTimer: null,
  shopStartupCompleted: false,
  performance: { now: () => now },
  document: { getElementById: id => id === "shopStartupSplash" ? splashNode : id === "mainApp" ? mainNode : null },
  openMain: options => { openedWith.push(options); mainNode.style.display = "block"; },
  showShopOnboardingIfNeeded: () => { onboardingShown += 1; },
  setTimeout: (callback, ms) => { splashEvents.push({ callback, ms }); return splashEvents.length; },
  clearTimeout: () => {},
};
runInNewContext(finishSplash + "\nglobalThis.finishSplash=finishShopStartupSplash;", splashSandbox);
splashSandbox.finishSplash();
assert.equal(splashNode.hidden, false, "the logo remains visible until its branded interval ends");
assert.equal(splashEvents[0]?.ms, 2800, "the splash timer should be measured from startup, not data completion");
now = 3800;
splashEvents[0].callback();
assert.equal(openedWith.length, 1, "the 2.8-second timer should open Shop once");
assert.equal(openedWith[0]?.resumeIntent, false, "the startup transition should not resume an unverified purchase");
assert.equal(onboardingShown, 1, "the first onboarding slide should show as the splash hands off to the shop");
assert.equal(splashNode.hidden, false, "the logo should fade away smoothly after the 2.8-second mark");
assert.ok(splashClasses.has("is-exiting"), "the splash should fade out as the shop enters");
assert.ok(mainClasses.has("shop-startup-enter"), "the shop should fade and slide into view");
assert.equal(splashEvents[1]?.ms, 550, "the visual handoff should use the smooth exit animation");
now = 4350;
splashEvents[1].callback();
assert.equal(splashNode.hidden, true, "the splash should be removed after its transition completes");
assert.equal(splashSandbox.shopStartupCompleted, true, "the startup handoff should run only once");

const bootstrap = deferred();
const auth = deferred();
const backgroundSync = deferred();
const apiCalls = [];
const sequence = [];
const localStorage = { getItem: key => key === "shivan_shop_products" ? '[{"id":1}]' : null };
const startupSandbox = {
  SHOP_STARTUP_REQUEST_TIMEOUT_MS: 10000,
  PRODUCTS_KEY: "shivan_shop_products",
  localStorage,
  cloudMode: false,
  cloudAccount: null,
  currentUser: null,
  cloudOwnerSetupRequired: false,
  cloudInitializationComplete: false,
  cloudRequest: path => {
    apiCalls.push(path);
    return path === "/api/bootstrap" ? bootstrap.promise : auth.promise;
  },
  applyCloudData: () => sequence.push("bootstrap-applied"),
  openMain: options => sequence.push(options?.preserveProductGrid ? "shop-open-preserved" : "shop-open"),
  isShopOnboardingCompleted: () => true,
  finishShopStartupSplash: () => sequence.push("splash-ready"),
  startCloudSync: () => sequence.push("sync-started"),
  refreshCloudData: () => { sequence.push("background-refresh"); return backgroundSync.promise; },
  ownerSaveDiagnosticCode: () => "TEST_ERROR",
  isCapacitorNativeApp: () => true,
  isIOSCapacitorApp: () => true,
  nativeSessionToken: "",
  products: [{ id: 1 }],
  clearNativeSessionToken: async () => sequence.push("session-cleared"),
  showToast: message => sequence.push(message),
  isMainAppVisible: () => sequence.includes("shop-open"),
  hideIOSStartupGate: () => sequence.push("splash-ready"),
  showIOSLoggedOutExperience: () => sequence.push("logged-out"),
  showIOSAuth: () => sequence.push("auth-screen"),
  console: { warn: () => {} },
};
runInNewContext(startup + "\nglobalThis.initialize=initializeCloud;", startupSandbox);
const initialization = startupSandbox.initialize();
assert.deepEqual(apiCalls, ["/api/bootstrap", "/api/auth/me"], "bootstrap and session lookup should start in parallel");
assert.ok(sequence.includes("shop-open"), "a returning visitor with cached products should see the shop before cloud authentication finishes");
assert.ok(sequence.includes("splash-ready"), "cached shop display should release the branded splash on its minimum-duration timer");
auth.resolve({ account: { id: "cached-account", role: "customer" } });
await initialization;
assert.ok(sequence.indexOf("shop-open") < sequence.indexOf("background-refresh"), "the cached shop opens before shared sync finishes");
assert.equal(startupSandbox.cloudAccount.id, "cached-account");
assert.equal(startupSandbox.cloudInitializationComplete, true);
assert.ok(sequence.includes("shop-open-preserved"), "auth confirmation should retain the already-rendered product grid");
bootstrap.resolve({ ownerSetupRequired: false, shop: { shivan_shop_products: "[]" } });
backgroundSync.resolve({});
await Promise.resolve();
await Promise.resolve();
assert.equal(sequence.includes("bootstrap-applied"), false, "a late public bootstrap must not overwrite the authenticated snapshot");

const stored = new Map([["shivan_shop_ads", "old"]]);
const calls = { products: 0, categories: 0, banners: 0 };
const renderSandbox = {
  PRODUCTS_KEY: "shivan_shop_products", ADS_KEY: "shivan_shop_ads",
  IOS_ONBOARDING_KEY: "shivan_shop_ios_onboarding_images",
  SHOP_ONBOARDING_IMAGES_KEY: "shivan_shop_onboarding_images",
  OWNER_APPEARANCE_KEY: "shivan_shop_owner_appearance",
  OWNER_CATEGORIES_KEY: "shivan_shop_categories",
  OWNER_CATEGORY_META_KEY: "shivan_shop_category_meta",
  OWNER_CATEGORY_RENAMES_KEY: "shivan_shop_category_renames",
  OWNER_CATEGORY_DELETED_KEY: "shivan_shop_deleted_categories",
  FAVORITES_KEY: "shivan_shop_favorites", CART_KEY: "shivan_shop_cart",
  SETTINGS_KEY: "shivan_shop_settings", SUPPORT_KEY: "shivan_shop_support",
  ORDERS_KEY: "shivan_shop_orders", ACCOUNT_KEY: "shivan_shop_accounts",
  CLOUD_OWNER_KEYS: new Set(["shivan_shop_products", "shivan_shop_ads", "shivan_shop_onboarding_images", "shivan_shop_owner_appearance", "shivan_shop_categories", "shivan_shop_category_meta", "shivan_shop_category_renames", "shivan_shop_deleted_categories"]),
  cloudAccount: null, cloudHydrating: false,
  localStorage: { getItem: key => stored.get(key) ?? null },
  originalStorageSetItem: { call: (_storage, key, value) => stored.set(key, String(value)) },
  readCloudOutbox: () => ({}),
  cloudStorageKey: key => key,
  readIOSOnboardingImages: () => [],
  isMainAppVisible: () => true,
  loadProducts: () => calls.products++,
  loadOwnerAppearance: () => {},
  getAdvertisements: () => [],
  renderAdvertisements: () => calls.banners++,
  renderCategoryButtons: () => calls.categories++,
  renderProducts: () => calls.products++,
  renderShopOnboardingSlide: () => {},
  updateCartBadge: () => {},
  renderOrders: () => {},
  updateProfile: () => {},
  isOwner: () => false,
  document: { getElementById: () => ({ style: { display: "block" } }) },
};
runInNewContext(apply + "\nglobalThis.apply=applyCloudData;", renderSandbox);
renderSandbox.apply({ shop: { shivan_shop_ads: "new" }, user: {} });
assert.equal(calls.banners, 1, "a banner update should refresh the hero");
assert.equal(calls.products, 0, "a banner-only refresh must preserve the product image DOM");
assert.equal(calls.categories, 0, "a banner-only refresh must not rebuild categories");

let syncCalls = 0;
const syncResponse = deferred();
const refreshSandbox = {
  cloudMode: true, cloudRefreshPromise: null, cloudAccount: { id: "cached-account", role: "customer" }, currentUser: null,
  flushCloudWrites: async () => true,
  cloudRequest: async path => { assert.equal(path, "/api/sync"); syncCalls++; return syncResponse.promise; },
  applyCloudData: () => {},
};
runInNewContext(refresh + "\nglobalThis.refresh=refreshCloudData;", refreshSandbox);
const refreshOne = refreshSandbox.refresh();
const refreshTwo = refreshSandbox.refresh();
for (let turn = 0; turn < 5 && syncCalls === 0; turn++) await Promise.resolve();
assert.equal(syncCalls, 1, "overlapping timer/resume refreshes should share one request");
syncResponse.resolve({ shop: {}, user: {} });
await Promise.all([refreshOne, refreshTwo]);
assert.equal(refreshSandbox.cloudRefreshPromise, null, "the refresh lock should clear after completion");

console.log("Website startup checks passed: cached first render, parallel startup requests, exactly 2.8-second branded splash timing, nonblocking background sync, banner refresh without product-image rebuilds, and single-flight refresh.");
