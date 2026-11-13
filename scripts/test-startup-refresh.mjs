import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const buildScript = await readFile(new URL("./build.mjs", import.meta.url), "utf8");
const splashOriginal = await readFile(new URL("../assets/branding/shivan-shop-cinematic-original.jpg", import.meta.url));
const splashBrand = await readFile(new URL("../assets/branding/shivan-shop-neon-brand.png", import.meta.url));
const sourceOf = (pattern, label) => {
  const match = html.match(pattern)?.[0] || "";
  assert.ok(match, "Could not find " + label + ".");
  return match;
};

const startup = sourceOf(/async function initializeCloud\(\)\{[\s\S]*?\n\}/, "cloud startup");
const refresh = sourceOf(/async function refreshCloudData\(\)\{[\s\S]*?\n\}/, "cloud refresh");
const apply = sourceOf(/function applyCloudData\(data\)\{[\s\S]*?\n\}/, "cloud data application");
const finishSplash = sourceOf(/function finishShopStartupSplash\(\){[\s\S]*?\n\}/, "branded splash");
const releaseBrand = sourceOf(/function releaseShopStartupBrand\(\){[\s\S]*?\n\}/, "persistent splash brand release");
const startupHandler = sourceOf(/document\.addEventListener\("DOMContentLoaded",\(\)=>\{[\s\S]*?\n\}\);/, "page startup handler");
const splashMarkup = sourceOf(/<section id="shopStartupSplash"[\s\S]*?<\/section>/, "animated brand startup screen");

assert.match(html,/SHOP_BRANDED_SPLASH_MS=shopStartupPrefersReducedMotion\?300:2000/,"the branded splash holds for two seconds");
assert.match(html,/SHOP_BRANDED_SPLASH_EXIT_MS=shopStartupPrefersReducedMotion\?0:500/,"the splash handoff is reduced-motion aware");
assert.ok(splashOriginal.subarray(0,3).equals(Buffer.from([0xff,0xd8,0xff])),"the previously supplied cinematic source asset is preserved");
const pngSignature=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
assert.ok(splashBrand.subarray(0,8).equals(pngSignature),"the supplied SHIVAN SHOP logo artwork is a PNG");
assert.equal(splashBrand.readUInt32BE(16),366,"the logo asset retains its designed width");
assert.equal(splashBrand.readUInt32BE(20),338,"the logo asset retains its designed height");
assert.match(splashMarkup,/<img class="shop-startup-brand" src="\/assets\/branding\/shivan-shop-neon-brand\.png"/,"the splash renders the supplied logo artwork");
assert.equal((splashMarkup.match(/<img\b/g)||[]).length,1,"the splash contains one undistorted logo image");
assert.match(buildScript,/"shivan-shop-neon-brand\.png"/,"future builds copy the supplied logo into dist");
assert.match(html,/<link rel="preload" as="image" href="\/assets\/branding\/shivan-shop-neon-brand\.png" fetchpriority="high">/,"the logo is preloaded before the splash paints");
const splashCss=html.match(/\.shop-startup-splash\{[^}]*\}/)?.[0]||"";
for(const declaration of ["position:fixed","inset:0","background:#030009","overflow:hidden"])assert.ok(splashCss.includes(declaration),"splash viewport rule includes "+declaration);
assert.match(html,/\.shop-startup-brand\{[^}]*object-fit:contain/,"the logo keeps its original aspect ratio");
assert.match(html,/\.shop-startup-brand\{[^}]*opacity:1;transform:translate3d\(-50%,-50%,0\) scale\(1\)[^}]*transition:top 780ms[^}]*transform 780ms/,"the original logo starts visible and uses smooth positional transitions");
assert.match(html,/\.shop-startup-splash\.is-onboarding-brand \.shop-startup-brand\{top:calc\(env\(safe-area-inset-top\) \+ clamp\(110px,19dvh,160px\)\);transform:translate3d\(-50%,-50%,0\) scale\(\.68\)/,"the same logo lifts into its persistent Welcome position");
assert.match(html,/\.shop-startup-splash::before,.shop-startup-splash::after[^}]*rgba\(174,75,255/,"the splash uses restrained purple wave accents");
assert.match(html,/@media\(min-width:700px\)\{\.shop-startup-splash\{inset:50% auto auto 50%;width:min\(430px/,"Windows keeps the splash in its centered iPhone frame");
assert.match(html,/@media\(max-width:699px\)\{\.shop-startup-splash\{inset:0;width:100vw;width:100dvw;height:100vh;height:100dvh/,"iPhone uses the full dynamic viewport");
assert.match(html,/SHOP_BRANDED_SPLASH_MS=shopStartupPrefersReducedMotion\?300:2000/);
assert.match(html,/transition:top 780ms cubic-bezier\(\.22,\.78,\.2,1\)/,"the logo movement has a deliberate, smooth 780ms duration");
assert.match(html,/@media\(prefers-reduced-motion:reduce\)\{\.shop-startup-brand\{animation:none!important/,"the logo animation respects reduced-motion preferences");
assert.match(html,/#mainApp\.shop-startup-enter\{animation:shopStartupShopIn 500ms/,"the existing app fades in during the handoff");
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
assert.match(finishSplash,/shopStartupCompleted=true;[\s\S]*?showShopOnboardingIfNeeded\(\{startupReveal:true\}\)[\s\S]*?classList.add\("is-onboarding-brand"\)/,"the startup welcome reveal keeps the same logo visible above Welcome");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const splashEvents = [];
let onboardingShown = 0;
const onboardingOptions = [];
let now = 1000;
const splashClasses = new Set();
const mainClasses = new Set();
const splashNode = { hidden: false, classList: { add: name => splashClasses.add(name), remove: name => splashClasses.delete(name), contains: name => splashClasses.has(name) } };
const mainNode = { style: { display: "none" }, classList: { add: name => mainClasses.add(name), remove: name => mainClasses.delete(name) } };
const openedWith = [];
const splashSandbox = {
  SHOP_BRANDED_SPLASH_MS: 2000,
  SHOP_BRANDED_SPLASH_EXIT_MS: 500,
  shopStartupStartedAt: 1000,
  shopStartupSplashTimer: null,
  shopStartupSplashHideTimer: null,
  shopStartupCompleted: false,
  performance: { now: () => now },
  document: { getElementById: id => id === "shopStartupSplash" ? splashNode : id === "mainApp" ? mainNode : null },
  openMain: options => { openedWith.push(options); mainNode.style.display = "block"; },
  showShopOnboardingIfNeeded: options => { onboardingShown += 1; onboardingOptions.push(options); return true; },
  setTimeout: (callback, ms) => { splashEvents.push({ callback, ms }); return splashEvents.length; },
  clearTimeout: () => {},
};
runInNewContext(finishSplash + "\nglobalThis.finishSplash=finishShopStartupSplash;", splashSandbox);
splashSandbox.finishSplash();
assert.equal(splashNode.hidden, false, "the brand artwork remains visible until its branded interval ends");
assert.equal(splashEvents[0]?.ms, 2000, "the splash timer should be measured from startup, not data completion");
now = 3100;
splashEvents[0].callback();
assert.equal(openedWith.length, 1, "the 2.1-second splash hold should open Shop once");
assert.equal(openedWith[0]?.resumeIntent, false, "the startup transition should not resume an unverified purchase");
assert.equal(onboardingShown, 1, "the first Welcome screen shows after the centered Splash");
assert.equal(onboardingOptions[0]?.startupReveal,true,"startup explicitly sequences the Welcome entrance");
assert.equal(splashNode.hidden, false, "the same splash logo remains visible throughout Welcome");
assert.ok(splashClasses.has("is-onboarding-brand"), "the original logo stays in its Welcome position");
assert.equal(splashClasses.has("is-exiting"),false,"the original logo does not fade during the Splash-to-Welcome transition");
assert.ok(mainClasses.has("shop-startup-enter"), "the shop should fade and slide into view");
assert.equal(splashEvents.length,1,"startup does not schedule a timer that removes the persistent Welcome logo");
splashNode.hidden=false;
const releaseEvents=[];
const releaseSandbox={document:{getElementById:()=>splashNode},shopStartupSplashHideTimer:null,shopStartupPrefersReducedMotion:false,SHOP_BRANDED_SPLASH_EXIT_MS:500,setTimeout:(callback,ms)=>{releaseEvents.push({callback,ms});return releaseEvents.length;},clearTimeout:()=>{}};
runInNewContext(releaseBrand+"\nglobalThis.release=releaseShopStartupBrand;",releaseSandbox);
assert.equal(releaseSandbox.release(),true,"the logo is released only when Welcome hands off to another screen");
assert.equal(splashNode.hidden,false,"the logo remains visible during the final screen handoff");
assert.equal(releaseEvents[0]?.ms,500,"the final logo exit uses the existing smooth handoff duration");
releaseEvents[0].callback();
assert.equal(splashNode.hidden,true,"the logo layer is removed only after the destination transition");
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
  isStaffSession: () => false,
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
  OWNER_SMART_ALERTS_KEY: "shivan_shop_owner_alerts",
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

console.log("Website startup checks passed: purple brand splash timing, reduced-motion handoff, cached first render, parallel startup requests, and nonblocking background sync.");
