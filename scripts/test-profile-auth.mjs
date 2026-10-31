import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const profileMarkup = html.match(/<div id="profileView"[\s\S]*?<\/div>\s*<!-- OWNER -->/)?.[0] || "";
assert.match(profileMarkup, /id="profileGuestAccess"/);
assert.match(profileMarkup, /onclick="beginProfileAuthentication\('login'\)"/);
assert.match(profileMarkup, /onclick="beginProfileAuthentication\('signup'\)"/);
assert.match(html, /onclick="backToProfileAuthChoices\(\)"[^>]*aria-label="Back to Login or Sign Up choices"/);
assert.match(html, /#profileGuestAuthMount \.auth-form\{max-height:min\(68dvh,680px\);overflow:auto/);

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

const functionNames = [
  "restoreProfileAuthCard", "showGuestProfileChoices", "beginProfileAuthentication", "backToProfileAuthChoices",
  "showAuth", "resumeAuthenticationIntent", "openView",
];
const functionSources = functionNames.map(name => {
  const source = html.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`))?.[0];
  assert.ok(source, `the ${name} flow should exist`);
  return source;
}).join("\n");

const context = {
  currentUser: null,
  cloudAccount: null,
  pendingAuthenticationIntent: null,
  ownerPanel: "products",
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
  window: { scrollTo() {} },
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
runInNewContext(`${functionSources}\nthis.testApi={openView,beginProfileAuthentication,backToProfileAuthChoices,resumeAuthenticationIntent};`, context);

context.testApi.openView("profile");
assert.equal(get("profileGuestAccess").hidden, false, "guest Profile opens the two choices first");
assert.equal(get("authenticatedProfileCard").hidden, true, "guest does not see an authenticated profile card");
assert.equal(context.pendingAuthenticationIntent.type, "profile");

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

context.currentUser = { id: "offline-test-customer", role: "customer" };
context.testApi.resumeAuthenticationIntent();
assert.equal(get("profileView").classList.contains("active"), true, "successful auth returns to Profile");
assert.equal(get("profileGuestAccess").hidden, true);
assert.equal(get("profileGuestAuthMount").hidden, true);
assert.equal(get("authenticatedProfileCard").hidden, false, "successful auth shows the customer's Profile");
assert.equal(authCard.parentNode, host);
assert.equal(context.pendingAuthenticationIntent, null);

console.log("Offline Profile authentication checks passed: guest choice screen, in-Profile Login, in-Profile Sign Up, Back navigation, and authenticated Profile return.");
