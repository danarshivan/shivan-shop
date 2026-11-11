import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const functionSource = name => {
  const pattern = "(?:async\\s+)?function " + name + "\\([^\\n]*\\)\\s*\\{[\\s\\S]*?\\n\\}";
  const match = html.match(new RegExp(pattern, "m"));
  assert.ok(match, "Expected " + name + " implementation.");
  return match[0];
};

assert.match(html, /<html lang="en" dir="ltr">/, "new sessions start with English and left-to-right direction");
assert.match(html, /const languageCatalog=\{en:Object\.create\(null\),"ku-Badini":Object\.create\(null\),ar:Object\.create\(null\)\}/, "the shared catalog contains exactly the three supported locales");
assert.equal((html.match(/id="languageSelect"/g) || []).length, 1, "the hamburger language selector remains available");
assert.equal((html.match(/id="settingsLanguageSelect"/g) || []).length, 1, "Profile Settings has a language selector");
assert.equal((html.match(/id="welcomeLanguageSelect"/g) || []).length, 1, "Welcome offers a language choice before sign-up");
const optionValues = id => { const markup = html.match(new RegExp("<select id=\"" + id + "\"[^>]*>([\\s\\S]*?)<\\/select>")); assert.ok(markup, id + " exists"); return Array.from(markup[1].matchAll(/<option value="([^"]+)"/g), match => match[1]); };
assert.deepEqual(optionValues("languageSelect"), ["en", "ku-Badini", "ar"], "the menu offers exactly the three supported languages");
assert.deepEqual(optionValues("settingsLanguageSelect"), ["en", "ku-Badini", "ar"], "Profile Settings offers the same three languages");
assert.deepEqual(optionValues("welcomeLanguageSelect"), ["en", "ku-Badini", "ar"], "Welcome offers the same three languages");
assert.match(html, /id="detailName"[^>]*data-i18n-preserve/, "Product Details title is protected from automatic translation");
assert.match(html, /id="detailDescription"[^>]*data-i18n-preserve/, "Owner-authored product descriptions are protected");
assert.match(html, /id="profileName"[^>]*data-i18n-preserve/, "account names are protected");
assert.ok(html.includes("setText(\"shopPromoOnboardingTagline\",customerUiText(\"WOMEN’S FASHION\",\"جلوبەرگێن ژنان\",\"أزياء نسائية\"))"), "the Welcome tagline has translations in all locales");
assert.match(html, /data-product-name-id="\$\{p\.id\}" data-i18n-preserve/, "product card names are protected");
assert.ok(html.includes('html[dir="ltr"] .app :is(.brand-small span,.search input,.section-head,.product-info,.product-name){direction:ltr;text-align:start}'), "legacy RTL storefront controls switch to LTR in English");
assert.ok(html.includes('html[dir="rtl"] .app :is(.brand-small span,.search input,.section-head,.product-info,.product-name){direction:rtl;text-align:start}'), "key storefront content aligns from the RTL start edge");
assert.ok(html.includes('<div class="cart-info"><strong data-i18n-preserve>'), "saved cart product names are not automatically translated");
assert.ok(html.includes('<div class="owner-order-detail-item-copy"><strong data-i18n-preserve>'), "saved order product names are not automatically translated in Owner views");

const rowsStart = html.indexOf("const LANGUAGE_KEY =");
const runtimeEnd = html.indexOf("function renderHomeLabels(){", rowsStart);
assert.ok(rowsStart >= 0 && runtimeEnd > rowsStart, "central language rows and runtime exist");
const bootstrap = html.slice(rowsStart, runtimeEnd);

const selectors = new Map();
for (const id of ["languageSelect", "settingsLanguageSelect", "welcomeLanguageSelect"]) {
  selectors.set(id, {
    value: "",
    listeners: new Map(),
    setAttribute(name, value) { this[name] = value; },
    addEventListener(type, callback) { this.listeners.set(type, callback); },
  });
}
const values = new Map([["shivan_shop_language", "ku-Badini"]]);
const writes = [];
class TestTextNode { constructor(value, parentElement) { this.nodeType = 3; this.nodeValue = value; this.parentElement = parentElement; } }
class TestElement { constructor(attrs = {}) { this.nodeType = 1; this.attributes = new Map(Object.entries(attrs)); this.children = []; this.parentElement = null; this.tagName = "DIV"; } hasAttribute(name) { return this.attributes.has(name); } getAttribute(name) { return this.attributes.get(name) ?? null; } setAttribute(name, value) { this.attributes.set(name, String(value)); } closest(selector) { for (let element = this; element; element = element.parentElement) { if (selector.includes("data-i18n-preserve") && element.hasAttribute("data-i18n-preserve")) return element; if (selector === "script,style" && ["SCRIPT", "STYLE"].includes(element.tagName)) return element; } return null; } }
const root = { lang: "", dir: "" };
const body = new TestElement();
const interfaceText = new TestElement();
const interfaceNode = new TestTextNode("Home", interfaceText);
interfaceText.children.push(interfaceNode); interfaceText.parentElement = body;
const authoredText = new TestElement({ "data-i18n-preserve": "" });
const authoredNode = new TestTextNode("Home", authoredText);
authoredText.children.push(authoredNode); authoredText.parentElement = body;
body.children.push(interfaceText, authoredText);
const document = { documentElement: root, body, getElementById(id) { return selectors.get(id) || null; }, createTreeWalker(node) { const children = []; const walk = current => { for (const child of current.children || []) { children.push(child); if (child.nodeType === 1) walk(child); } }; walk(node); let index = 0; return { nextNode() { return children[index++] || null; } }; } };
class TestMutationObserver { observe() {} }
const context = vm.createContext({
  document,
  localStorage: {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { writes.push([key, value]); values.set(key, String(value)); },
  },
  window: { scrollTo() { throw new Error("Language changes must preserve scroll position."); } },
  MutationObserver: TestMutationObserver,
  Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
  NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4 },
  applyOwnerAppearance() {},
  renderAdvertisements() {},
  renderCategoryButtons() {},
  renderHomeLabels() {},
  refreshLocalizedProductNames() {},
  products: [],
});
const runtimeFunctions = [
  "translationContentIsPreserved",
  "translateNode",
  "syncLanguageSelectors",
  "applyLanguage",
  "initLanguage",
  "ownerDashboardText",
  "getProductName",
  "translateUiMessage",
].map(functionSource).join("\n");
const expose = "\nthis.apply=applyLanguage;this.start=initLanguage;this.ui=customerUiText;this.translate=translateText;this.ownerText=ownerDashboardText;this.nameFor=getProductName;this.message=translateUiMessage;this.preserved=translationContentIsPreserved;this.translateTree=translateNode;this.catalog=languageCatalog;";
vm.runInContext(bootstrap + runtimeFunctions + expose, context);

const locales = ["en", "ku-Badini", "ar"];
assert.deepEqual(Object.keys(context.catalog).sort(), locales.slice().sort(), "the runtime exposes exactly English, Kurdish Badini, and Arabic");
assert.ok(Object.keys(context.catalog.en).length >= 500, "the central dictionary contains the broad interface catalog");
context.start();
assert.equal(root.lang, "ku-Badini", "the saved Badini preference is restored");
assert.equal(root.dir, "rtl");
assert.equal(selectors.get("languageSelect").value, "ku-Badini");
assert.equal(selectors.get("settingsLanguageSelect").value, "ku-Badini");
assert.equal(selectors.get("welcomeLanguageSelect").value, "ku-Badini");
assert.equal(writes.length, 0, "loading a saved preference does not rewrite it");
assert.equal(interfaceNode.nodeValue, "ماڵەوە", "interface text translates to Badini on the real translator path");
assert.equal(authoredNode.nodeValue, "Home", "user-authored text is excluded from automatic translation");

const sharedCatalogCopy=[
  ["Search","گەڕان","بحث"],["Cart","سەبەت","السلة"],["Orders","داخوازی","الطلبات"],["Profile","پڕۆفایل","الملف الشخصي"],["Settings","رێکخستن","الإعدادات"],["Add to cart","زیاد بکە بۆ سەبەت","أضف إلى السلة"],["Checkout","تەواوکرنا داخوازی","إتمام الطلب"],["Forgot password?","وشەیا نهێنی ژبیرکر؟","هل نسيت كلمة المرور؟"],["Place order","ناردنا داخوازی","إرسال الطلب"],["Notifications","ئاگادارکرن","الإشعارات"],["Please fill in all fields.","تکایە هەموو خانەکان پڕ بکە.","يرجى تعبئة جميع الحقول."],["Settings saved.","رێکخستن پاشەکەفت بوو.","تم حفظ الإعدادات."]
];
for(const [en,ku,ar] of sharedCatalogCopy){assert.equal(context.translate(en,"en"),en,en+" has an English catalog entry");assert.equal(context.translate(en,"ku-Badini"),ku,en+" has a Badini catalog entry");assert.equal(context.translate(en,"ar"),ar,en+" has an Arabic catalog entry");}

const screenCopy = [
  ["Welcome", "Explore Models", "سەحکە تە مۆدێلان", "استكشفي الموديلات"],
  ["Forgot Password", "Forgot password?", "وشەیا نهێنی ژبیرکر؟", "هل نسيت كلمة المرور؟"],
  ["Owner Settings", "Store Settings", "ڕێکخستنێن فرۆشگەیێ", "إعدادات المتجر"],
  ["Login", "Login", "چوونە ژوور", "تسجيل الدخول"],
  ["Signup", "Create Account", "حسابی دروست بکە", "إنشاء حساب"],
  ["Shop", "Home", "ماڵەوە", "الرئيسية"],
  ["Search", "Search", "گەڕان", "بحث"],
  ["Categories", "Categories", "جۆرێن بەرهەمان", "الفئات"],
  ["Product Details", "Add to cart", "زیاد بکە بۆ سەبەت", "أضف إلى السلة"],
  ["Cart", "Your bag is empty", "سەبەتەکەت بەتاڵە.", "حقيبتك فارغة"],
  ["Checkout", "Delivery address", "ناونیشانا گەهاندنێ", "عنوان التوصيل"],
  ["Orders", "My Orders", "داخوازیێن من", "طلباتي"],
  ["Profile", "Settings", "رێکخستن", "الإعدادات"],
  ["Owner", "Owner Dashboard", "داشبۆردا خاوەن", "لوحة المالك"],
  ["Reports", "Analytics", "شیکاری", "التحليلات"],
  ["Notifications", "Notifications", "ئاگاداری", "الإشعارات"],
];
for (const [screen, en, ku, ar] of screenCopy) {
  context.apply("en", false);
  assert.equal(context.ui(en, ku, ar), en, screen + " has English UI copy");
  context.apply("ku-Badini", false);
  assert.equal(context.ui(en, ku, ar), ku, screen + " has Badini UI copy");
  context.apply("ar", false);
  assert.equal(context.ui(en, ku, ar), ar, screen + " has Arabic UI copy");
}
assert.equal(context.ownerText("Orders", "داخوازی", "الطلبات"), "الطلبات", "Owner UI uses the shared dictionary in Arabic");
assert.equal(context.translate("Search", "ku-Badini"), "گەڕان", "Badini works through the canonical locale tag");
context.apply("ku", false);
assert.equal(context.translate("Search", "ku"), "گەڕان", "legacy saved ku preferences remain compatible");
assert.equal(context.translate("Search", "ar"), "بحث");
assert.equal(context.translate("Search", "en"), "Search");
context.apply("ar", false);
assert.equal(context.message("Enable notifications"), "تفعيل الإشعارات", "known notification UI messages use the selected locale");
assert.equal(context.message("Unrecognized server detail"), "Unrecognized server detail", "unknown server text remains unchanged");
context.apply("ar", false);
context.translateTree(body);
assert.equal(interfaceNode.nodeValue, "الرئيسية", "the same interface node switches from Badini to Arabic");
assert.equal(authoredNode.nodeValue, "Home", "user-authored text remains unchanged after language switches");

context.apply("ku-Badini", false);
assert.equal(context.nameFor({ name: "Home" }), "Home", "legacy product names are not automatically translated");
assert.equal(context.nameFor({ name: "Home", names: { "ku-Badini": "ناڤێ کوردی" } }), "ناڤێ کوردی", "an explicitly stored Badini product name is shown as stored");
assert.equal(context.nameFor({ name: "Home", names: { en: "Saved English name" } }, "en"), "Saved English name");
assert.equal(context.preserved({ nodeType: 1, closest(selector) { return selector.includes("data-i18n-preserve") ? this : null; } }), true, "authored content has an explicit translator exclusion");
assert.equal(values.get("shivan_shop_language"), "ku-Badini", "the existing canonical preference remains intact");
selectors.get("settingsLanguageSelect").value = "en";
selectors.get("settingsLanguageSelect").listeners.get("change")();
assert.equal(values.get("shivan_shop_language"), "en", "a Settings selection persists for future sessions");
assert.equal(selectors.get("languageSelect").value, "en", "a Settings selection synchronizes the menu");
assert.equal(selectors.get("welcomeLanguageSelect").value, "en", "a Settings selection synchronizes Welcome");
selectors.get("welcomeLanguageSelect").value = "ku-Badini";
selectors.get("welcomeLanguageSelect").listeners.get("change")();
assert.equal(selectors.get("languageSelect").value, "ku-Badini", "a Welcome selection synchronizes the hamburger menu");
assert.equal(selectors.get("settingsLanguageSelect").value, "ku-Badini", "a Welcome selection synchronizes Profile Settings");
assert.equal(values.get("shivan_shop_language"), "ku-Badini", "a Welcome selection persists the canonical preference");
assert.ok(writes.length > 0, "explicit language selection persists");

console.log("Language support checks passed: three locales, central dictionary, synchronized selectors, RTL/LTR, preference persistence, screen copy, and authored-content preservation.");
