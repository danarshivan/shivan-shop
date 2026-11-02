import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const source = name => {
  const body = html.match(new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\([^\\n]*\\)\\s*\\{[\\s\\S]*?\\n\\}`))?.[0];
  assert.ok(body, `Expected ${name}() in the website source`);
  return body;
};

assert.match(html, /class="detail-buy" onclick="addDetailToCart\(\)"/, "the existing product detail button must remain wired to the shared cart handler");
assert.match(html, /#authPage\.auth\.is-shop-auth-modal\{[^}]*position:fixed;inset:0;[^}]*backdrop-filter:blur\(9px\)/, "guest auth must remain a backdrop modal over the product page");
assert.match(html, /#authPage\.is-shop-auth-modal \.auth-card\{[^}]*width:min\(100%,460px\)/, "the auth panel must remain compact instead of becoming a full-screen login page");
assert.match(source("requireAuthentication"), /intent\?\.type==="product"[\s\S]*?openGuestAuthenticationModal\(intent\)/, "product purchase authentication must open the existing modal");
assert.match(source("resumeAuthenticationIntent"), /intent\.type==="product"[\s\S]*?addDetailToCart\(\)/, "successful authentication must resume the selected product add exactly once");
assert.match(source("addDetailToCart"), /requireAuthentication\(\{type:"product",productId:currentProduct\.id,size:selectedSize,color:selectedColor,quantity:currentQty\}\)/, "the product ID, selected size, color and quantity must be saved before auth");
assert.match(source("openMain"), /pendingAuthenticationIntent\?\.type==="product"[\s\S]*?return false/, "background startup work must not dismiss a pending product auth modal");
assert.match(source("openView"), /pendingAuthenticationIntent\?\.type==="product"[\s\S]*?return false/, "background navigation must not replace the product under the modal");

class ClassList {
  constructor(owner, values = []) { this.owner = owner; this.values = new Set(values); }
  add(...names) { names.forEach(name => this.values.add(name)); this.sync(); }
  remove(...names) { names.forEach(name => this.values.delete(name)); this.sync(); }
  contains(name) { return this.values.has(name); }
  toggle(name, force) {
    const add = force === undefined ? !this.values.has(name) : Boolean(force);
    if (add) this.values.add(name); else this.values.delete(name);
    this.sync();
    return add;
  }
  sync() { this.owner.className = [...this.values].join(" "); }
}

function createHarness({ signedIn = false, forSignup = false } = {}) {
  const elements = new Map();
  const document = { activeElement: null };
  function el(id, classes = "") {
    const node = {
      id, className: classes, classList: null, children: [], parentNode: null,
      style: { display: "" }, attributes: {}, scrollTop: 0, hidden: false, inert: false,
      value: "", checked: false, disabled: false, textContent: "", focused: false,
      appendChild(child) {
        if (child.parentNode) child.parentNode.children = child.parentNode.children.filter(item => item !== child);
        child.parentNode = this; this.children.push(child); return child;
      },
      querySelector(selector) { return selector === ".auth-card" ? this.children.find(child => child.classList.contains("auth-card")) || null : null; },
      setAttribute(name, value) { this.attributes[name] = String(value); this[name] = String(value); },
      removeAttribute(name) { delete this.attributes[name]; delete this[name]; },
      focus() { this.focused = true; document.activeElement = this; },
    };
    node.classList = new ClassList(node, classes.split(/\s+/).filter(Boolean));
    elements.set(id, node);
    return node;
  }
  const root = el("documentElement"); root.style.scrollBehavior = "smooth";
  const body = el("body");
  const app = el("app", "app");
  const mainApp = el("mainApp"); mainApp.style.display = "block";
  const authPage = el("authPage", "auth"); authPage.style.display = "none";
  const authCardHost = el("authCardHost");
  const authCard = el("authCard", "auth-card"); authCardHost.appendChild(authCard);
  const loginForm = el("loginForm", "auth-form active");
  const signupForm = el("signupForm", "auth-form");
  const loginTab = el("loginTab", "active");
  const signupTab = el("signupTab");
  const navNodes = [el("navHome", "nav-item"), el("navSearch", "nav-item"), el("navCart", "nav-item"), el("navProfile", "nav-item"), el("ownerPanelButton", "nav-item")];
  const navCartBadge = el("navCartBadge");
  const homeView = el("homeView", "view");
  const searchView = el("searchView", "view");
  const cartView = el("cartView", "view");
  const profileView = el("profileView", "view");
  const detailView = el("detailView", "view active"); detailView.scrollTop = 246;
  const ownerView = el("ownerView", "view");
  const buyButton = el("detailBuy");
  const product = { id: 701, name: "Night Bloom Dress", price: 42000, image: "/dress.webp", variants: [{ size: "M", color: "#9d62ef", stock: 8 }, { size: "L", color: "#9d62ef", stock: 5 }] };
  const guestCart = [{ id: "existing-guest-item", productId: 44, size: "S", color: "#111111", qty: 1 }];
  const storageData = new Map([["shivan_shop_cart_guest", JSON.stringify(guestCart)]]);
  const storage = {
    getItem(key) { return storageData.has(key) ? storageData.get(key) : null; },
    setItem(key, value) { storageData.set(key, String(value)); },
    removeItem(key) { storageData.delete(key); },
  };
  const account = { id: "customer-9", name: "Test Customer", identifier: "customer@example.test", password: "test-password-123", role: "customer" };
  const context = {
    document,
    window: { scrollY: 41, scrollTo(_x, y) { this.scrollY = y; } },
    localStorage: storage, sessionStorage: { ...storage },
    currentUser: signedIn ? account : null,
    cloudAccount: null,
    cloudMode: false,
    cloudOwnerSetupRequired: false,
    pendingAuthenticationIntent: null,
    shopAuthModalReturnState: null,
    shopOnboardingActive: false,
    productDetailClosing: false,
    currentProduct: product,
    products: [product],
    selectedSize: "M",
    selectedColor: "#9d62ef",
    currentQty: 2,
    cart: [],
    accounts: forSignup ? [] : [account],
    SESSION_KEY: "shivan_shop_session_test",
    CART_KEY: "shivan_shop_cart",
    OWNER_IDENTIFIER: "owner@example.test",
    OWNER_PASSWORD: "owner-password",
    ORDERS_KEY: "orders_test",
    shopViewScrollPositions: new Map(),
    ownerPanel: "products",
    windowScrollRestored: false,
    documentElement: root,
    body,
    app,
    mainApp,
    authPage,
    authCardHost,
    authCard,
    loginForm,
    signupForm,
    loginTab,
    signupTab,
    navNodes,
    homeView,
    searchView,
    cartView,
    profileView,
    detailView,
    buyButton,
    ownerPanelButton: elements.get("ownerPanelButton"),
    navCartBadge,
    bottomNav: el("bottomNav", "bottom-nav"),
    languageSwitcher: el("languageSwitcher", "language-switcher"),
    loginId: el("loginId"), loginPass: el("loginPass"), loginMsg: el("loginMsg"), rememberLogin: el("rememberLogin"),
    signupName: el("signupName"), signupId: el("signupId"), signupPass: el("signupPass"), signupConfirmPass: el("signupConfirmPass"), signupTerms: el("signupTerms"), signupMsg: el("signupMsg"),
    authHeroEyebrow: el("authHeroEyebrow"), authHeroTitle: el("authHeroTitle"), authHeroDescription: el("authHeroDescription"),
    shopAuthModalClose: el("shopAuthModalClose"), detailQty: el("detailQty"), detailStock: el("detailStock"),
    authPageCloseButton: null,
    getElementById(id) { return elements.get(id) || null; },
    querySelector(selector) {
      if (selector === ".app") return app;
      if (selector === ".bottom-nav") return this.bottomNav;
      if (selector === ".language-switcher") return this.languageSwitcher;
      if (selector === ".detail-buy") return buyButton;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === ".nav-item") return navNodes;
      if (selector === ".product-backdrop-revealed") return [];
      return [];
    },
  };
  context.document = {
    activeElement: buyButton,
    body,
    documentElement: root,
    getElementById: id => elements.get(id) || null,
    querySelector: context.querySelector.bind(context),
    querySelectorAll: context.querySelectorAll.bind(context),
  };
  context.document.body = body;
  context.document.documentElement = root;
  context.documentElement = root;
  context.document.body = body;
  context.document.querySelector = context.querySelector.bind(context);
  context.document.querySelectorAll = context.querySelectorAll.bind(context);
  context.requestAnimationFrame = callback => { callback(); return 1; };
  context.getActiveShopView = undefined;
  context.getAccounts = () => context.accounts;
  context.saveAccounts = accounts => { context.accounts = accounts; return true; };
  context.blockUnavailableHostedAccounts = () => false;
  context.hideShopOnboarding = () => {};
  context.isOwner = () => false;
  context.renderProducts = () => {};
  context.renderOrders = () => {};
  context.updateProfile = () => {};
  context.showToast = message => { context.toasts.push(message); };
  context.toasts = [];
  context.translateText = value => value;
  context.getProductName = item => item.name;
  context.getProductColorLabel = (_item, color) => color;
  context.renderSizeOptions = () => {};
  context.renderColorOptions = () => {};
  context.closeDetailImageFullscreen = () => {};
  context.mergeGuestCartAfterAuthentication = () => {};
  context.openCheckout = () => {};
  context.openProduct = id => {
    context.currentProduct = context.products.find(item => String(item.id) === String(id)) || null;
    context.testApi.openView("detail");
  };
  context.variantStock = (item, color, size) => item.variants.find(variant => variant.size === size && context.normalizeHexColor(variant.color) === context.normalizeHexColor(color))?.stock || 0;
  context.normalizeHexColor = value => String(value || "").trim().toLowerCase();
  context.cartVariantCount = (productId, size, color) => context.testApi.getCart().filter(item => item.productId === productId && item.size === size && context.normalizeHexColor(item.color) === context.normalizeHexColor(color)).reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
  context.toasts = [];
  context.authAccounts = context.accounts;
  context.showCartRenderCount = 0;
  context.renderCart = () => { context.showCartRenderCount++; };
  context.readShopViewPosition = undefined;
  context.getCart = undefined;
  context.saveCart = undefined;
  context.updateCartBadge = undefined;
  context.resumeAuthenticationIntent = undefined;
  context.localStorage = storage;
  context.sessionStorage = storage;
  context.setTimeout = setTimeout;
  context.Date = Date;
  context.console = console;
  context.products = [product];
  context.currentProduct = product;
  context.accounts = context.accounts;
  context.currentUser = signedIn ? account : null;
  context.cloudAccount = null;
  context.shopViewScrollPositions.set("detail", { windowY: 41, viewTop: 246, authTop: 0 });
  context.mainApp.style.display = "block";
  context.authPage.style.display = "none";
  context.loginId.value = account.identifier;
  context.loginPass.value = account.password;
  context.rememberLogin.checked = true;
  context.signupName.value = "New Customer";
  context.signupId.value = "new-customer@example.test";
  context.signupPass.value = "new-password-123";
  context.signupConfirmPass.value = "new-password-123";
  context.signupTerms.checked = true;

  const names = ["getProductPricing", "cartPriceSnapshot", "getCartKey", "getCart", "saveCart", "updateCartBadge", "normalizeHexColor", "variantStock", "cartVariantCount", "canAddToCart", "getActiveShopView", "readShopViewPosition", "restoreProfileAuthCard", "showAuth", "openGuestAuthenticationModal", "closeGuestAuthenticationModal", "requireAuthentication", "resumeAuthenticationIntent", "openMain", "openView", "updateDetailAvailability", "addDetailToCart", "quickAdd", "login", "signup"];
  const functions = names.map(source).join("\n");
  const vmContext = {
    ...context,
    document: context.document,
    window: context.window,
    localStorage: storage,
    sessionStorage: storage,
    requestAnimationFrame: context.requestAnimationFrame,
  };
  runInNewContext(`${functions}\nthis.testApi={getCart,addDetailToCart,quickAdd,login,signup,showAuth,closeGuestAuthenticationModal,resumeAuthenticationIntent,openMain,openView};`, vmContext);
  return { context: vmContext, elements, guestCart, account, product };
}

function cartFor(context) { return context.testApi.getCart(); }
function plain(value) { return JSON.parse(JSON.stringify(value)); }

const loginCase = createHarness();
const loginCtx = loginCase.context;
const detailBefore = { productId: loginCtx.currentProduct.id, size: loginCtx.selectedSize, color: loginCtx.selectedColor, quantity: loginCtx.currentQty, scroll: loginCtx.detailView.scrollTop };
loginCtx.testApi.addDetailToCart();
assert.equal(loginCtx.authPage.classList.contains("is-shop-auth-modal"), true, "guest Add to Cart should open the compact auth modal");
assert.equal(loginCtx.mainApp.inert, true, "the product page should remain visible but inert behind the overlay");
assert.equal(loginCtx.mainApp.style.display, "block", "the guest must not be sent to the separate auth page");
assert.equal(loginCtx.detailView.classList.contains("active"), true, "the same product detail view stays behind the modal");
assert.deepEqual({ productId: loginCtx.currentProduct.id, size: loginCtx.selectedSize, color: loginCtx.selectedColor, quantity: loginCtx.currentQty, scroll: loginCtx.detailView.scrollTop }, detailBefore);
assert.deepEqual(plain(loginCtx.pendingAuthenticationIntent), { type: "product", productId: detailBefore.productId, size: detailBefore.size, color: detailBefore.color, quantity: detailBefore.quantity });
assert.deepEqual(plain(cartFor(loginCtx)), loginCase.guestCart, "opening the modal must not add the item to the guest cart");
assert.equal(loginCtx.testApi.openMain({ resumeIntent: false }), false, "late startup/session work cannot close the guest product modal");
assert.equal(loginCtx.authPage.classList.contains("is-shop-auth-modal"), true);
assert.equal(loginCtx.detailView.classList.contains("active"), true);
assert.equal(loginCtx.detailView.scrollTop, detailBefore.scroll);
loginCtx.testApi.showAuth("signup");
assert.equal(loginCtx.authPage.classList.contains("is-shop-auth-modal"), true, "switching to Sign Up stays in the same overlay");
assert.equal(loginCtx.signupForm.classList.contains("active"), true);
assert.equal(loginCtx.pendingAuthenticationIntent.type, "product", "switching forms preserves the selected product intent");
loginCtx.testApi.closeGuestAuthenticationModal();
assert.equal(loginCtx.authPage.classList.contains("is-shop-auth-modal"), false);
assert.equal(loginCtx.detailView.classList.contains("active"), true, "closing the overlay returns to the unchanged product page");
assert.equal(loginCtx.detailView.scrollTop, detailBefore.scroll, "closing restores the exact product scroll position");
assert.deepEqual(plain(cartFor(loginCtx)), loginCase.guestCart, "closing without authenticating adds nothing");
assert.equal(loginCtx.pendingAuthenticationIntent, null);

loginCtx.testApi.addDetailToCart();
assert.equal(loginCtx.authPage.classList.contains("is-shop-auth-modal"), true);
loginCtx.testApi.addDetailToCart();
assert.deepEqual(plain(cartFor(loginCtx)), loginCase.guestCart, "repeated taps while the modal is open cannot add a duplicate");
await loginCtx.testApi.login();
const loginCart = cartFor(loginCtx);
assert.equal(loginCtx.authPage.classList.contains("is-shop-auth-modal"), false, "successful Login closes the modal");
assert.equal(loginCtx.currentUser.id, loginCase.account.id, "the existing customer login succeeds");
assert.equal(loginCtx.detailView.classList.contains("active"), true, "Login returns to the same product detail page");
assert.equal(loginCtx.currentProduct.id, detailBefore.productId);
assert.equal(loginCtx.selectedSize, detailBefore.size);
assert.equal(loginCtx.selectedColor, detailBefore.color);
assert.equal(loginCtx.currentQty, detailBefore.quantity);
assert.equal(loginCart.length, 1, "the pending item is added exactly once after Login");
assert.deepEqual({ productId: loginCart[0].productId, size: loginCart[0].size, color: loginCart[0].color, qty: loginCart[0].qty }, { productId: detailBefore.productId, size: detailBefore.size, color: detailBefore.color, qty: detailBefore.quantity });
assert.equal(loginCart[0].price, 42000, "no-discount guest purchases should preserve the existing original price");
assert.equal(loginCtx.navCartBadge.textContent, 2, "the cart badge reflects the saved quantity");
assert.ok(loginCtx.toasts.some(message => message.includes("سەبەت")), "adding after Login shows the existing compact success toast");
loginCtx.testApi.resumeAuthenticationIntent();
assert.equal(cartFor(loginCtx).length, 1, "replaying the consumed auth intent cannot add a duplicate");

const signupCase = createHarness({ forSignup: true });
const signupCtx = signupCase.context;
signupCtx.testApi.addDetailToCart();
assert.equal(signupCtx.authPage.classList.contains("is-shop-auth-modal"), true);
signupCtx.testApi.showAuth("signup");
await signupCtx.testApi.signup();
assert.equal(signupCtx.currentUser.identifier, "new-customer@example.test", "the existing Sign Up flow creates the account");
assert.equal(signupCtx.authPage.classList.contains("is-shop-auth-modal"), false);
assert.equal(signupCtx.detailView.classList.contains("active"), true, "Sign Up returns to the same product detail page");
assert.deepEqual(plain(cartFor(signupCtx).map(item => ({ productId: item.productId, size: item.size, color: item.color, qty: item.qty }))), [{ productId: signupCase.product.id, size: "M", color: "#9d62ef", qty: 2 }], "the selected variant is added exactly once after Sign Up");
assert.equal(signupCtx.navCartBadge.textContent, 2);

const signedInCase = createHarness({ signedIn: true });
const signedInCtx = signedInCase.context;
signedInCtx.testApi.addDetailToCart();
assert.equal(signedInCtx.authPage.classList.contains("is-shop-auth-modal"), false, "signed-in customers do not see the auth modal");
assert.equal(cartFor(signedInCtx).length, 1, "signed-in customers add directly to the cart");
assert.equal(cartFor(signedInCtx)[0].qty, 2);
assert.equal(signedInCtx.navCartBadge.textContent, 2);

const quickAddCase = createHarness();
const quickAddCtx = quickAddCase.context;
quickAddCtx.testApi.openView("home");
quickAddCtx.testApi.quickAdd(quickAddCase.product.id);
assert.equal(quickAddCtx.authPage.classList.contains("is-shop-auth-modal"), true, "guest card quick-add uses the same compact auth modal");
assert.equal(quickAddCtx.homeView.classList.contains("active"), true, "quick-add keeps the current product list behind the modal");
assert.deepEqual(plain(cartFor(quickAddCtx)), quickAddCase.guestCart, "quick-add also waits until authentication");
quickAddCtx.testApi.closeGuestAuthenticationModal();
assert.equal(quickAddCtx.homeView.classList.contains("active"), true);

console.log("Guest Add to Cart modal checks passed: detail and card add routes, pending add, product/variant/quantity/scroll preservation, in-modal Login/Sign Up, close without adding, background-route protection, exact-once add after Login and Sign Up, cart badge/toast, and direct signed-in add.");
