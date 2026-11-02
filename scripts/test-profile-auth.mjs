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
    focus() {},
    setAttribute(name, value) { this[name] = value; },
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
  ["profileView", "view page"], ["homeView", "view active"], ["searchView", "view"], ["cartView", "view"],
  ["detailView", "view"], ["ownerView", "view"], ["profileGuestAccess", ""], ["profileGuestAuthMount", ""],
  ["authenticatedProfileCard", "profile-card"], ["profileAuthBack", ""], ["loginId", ""], ["signupName", ""],
  ["navHome", ""], ["navSearch", ""], ["navCart", ""], ["navProfile", ""], ["ownerPanelButton", ""],
  ["mainApp", ""],
]) get(id, cls);
get("profileGuestAccess").hidden = true;
get("profileGuestAuthMount").hidden = true;
get("authenticatedProfileCard").hidden = true;
get("profileAuthBack").hidden = true;
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
  "showAuth", "resumeAuthenticationIntent", "getActiveShopView", "readShopViewPosition", "openView",
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
  SESSION_KEY: "offline-test-session",
  cloudMode: false,
  ownerPanel: "products",
  shopViewScrollPositions: new Map(),
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
    body,
    documentElement: root,
    getElementById: id => ids.get(id) || null,
    querySelector(selector) {
      if (selector === ".app") return app;
      if (selector === ".bottom-nav") return nav;
      if (selector === "#profileGuestAccess button") return loginChoice;
      return null;
    },
    querySelectorAll: () => [],
  },
  window: { scrollY: 0, scrollTo(_x, y) { this.scrollY = Number(y) || 0; } },
  requestAnimationFrame: callback => callback(),
  closeDetailImageFullscreen() {},
  hideShopOnboarding() {},
  isOwner: () => false,
  renderOwnerPanel() {},
  renderProducts() {},
  updateCartBadge() {},
  renderOrders() {},
  updateProfile() { context.profileUpdated = true; },
  renderCart() {},
};
runInNewContext(`${functionSources}\n${logoutSource}\nthis.testApi={openView,beginProfileAuthentication,backToProfileAuthChoices,resumeAuthenticationIntent,logout};`, context);

get("homeView").scrollTop = 187;
context.window.scrollY = 34;
context.testApi.openView("profile");
assert.equal(get("profileGuestAccess").hidden, false, "guest Profile opens the two choices first");
assert.equal(get("authenticatedProfileCard").hidden, true, "guest does not see an authenticated profile card");
assert.equal(context.pendingAuthenticationIntent.type, "profile");
assert.equal(context.shopViewScrollPositions.get("home").viewTop, 187, "navigation stores the exact prior Home scroll position");

assert.equal(context.testApi.beginProfileAuthentication("login"), true);
assert.equal(get("profileGuestAuthMount").hidden, false, "Login form is mounted in the Profile view");
assert.equal(authCard.parentNode, get("profileGuestAuthMount"));
assert.equal(get("loginForm").classList.contains("active"), true);
assert.equal(get("signupForm").classList.contains("active"), false);
assert.equal(get("profileAuthBack").hidden, false, "the inline Login form has a Back button");

context.testApi.backToProfileAuthChoices();
assert.equal(authCard.parentNode, host, "Back restores the shared auth card safely");
assert.equal(get("profileGuestAuthMount").hidden, true);
assert.equal(get("profileGuestAccess").hidden, false);

assert.equal(context.testApi.beginProfileAuthentication("signup"), true);
assert.equal(get("signupForm").classList.contains("active"), true);
assert.equal(get("loginForm").classList.contains("active"), false);
assert.equal(authCard.parentNode, get("profileGuestAuthMount"));

const preservedCart = [{ productId: "dress-1", size: "M", color: "#123456", qty: 1 }];
context.cart = preservedCart;
context.currentUser = { id: "offline-login-customer", role: "customer" };
localSession.setItem(context.SESSION_KEY, JSON.stringify({ accountId: context.currentUser.id }));
context.testApi.resumeAuthenticationIntent();
assert.equal(get("homeView").classList.contains("active"), true, "successful Login returns to Shop / Models");
assert.equal(get("profileView").classList.contains("active"), false, "successful Login does not redirect to Profile");
assert.equal(context.currentUser.id, "offline-login-customer", "Login session stays active after redirect");
assert.ok(localSession.getItem(context.SESSION_KEY), "Login session storage remains intact after redirect");
assert.equal(context.cart, preservedCart, "the existing cart remains intact after Login");
assert.equal(get("profileGuestAccess").hidden, true);
assert.equal(get("profileGuestAuthMount").hidden, true);
assert.equal(authCard.parentNode, host);
assert.equal(context.pendingAuthenticationIntent, null);
assert.equal(get("homeView").scrollTop, 187, "returning to Home restores its prior in-page scroll position");
assert.equal(context.window.scrollY, 34, "returning to Home restores the window scroll position");

context.testApi.openView("profile");
assert.equal(get("profileView").classList.contains("active"), true, "authenticated customers can still open Profile from navigation");
assert.equal(get("authenticatedProfileCard").hidden, false, "authenticated navigation shows the customer's Profile");

await context.testApi.logout();
assert.equal(context.currentUser, null, "Logout clears the active account");
assert.equal(localSession.getItem(context.SESSION_KEY), null, "Logout clears the persistent session");
assert.equal(sessionSession.getItem(context.SESSION_KEY), null, "Logout clears the temporary session");
assert.equal(context.pendingAuthenticationIntent, null, "Logout clears any pending redirect intent");
assert.equal(context.cart, preservedCart, "Logout does not discard the cart");

context.testApi.openView("profile");
assert.equal(context.pendingAuthenticationIntent.type, "profile");
assert.equal(context.testApi.beginProfileAuthentication("signup"), true);
context.currentUser = { id: "offline-signup-customer", role: "customer" };
sessionSession.setItem(context.SESSION_KEY, JSON.stringify({ accountId: context.currentUser.id }));
context.testApi.resumeAuthenticationIntent();
assert.equal(get("homeView").classList.contains("active"), true, "successful Sign Up returns to Shop / Models");
assert.equal(get("profileView").classList.contains("active"), false, "successful Sign Up does not redirect to Profile");
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

console.log("Offline Profile authentication checks passed: Login and Sign Up return to Shop, sessions and cart remain active, Profile stays accessible, product/variant and checkout intents resume, and Logout clears sessions safely.");
