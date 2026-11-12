import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const profileMarkup = html.match(/<div id="profileView"[\s\S]*?<\/div>\s*<!-- OWNER -->/)?.[0] || "";
const signupSource = html.match(/async function signup\(\)[\s\S]*?\n\}/)?.[0] || "";
const loginSource = html.match(/async function login\(\)[\s\S]*?\n\}/)?.[0] || "";
assert.match(profileMarkup, /id="profileGuestAccess"/);
assert.match(profileMarkup, /onclick="beginProfileAuthentication\('login'\)"/);
assert.match(profileMarkup, /onclick="beginProfileAuthentication\('signup'\)"/);
assert.match(html, /onclick="backToProfileAuthChoices\(\)"[^>]*aria-label="Back to Login or Sign Up choices"/);
assert.match(html, /#profileGuestAuthMount \.auth-form\{max-height:min\(68dvh,680px\);overflow:auto/);
assert.match(html, /id="shopAuthModalClose"[^>]*aria-label="Close Login or Sign Up"/);
assert.match(html, /event\.key==='Escape'.*closeGuestAuthenticationModal\(\)/, "the authentication modal should close with Escape for keyboard users");
assert.match(html, /event\.target===this&&this\.classList\.contains\('is-shop-auth-modal'\).*closeGuestAuthenticationModal\(\)/, "tapping the dimmed backdrop should close the modal");
assert.match(html, /#authPage\.auth\.is-shop-auth-modal\{[^}]*position:fixed;inset:0;[^}]*backdrop-filter:blur\(9px\)/, "guest authentication should appear in a viewport modal over the existing page");
assert.match(html, /@media\(prefers-reduced-motion:reduce\)\{#authPage\.is-shop-auth-modal\{animation:none!important\}\}/, "the modal should honor reduced-motion settings");
assert.match(html, /html\.shop-auth-modal-open,body\.shop-auth-modal-open\{overflow:hidden!important/, "the modal should lock page scrolling only while open");
assert.match(html, /function openView\(view,options=\{\}\)\{[\s\S]*?openGuestAuthenticationModal\(view\)/, "guest Cart and Profile should open auth without changing the active view first");
assert.match(html, /function openView\(view,options=\{\}\)\{[\s\S]*?is-shop-auth-modal[\s\S]*?return false/, "background or repeated navigation must not replace a guest modal's underlying page");
assert.match(html, /function openMain\(options=\{\}\)\{[\s\S]*?is-shop-auth-modal[\s\S]*?!currentUser&&!cloudAccount[\s\S]*?return false/, "startup hydration must not close the guest modal before authentication succeeds");
assert.match(html, /if\(intent\.type==="cart"\|\|intent\.type==="orders"\|\|intent\.type==="profile"\)\{\s*openView\(intent\.type\)/, "successful authentication should resume the Cart, Orders, or Profile destination that was requested");
assert.match(signupSource, /currentUser\s*=\s*account;[\s\S]*?openMain\(\)/, "successful Sign Up must enter shared post-auth navigation");
assert.match(loginSource, /currentUser=data\.account;[\s\S]*?openMain\(\)/, "successful cloud Login must enter shared post-auth navigation");
assert.match(loginSource, /currentUser\s*=\s*account;[\s\S]*?openMain\(\)/, "successful local Login must enter shared post-auth navigation");

function element(id, className = "") {
  const classes = new Set(className.split(/\s+/).filter(Boolean));
  const node = {
    id, className, hidden: false, style: {}, textContent: "", innerHTML: "", scrollTop: 0,
    children: [], parentNode: null, dataset: {},
    classList: {
      add(value) { classes.add(value); },
      remove(value) { classes.delete(value); },
      contains(value) { return classes.has(value); },
      toggle(value, force = !classes.has(value)) { if (force) classes.add(value); else classes.delete(value); return force; },
    },
    appendChild(child) {
      if (child.parentNode) child.parentNode.children = child.parentNode.children.filter(item => item !== child);
      child.parentNode = node;
      node.children.push(child);
      return child;
    },
    querySelector(selector) { return selector === ".auth-card" ? node.children.find(item => item.className.includes("auth-card")) || null : null; },
    focus() { this.focused = true; },
    setAttribute(name, value) { this[name] = value; },
    removeAttribute(name) { delete this[name]; },
  };
  return node;
}

const ids = new Map();
const get = (id, className = "") => {
  if (!ids.has(id)) ids.set(id, element(id, className));
  return ids.get(id);
};
const host = get("authCardHost");
const authCard = element("authCard", "auth-card");
host.appendChild(authCard);
for (const [id, cls] of [
  ["loginForm", "auth-form active"], ["signupForm", "auth-form"], ["loginTab", "active"], ["signupTab", ""],
  ["authPage", ""], ["authHeroEyebrow", ""], ["authHeroTitle", ""], ["authHeroDescription", ""],
  ["shopAuthModalClose", ""], ["languageSwitcher", "language-switcher"],
  ["profileView", "view page"], ["homeView", "view active"], ["storeView", "view page"], ["newModelView", "view page"], ["discountView", "view page"], ["favoritesView", "view page"], ["searchView", "view"], ["cartView", "view"], ["ordersView", "view page"],
  ["detailView", "view"], ["ownerView", "view"], ["profileGuestAccess", ""], ["profileGuestAuthMount", ""],
  ["authenticatedProfileCard", "profile-card"], ["profileAuthBack", ""], ["loginId", ""], ["signupName", ""],
  ["navHome", ""], ["navSearch", ""], ["navCart", ""], ["navOrders", ""], ["navProfile", ""], ["ownerPanelButton", ""], ["navAnalytics", ""],
  ["mainApp", ""],
]) get(id, cls);
get("profileGuestAccess").hidden = true;
get("profileGuestAuthMount").hidden = true;
get("authenticatedProfileCard").hidden = true;
get("profileAuthBack").hidden = true;
get("shopAuthModalClose").hidden = true;
get("mainApp").style.display = "block";
get("authPage").style.display = "none";

const app = element("app");
const nav = element("bottom-nav");
const body = element("body");
const root = element("html");
const loginChoice = element("profileLoginChoice");
const makeStorage = () => ({
  values: new Map(),
  setItem(key, value) { this.values.set(key, String(value)); },
  removeItem(key) { this.values.delete(key); },
  getItem(key) { return this.values.get(key) || null; },
});
const localSession = makeStorage();
const sessionSession = makeStorage();

const functionNames = [
  "restoreProfileAuthCard", "showGuestProfileChoices", "beginProfileAuthentication", "backToProfileAuthChoices",
  "showAuth", "resumeAuthenticationIntent", "getActiveShopView", "readShopViewPosition", "shopViewHistoryState", "writeShopViewHistory", "installShopViewNavigation", "openGuestAuthenticationModal", "closeGuestAuthenticationModal", "openView", "openMain", "updateHomeHeaderCountBadges",
];
const functionSources = functionNames.map(name => {
  const source = html.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`))?.[0];
  assert.ok(source, `the ${name} flow should exist`);
  return source;
}).join("\n");
const logoutSource = html.match(/async function logout\(\)[\s\S]*?\n\}/)?.[0];
assert.ok(logoutSource, "the async Logout flow should exist");

const context = {
  productDetailClosing: false,
  currentUser: null,
  cloudAccount: null,
  pendingAuthenticationIntent: null,
  shopOnboardingActive: false,
  SESSION_KEY: "offline-test-session",
  cloudMode: false,
  ownerPanel: "products",
  shopViewScrollPositions: new Map(),
  SHOP_HISTORY_VIEWS: new Set(["home", "search", "cart", "orders", "profile", "store", "newModel", "discount", "favorites", "owner"]),
  shopViewNavigationPopHandler: null,
  shopViewNavigationScrollHandler: null,
  ownerPanelHasPendingWork: () => false,
  products: [],
  cart: [],
  selectedSize: "",
  selectedColor: "",
  currentQty: 1,
  localStorage: localSession,
  sessionStorage: sessionSession,
  normalizeHexColor: color => String(color || "").toLowerCase(),
  variantStock: product => Number(product.variants?.[0]?.stock || 0),
  cartVariantCount: () => 0,
  openProduct(productId) { context.lastOpenedProductId = productId; },
  addDetailToCart() { context.cart.push({ productId: context.lastOpenedProductId, size: context.selectedSize, color: context.selectedColor, qty: context.currentQty }); },
  mergeGuestCartAfterAuthentication(items) { context.mergedGuestCart = items; },
  openCheckout() { context.checkoutOpened = true; },
  renderSizeOptions() {},
  renderColorOptions() {},
  updateDetailAvailability() {},
  stopCloudSync() {},
  resetShopOnboardingCompletion() {},
  showShopOnboarding() {},
  showToast() {},
  document: {
    activeElement: null,
    body,
    documentElement: root,
    addEventListener() {},
    getElementById: id => ids.get(id) || null,
    querySelector(selector) {
      if (selector === ".app") return app;
      if (selector === ".bottom-nav") return nav;
      if (selector === ".language-switcher") return get("languageSwitcher");
      if (selector === "#profileGuestAccess button") return loginChoice;
      return null;
    },
    querySelectorAll: () => [],
  },
  window: {
    scrollY: 0,
    history: { state: null, pushState(state) { this.state = state; }, replaceState(state) { this.state = state; } },
    addEventListener() {},
    scrollTo(_x, y) { this.scrollY = Number(y) || 0; },
  },
  requestAnimationFrame: callback => callback(),
  closeDetailImageFullscreen() {},
  hideShopOnboarding() {},
  isOwner: () => false,
  isStaffSession: () => false,
  renderOwnerPanel() {},
  renderProducts() {},
  updateCartBadge() {},
  renderOrders() {},
  updateProfile() { context.profileUpdated = true; },
  renderCart() {},
};
runInNewContext(`${functionSources}\n${logoutSource}\nthis.testApi={openView,openMain,beginProfileAuthentication,backToProfileAuthChoices,showAuth,openGuestAuthenticationModal,closeGuestAuthenticationModal,resumeAuthenticationIntent,logout};`, context);

get("homeView").scrollTop = 187;
context.window.scrollY = 34;
context.document.activeElement = get("navProfile");
assert.equal(context.testApi.openView("profile"), true, "guest Profile opens the Login / Sign Up modal");
assert.equal(get("homeView").classList.contains("active"), true, "opening guest Profile leaves the existing page active behind the modal");
assert.equal(get("profileView").classList.contains("active"), false, "guest Profile does not navigate away underneath the modal");
assert.equal(context.pendingAuthenticationIntent.type, "profile");
assert.equal(context.testApi.openView("profile"), false, "repeated Profile taps leave the same modal open");
assert.equal(context.testApi.openView("home"), false, "background navigation cannot replace the page under an open guest modal");
assert.equal(get("authPage").classList.contains("is-shop-auth-modal"), true);
assert.equal(get("homeView").classList.contains("active"), true);
assert.equal(get("authPage").classList.contains("is-shop-auth-modal"), true);
assert.equal(get("authPage").role, "dialog");
assert.equal(get("authPage")["aria-modal"], "true");
assert.equal(get("shopAuthModalClose").hidden, false, "the modal exposes its accessible close control");
assert.equal(get("loginForm").classList.contains("active"), true, "the existing Login form opens first");
assert.equal(get("signupForm").classList.contains("active"), false);
assert.equal(get("mainApp").inert, true, "the background shop is non-interactive while the modal is open");
assert.equal(get("languageSwitcher").inert, true, "controls outside the shop are also inactive while the modal is open");
assert.equal(root.classList.contains("shop-auth-modal-open"), true, "the root scroll lock starts with the modal");
assert.equal(body.classList.contains("shop-auth-modal-open"), true, "the body scroll lock starts with the modal");
assert.equal(get("homeView").scrollTop, 187);
assert.equal(context.window.scrollY, 34);
assert.equal(authCard.parentNode, host, "the existing shared Login / Sign Up card is reused");

context.testApi.openMain({resumeIntent:false});
assert.equal(get("authPage").classList.contains("is-shop-auth-modal"), true, "background startup/session hydration must not dismiss a guest authentication modal");
assert.equal(get("homeView").classList.contains("active"), true, "background hydration must not replace the page behind the guest modal");
assert.equal(get("homeView").scrollTop, 187, "background hydration must preserve the underlying section scroll position");
assert.equal(context.window.scrollY, 34, "background hydration must preserve the underlying window scroll position");

context.testApi.showAuth("signup");
assert.equal(get("signupForm").classList.contains("active"), true, "Sign Up switches inside the same modal");
assert.equal(get("authPage").classList.contains("is-shop-auth-modal"), true, "switching forms does not leave the modal");
context.testApi.showAuth("login");
assert.equal(context.testApi.closeGuestAuthenticationModal(), true);
assert.equal(get("authPage").classList.contains("is-shop-auth-modal"), false);
assert.equal(get("shopAuthModalClose").hidden, true);
assert.equal(context.pendingAuthenticationIntent, null, "closing the modal clears its pending destination");
assert.equal(get("homeView").classList.contains("active"), true, "closing returns to the exact page behind the modal");
assert.equal(get("homeView").scrollTop, 187, "closing restores the prior section scroll position");
assert.equal(context.window.scrollY, 34, "closing restores the prior window scroll position");
assert.equal(get("navProfile").focused, true, "closing returns keyboard focus to the Profile button");
assert.equal(get("mainApp").inert, false);
assert.equal(get("languageSwitcher").inert, false);
assert.equal(root.classList.contains("shop-auth-modal-open"), false);
assert.equal(body.classList.contains("shop-auth-modal-open"), false);

context.testApi.openView("search");
get("searchView").scrollTop = 311;
context.window.scrollY = 52;
context.document.activeElement = get("navCart");
assert.equal(context.testApi.openView("cart"), true, "guest Cart opens the same authentication modal");
assert.equal(context.pendingAuthenticationIntent.type, "cart");
assert.equal(get("searchView").classList.contains("active"), true, "Cart auth leaves Search visible behind the modal");
assert.equal(get("cartView").classList.contains("active"), false);
assert.equal(context.testApi.openView("profile"), false, "a repeated tap cannot replace the originally requested Cart destination");
assert.equal(context.pendingAuthenticationIntent.type, "cart");
assert.equal(context.testApi.openView("home"), false, "navigation stays locked to Search while guest Cart auth is open");
assert.equal(get("searchView").classList.contains("active"), true);
context.testApi.closeGuestAuthenticationModal();
assert.equal(get("searchView").scrollTop, 311, "closing Cart auth restores Search scroll exactly");
assert.equal(context.window.scrollY, 52);

assert.equal(context.testApi.openView("orders"), true, "guest Orders opens the same authentication modal");
assert.equal(context.pendingAuthenticationIntent.type, "orders");
assert.equal(get("searchView").classList.contains("active"), true, "Orders auth leaves the current page visible behind the modal");
context.testApi.closeGuestAuthenticationModal();
assert.equal(get("searchView").classList.contains("active"), true, "closing Orders auth restores the prior page");
context.pendingAuthenticationIntent = { type: "orders" };
context.currentUser = { id: "offline-orders-customer", role: "customer" };
context.testApi.resumeAuthenticationIntent();
assert.equal(get("ordersView").classList.contains("active"), true, "successful authentication opens the dedicated Orders screen");
assert.equal(get("searchView").classList.contains("active"), false);
context.currentUser = null;
context.testApi.openView("home");

const preservedCart = [{ productId: "dress-1", size: "M", color: "#123456", qty: 1 }];
context.cart = preservedCart;
context.document.activeElement = get("navProfile");
context.testApi.openView("profile");
context.currentUser = { id: "offline-login-customer", role: "customer" };
localSession.setItem(context.SESSION_KEY, JSON.stringify({ accountId: context.currentUser.id }));
context.testApi.openMain();
assert.equal(get("authPage").classList.contains("is-shop-auth-modal"), false, "successful Login closes the modal");
assert.equal(get("profileView").classList.contains("active"), true, "successful Login resumes the requested Profile destination");
assert.equal(get("homeView").classList.contains("active"), false);
assert.equal(context.currentUser.id, "offline-login-customer", "Login session stays active after redirect");
assert.ok(localSession.getItem(context.SESSION_KEY), "Login session storage remains intact after redirect");
assert.equal(context.cart, preservedCart, "the existing cart remains intact after Login");
assert.equal(context.pendingAuthenticationIntent, null);
assert.equal(root.classList.contains("shop-auth-modal-open"), false);
assert.equal(body.classList.contains("shop-auth-modal-open"), false);

context.testApi.openView("cart");
assert.equal(get("cartView").classList.contains("active"), true, "authenticated customers can open Cart directly");
context.testApi.openView("profile");
assert.equal(get("profileView").classList.contains("active"), true, "authenticated customers can open Profile directly");
assert.equal(get("authenticatedProfileCard").hidden, false, "authenticated navigation shows the customer's Profile");

await context.testApi.logout();
assert.equal(context.currentUser, null, "Logout clears the active account");
assert.equal(localSession.getItem(context.SESSION_KEY), null, "Logout clears the persistent session");
assert.equal(sessionSession.getItem(context.SESSION_KEY), null, "Logout clears the temporary session");
assert.equal(context.pendingAuthenticationIntent, null, "Logout clears any pending redirect intent");
assert.equal(context.cart, preservedCart, "Logout does not discard the cart");

context.testApi.openMain({resumeIntent:false});
context.testApi.openView("cart");
assert.equal(context.pendingAuthenticationIntent.type, "cart");
context.testApi.showAuth("signup");
assert.equal(get("signupForm").classList.contains("active"), true, "Cart users can choose Sign Up inside the modal");
context.currentUser = { id: "offline-signup-customer", role: "customer" };
sessionSession.setItem(context.SESSION_KEY, JSON.stringify({ accountId: context.currentUser.id }));
context.testApi.openMain();
assert.equal(get("cartView").classList.contains("active"), true, "successful Sign Up resumes the requested Cart destination");
assert.equal(get("homeView").classList.contains("active"), false);
assert.equal(context.currentUser.id, "offline-signup-customer", "Sign Up session stays active after redirect");
assert.ok(sessionSession.getItem(context.SESSION_KEY), "Sign Up session storage remains intact after redirect");
assert.equal(context.cart, preservedCart, "the existing cart remains intact after Sign Up");

context.products = [{ id: "dress-variant-7", variants: [{ size: "L", color: "#abcdef", stock: 8 }] }];
context.pendingAuthenticationIntent = { type: "product", productId: "dress-variant-7", size: "L", color: "#ABCDEF", quantity: 2 };
context.cart = [];
context.testApi.resumeAuthenticationIntent();
assert.equal(context.lastOpenedProductId, "dress-variant-7", "a saved product intent reopens the exact product");
assert.deepEqual(context.cart, [{ productId: "dress-variant-7", size: "L", color: "#abcdef", qty: 2 }], "the selected variant and quantity survive authentication");

const checkoutCart = [{ productId: "dress-checkout", size: "S", color: "#654321", qty: 2 }];
context.pendingAuthenticationIntent = { type: "checkout", cart: checkoutCart };
context.testApi.resumeAuthenticationIntent();
assert.equal(context.mergedGuestCart, checkoutCart, "checkout merges the guest cart after authentication");
assert.equal(context.checkoutOpened, true, "checkout resumes after authentication");

await context.testApi.logout();
assert.equal(context.currentUser, null, "Logout after Sign Up clears the active account");
assert.equal(context.pendingAuthenticationIntent, null);

console.log("Offline authentication checks passed: guest Cart/Orders/Profile modal behavior, background-hydration race protection, exact page/scroll restoration, repeated-tap protection, in-modal Login/Sign Up switching, requested destination after authentication, authenticated navigation, session/cart preservation, and existing product/checkout intent flows.");
