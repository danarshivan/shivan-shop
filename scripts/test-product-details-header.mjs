import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const functionSource = name => {
  const match = html.match(new RegExp(`(?:async\\s+)?function ${name}\\([^\\n]*\\)\\s*\\{[\\s\\S]*?\\n\\}`, "m"));
  assert.ok(match, `Expected ${name} implementation.`);
  return match[0];
};

const detailStart = html.indexOf('<div id="detailView"');
const detailEnd = html.indexOf("<!-- BOTTOM NAV -->", detailStart);
assert.ok(detailStart >= 0 && detailEnd > detailStart, "Product Details markup exists");
const detailMarkup = html.slice(detailStart, detailEnd);
const toolbarStart = detailMarkup.indexOf('<div class="detail-toolbar">');
const toolbarEnd = detailMarkup.indexOf("</div>", toolbarStart);
const toolbar = detailMarkup.slice(toolbarStart, toolbarEnd);
assert.match(toolbar, /<button class="back"[^>]*onclick="goBack\(\)"/, "Back remains functional");
assert.match(toolbar, /class="home-shop-wordmark detail-toolbar-wordmark"[^>]*><span>Shivan<\/span><span class="home-shop-wordmark-shop">Shop<\/span>/, "Product Details reuses the existing Shivan Shop wordmark and underline class");
assert.ok(toolbar.indexOf('class="back"') < toolbar.indexOf("detail-toolbar-wordmark"), "Back appears on the left before the right-side wordmark");
assert.doesNotMatch(detailMarkup, /languageSelect|language-switcher/, "Product Details contains no visible language selector");
assert.match(detailMarkup, /id="detailFavoriteButton"/, "the product image favorite control remains present");
assert.ok(detailMarkup.indexOf('class="detail-toolbar"') < detailMarkup.indexOf('id="detailGallery"'), "the product image follows the compact header directly");

const homeHeaderStart = html.indexOf('<div class="home-shop-header"');
const homeHeaderEnd = html.indexOf("</header>", homeHeaderStart);
const homeHeader = html.slice(homeHeaderStart, homeHeaderEnd);
assert.match(homeHeader, /<div class="home-shop-wordmark" aria-label="Shivan Shop"><span>Shivan<\/span><span class="home-shop-wordmark-shop">Shop<\/span><\/div>/, "the Home wordmark markup is unchanged");
assert.match(html, /\.home-shop-wordmark-shop::after\{[^}]*border-bottom:2px solid #9a7aff/, "the existing curved blue-violet underline is reused");

assert.equal((html.match(/id="languageSelect"/g) || []).length, 1, "the hamburger keeps one language selector");
assert.equal((html.match(/id="settingsLanguageSelect"/g) || []).length, 1, "Profile Settings exposes the second synchronized language selector");
assert.equal((html.match(/id="welcomeLanguageSelect"/g) || []).length, 1, "Welcome exposes a language selector before account creation");
assert.match(html, /<select id="languageSelect"[^>]*>[\s\S]*?<option value="en"[^>]*>English<\/option>[\s\S]*?<option value="ku-Badini"[^>]*>Kurdish Badini/);
assert.match(html, /<div id="settingsModal"[^>]*>[\s\S]*?<select id="settingsLanguageSelect"/, "language can be changed from Profile Settings");
const menuStart = html.indexOf('<aside id="homeMenuPanel"');
const menuEnd = html.indexOf("</aside>", menuStart);
const menuLanguageAt = html.indexOf('id="homeMenuLanguageControl"');
assert.ok(menuStart >= 0 && menuLanguageAt > menuStart && menuLanguageAt < menuEnd, "the existing language selector lives inside the hamburger menu");
assert.match(html, /const menuLabels=\[[^\n]*\["homeMenuLanguageLabel","Language","زمان","اللغة"\]/, "the menu language option is translated");
assert.match(html, /html\.detail-view-open \.language-switcher\{display:none!important\}/, "no language control can appear over Product Details");

assert.match(html, /\.detail-toolbar\{[^}]*justify-content:space-between[^}]*padding:5px max\(12px,env\(safe-area-inset-right\)\) 5px max\(12px,env\(safe-area-inset-left\)\)/, "the toolbar aligns both controls in a compact row");
assert.match(html, /\.detail-toolbar \.detail-toolbar-wordmark\{[^}]*font-size:clamp\(17px,4\.6vw,19px\)/, "the wordmark scales for mobile widths without clipping");
assert.match(html, /@media\(max-width:350px\)\{\.detail-toolbar\{[^}]*padding-right:max\(8px,env\(safe-area-inset-right\)\)/, "320px screens use narrower safe-area padding");
assert.match(html, /@media\(min-width:700px\)\{\.detail-toolbar\{[^}]*padding-right:max\(14px,env\(safe-area-inset-right\)\)/, "desktop widths retain balanced toolbar spacing");
assert.match(html, /#homeMenuPanel \.home-menu-language-control select\{[^}]*max-width:112px/, "the existing selector is styled compactly inside the menu");

const values = new Map([["shivan-shop-language-test", "ar"]]);
const writes = [];
const scrollCalls = [];
const makeSelector = () => ({
  value: "",
  listeners: new Map(),
  setAttribute(name, value) { this[name] = value; },
  addEventListener(type, handler) { this.listeners.set(type, handler); },
});
const selector = makeSelector();
const settingsSelector = makeSelector();
const root = { lang: "", dir: "" };
const document = {
  documentElement: root,
  body: {},
  getElementById(id) { return id === "languageSelect" ? selector : id === "settingsLanguageSelect" ? settingsSelector : null; },
};
class TestMutationObserver { observe() {} }
const context = vm.createContext({
  document,
  localStorage: {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { writes.push([key, value]); values.set(key, String(value)); },
  },
  window: { scrollTo(...args) { scrollCalls.push(args); } },
  MutationObserver: TestMutationObserver,
  Node: { TEXT_NODE: 3 },
  translateNode() {},
  applyOwnerAppearance() {},
  renderAdvertisements() {},
  renderCategoryButtons() {},
  renderHomeLabels() {},
  populateOwnerCategorySelect() {},
  refreshLocalizedProductNames() {},
});
const functionNames = ["normalizeLanguageCode", "languageDictionaryLocale", "languageDocumentTag", "languageStorageCode", "registerLanguageText", "customerUiText", "syncLanguageSelectors", "applyLanguage", "initLanguage"];
const helpers = functionNames.map(functionSource).join("\n");
const program = 'const LANGUAGE_KEY="shivan-shop-language-test";const languageCatalog={en:Object.create(null),"ku-Badini":Object.create(null),ar:Object.create(null)};const languageSourceMap=new Map();const languageSourceSet=new Set();let languageSources=[];let activeLanguage="en";let languageObserver=null;'+helpers+'this.getLanguage=()=>activeLanguage;this.startLanguage=initLanguage;';
vm.runInContext(program, context);
context.startLanguage();
assert.equal(context.getLanguage(), "ar", "a saved Arabic preference loads");
assert.equal(selector.value, "ar");
assert.equal(settingsSelector.value, "ar", "both selectors synchronize from a saved preference");
assert.equal(root.lang, "ar");
assert.equal(root.dir, "rtl");
assert.equal(writes.length, 0, "loading a preference does not overwrite it");
for (const language of ["en", "ku-Badini", "ar"]) {
  selector.value = language;
  selector.listeners.get("change")();
  assert.equal(context.getLanguage(), language === "ku-Badini" ? "ku" : language, language + " remains selectable");
  assert.equal(selector.value, language, language + " is reflected in the hamburger selector");
  assert.equal(settingsSelector.value, language, language + " is reflected in Profile Settings");
  assert.equal(values.get("shivan-shop-language-test"), language, language + " preference persists using its canonical locale code");
  assert.equal(root.dir, language === "en" ? "ltr" : "rtl");
  assert.equal(root.lang, language);
}
settingsSelector.value = "ku-Badini";
settingsSelector.listeners.get("change")();
assert.equal(selector.value, "ku-Badini", "changing language in Settings synchronizes the menu selector");
assert.equal(scrollCalls.length, 0, "changing language preserves the current scroll position");

const freshValues = new Map();
const freshRoot = { lang: "", dir: "" };
const freshSelector = makeSelector();
const freshSettingsSelector = makeSelector();
const freshDocument = { documentElement: freshRoot, body: {}, getElementById(id) { return id === "languageSelect" ? freshSelector : id === "settingsLanguageSelect" ? freshSettingsSelector : null; } };
const freshContext = vm.createContext({ document: freshDocument, localStorage: { getItem(key) { return freshValues.get(key) ?? null; }, setItem(key, value) { freshValues.set(key, String(value)); } }, window: { scrollTo() {} }, MutationObserver: TestMutationObserver, Node: { TEXT_NODE: 3 }, translateNode() {}, applyOwnerAppearance() {}, renderAdvertisements() {}, renderCategoryButtons() {}, renderHomeLabels() {}, populateOwnerCategorySelect() {}, refreshLocalizedProductNames() {} });
vm.runInContext(program, freshContext);
freshContext.startLanguage();
assert.equal(freshContext.getLanguage(), "en", "new users default to English");
assert.equal(freshRoot.dir, "ltr");
assert.equal(freshValues.size, 0, "the default does not force a stored preference");
console.log("Product Details header checks passed: reused wordmark, Back and image actions, single hamburger language selector, saved language preferences, and mobile/desktop layout rules.");
