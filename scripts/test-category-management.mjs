import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
function functionSource(name) {
  const match = html.match(new RegExp(`(?:async\\s+)?function ${name}\\([^\\n]*\\)\\s*\\{[\\s\\S]*?\\n\\}`, "m"));
  assert.ok(match, `Expected ${name} implementation.`);
  return match[0];
}

const customerRenderers = functionSource("homeCategoryArtworkMarkup") + "\n" + functionSource("renderCategoryButtons") + "\n" + functionSource("renderSearchCategoryCards");
assert.match(customerRenderers, /homeCategoryArtworkMarkup\(category\)/, "Home category cards use Owner-managed full-card images");
assert.doesNotMatch(functionSource("homeCategoryArtworkMarkup"), /<svg|emoji/i, "Home category placeholders contain no icon or emoji artwork");
assert.match(customerRenderers, /getAllCategories\(\{visibleOnly:true\}\)/, "customer categories respect Owner visibility settings");
assert.doesNotMatch(customerRenderers, /categoryEmoji|👚|👗|🛍️/, "customer category cards do not use emoji placeholders");
assert.match(functionSource("renderCategoryButtons"), /\$\{homeCategoryArtworkMarkup\(category\)\}<span>/, "category names render below the image area");
assert.match(functionSource("renderOwnerCategoryManager"), /type="file" accept="image\/jpeg,image\/png,image\/webp,image\/gif"/, "the Owner can upload or replace each category image");
assert.match(functionSource("renderOwnerCategoryManager"), /data-category-visible/, "the Owner can change category visibility");
assert.match(functionSource("renderOwnerCategoryManager"), /data-category-move/, "the Owner can reorder categories");
assert.match(functionSource("renderOwnerCategoryManager"), /data-category-preview/, "the Owner sees a category-card preview");
assert.match(html, /\.categories\{[\s\S]*?overflow-x:auto/);
assert.match(html, /\.categories\{cursor:grab;[\s\S]*?touch-action:pan-x pan-y/);
assert.match(html, /#homeView \.category\{[^}]*min-height:88px/, "Home category cards retain enough height for their image and label");
assert.match(html, /#homeView \.category>span:last-child\{(?=[^}]*white-space:normal)(?=[^}]*text-overflow:clip)[^}]*\}/, "full category names wrap instead of being clipped or ellipsized");
assert.match(html, /#homeView \.categories\{[^}]*margin:0 0 12px/, "the category row has clear separation from New Arrivals");
assert.match(html, /#homeView \.category \.cat-icon\{[^}]*width:100%[^}]*aspect-ratio:4\/5[^}]*border:0/, "the category photo fills a rounded card with no inner frame");
assert.match(html, /#homeView \.category \.cat-icon img\{[^}]*width:100%[^}]*height:100%[^}]*object-fit:cover/, "category photos cover the card without distortion");
assert.match(html, /#homeView \.category \.category-image-placeholder\{[^}]*radial-gradient/, "categories without photos receive a full-card decorative fallback");
assert.match(html, /@media\(max-width:380px\)\{#homeView \.categories/, "the category strip adapts at narrow mobile widths");
assert.match(html, /@media\(min-width:700px\)\{#homeView \.hero\{max-width:1100px/, "Home banner and categories have desktop sizing rules");
assert.match(html, /@media\(max-width:420px\)\{\.owner-category-create-fields/);
assert.match(html, /@media\(min-width:700px\)\{\.owner-category-manager/);
assert.match(functionSource("deleteOwnerCategory"), /await showOwnerConfirm\(promptText\)/, "category deletion always requires explicit confirmation");

class MemoryStorage {
  constructor(entries = []) { this.values = new Map(entries); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}
class FakeNode {
  constructor() { this.dataset = {}; this.classList = { add() {}, remove() {} }; this.listeners = new Map(); this.scrollLeft = 0; this.innerHTML = ""; this.value = ""; this.hidden = false; }
  addEventListener(type, handler) { const list = this.listeners.get(type) || []; list.push(handler); this.listeners.set(type, list); }
  querySelectorAll() { return []; }
  querySelector() { return null; }
}
const DEFAULTS = ["جلوبەرگ","کەفش","ئاکسسوار","سەروپۆش","بلوز","جاکێت","کڵاو","پانتۆڵ","تەنوورە"];
const imageUrl = "/api/media/shop/" + "A".repeat(43) + ".webp";
const replacementImageUrl = "/api/media/shop/" + "B".repeat(43) + ".webp";
const categoryMeta = Object.fromEntries(DEFAULTS.map((name, index) => [name, { order: index + 10 }]));
Object.assign(categoryMeta, {
  Dresses: { visible: false, order: 0, image: imageUrl },
  Coats: { visible: true, order: 1 },
  Tops: { visible: true, order: 2, image: imageUrl, en: "Tops" },
});
const storage = new MemoryStorage([
  ["shivan_shop_categories", JSON.stringify(["Tops", "Dresses", "Coats"])],
  ["shivan_shop_category_meta", JSON.stringify(categoryMeta)],
  ["shivan_shop_category_renames", "{}"],
  ["shivan_shop_deleted_categories", "[]"],
]);
const categoryButtons = new FakeNode(), searchCards = new FakeNode(), searchFilter = new FakeNode(), ownerManager = new FakeNode();
searchFilter.value = "Tops";
const elements = new Map([
  ["categoryButtons", categoryButtons], ["searchCategoryCards", searchCards], ["searchCategoryFilter", searchFilter],
  ["ownerCategoryManager", ownerManager], ["ownerProductCategory", new FakeNode()],
]);
const fakeWindow = { addEventListener() {}, removeEventListener() {} };
const productA = { id: "tops-1", category: "Tops" }, productB = { id: "dress-1", category: "Dresses" };
const products = [productA, productB];
const renderCalls = [], savedWrites = [], toastMessages = [];
let requestNumber = 0;
const sandbox = vm.createContext({
  DEFAULT_CATEGORIES: DEFAULTS,
  OWNER_CATEGORIES_KEY: "shivan_shop_categories", OWNER_CATEGORY_META_KEY: "shivan_shop_category_meta",
  OWNER_CATEGORY_RENAMES_KEY: "shivan_shop_category_renames", OWNER_CATEGORY_DELETED_KEY: "shivan_shop_deleted_categories",
  MAX_CLOUD_IMAGE_BYTES: 1_300_000, localStorage: storage, products, activeLanguage: "en", currentCategory: "هەموو",
  cloudMode: true, cloudAccount: { role: "owner" }, isOwner: () => true,
  document: { getElementById: id => elements.get(id) || null, querySelectorAll: () => [] }, window: fakeWindow,
  URL: { createObjectURL: file => `blob:https://shop.test/${file.name}`, revokeObjectURL() {} },
  safeImageUrl: value => /^(?:https?:\/\/|data:image\/|\/api\/media\/|blob:)/i.test(String(value || "")) ? String(value) : "",
  escapeHtml: value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;"),
  translateText: value => value, ownerDashboardText: (en) => en,
  filterCategory: category => { sandbox.currentCategory = category; renderCalls.push(products.filter(product => product.category === category)); },
  renderProducts: list => renderCalls.push(list), showToast: message => toastMessages.push(message),
  selectSearchCategory() {}, populateOwnerCategorySelect() {}, scrollOwnerTo() {},
  renderCategoryButtons: () => {}, refreshOwnerCategoryManager: () => {},
  createOwnerSaveRequestId: () => `category-request-${++requestNumber}`,
  uploadOwnerImageToCloud: async file => { assert.ok(file.size <= 1_300_000); return file.name === "new.webp" ? imageUrl : replacementImageUrl; },
  confirmCloudShopWrites: async keys => { savedWrites.push([...keys]); return true; },
  confirmCloudShopWrite: async key => { savedWrites.push([key]); return true; },
  ownerSaveDiagnostic() {}, ownerSaveDiagnosticCode: () => "TEST", saveProducts: () => true,
});
const names = [
  "getOwnerCategoryMeta", "getOwnerCategoryRenames", "getDeletedOwnerCategories", "resolveCategoryName", "categoryLabel",
  "categoryImageUrl", "categoryPreviewMarkup", "categoryArtworkMarkup", "homeCategoryArtworkMarkup", "bindCategoryImageFallbacks", "bindCategoryStripDrag",
  "validateOwnerCategoryImageFile", "previewOwnerCategoryImage", "releaseOwnerCategoryPreview", "getSavedOwnerCategories",
  "getAllCategories", "renderCategoryButtons", "renderSearchCategoryCards", "filterCategory", "renderOwnerCategoryManager",
  "refreshOwnerCategoryManager", "bindOwnerCategoryManager", "saveOwnerCategory", "persistOwnerCategoryMeta", "moveOwnerCategory",
  "setOwnerCategoryVisibility", "addOwnerCategory",
];
vm.runInContext(`${html.match(/const DEFAULT_CATEGORIES=[^\n]+;/)?.[0]}\n${names.map(functionSource).join("\n")}`, sandbox);
sandbox.renderCategoryButtons();
assert.ok(categoryButtons.innerHTML.includes(imageUrl), "Home uses the saved category photo");
assert.ok(searchCards.innerHTML.includes(imageUrl), "Search uses the same saved category photo");
assert.doesNotMatch(categoryButtons.innerHTML, /Dresses/, "hidden categories do not appear on Home");
assert.doesNotMatch(searchCards.innerHTML, /Dresses/, "hidden categories do not appear in Search");
assert.ok(categoryButtons.innerHTML.includes("category-image-placeholder"), "categories without uploads receive a full-card placeholder");
assert.doesNotMatch(categoryButtons.innerHTML, /<svg|👚|👗|🛍️/, "Home category cards render no hanger icon or emoji placeholder");
sandbox.filterCategory("Tops");
assert.deepEqual(renderCalls.at(-1).map(product => product.id), ["tops-1"], "category taps continue to filter the real product list");

const createInput = { value: "New model pieces", focus() {} }, createEnglish = { value: "New model" }, createArabic = { value: "موديلات جديدة" };
const createImage = { files: [{ name: "new.webp", type: "image/webp", size: 300_000 }], value: "chosen", dataset: {}, closest() { return { querySelector() { return null; } }; } };
elements.set("ownerNewCategory", createInput); elements.set("ownerNewCategoryEn", createEnglish); elements.set("ownerNewCategoryAr", createArabic); elements.set("ownerNewCategoryImage", createImage);
assert.equal(await sandbox.addOwnerCategory(), true, "Owner category creation succeeds after image upload and cloud confirmation");
const afterCreate = JSON.parse(storage.getItem("shivan_shop_category_meta"));
assert.equal(afterCreate["New model pieces"].image, imageUrl, "the created category keeps the shared uploaded image URL");
assert.equal(afterCreate["New model pieces"].visible, true, "new categories default to visible");
assert.ok(savedWrites.some(keys => keys.includes("shivan_shop_category_meta")), "category creation waits for shared metadata confirmation");

const editRow = {
  dataset: { categoryEdit: "Tops" },
  querySelector(selector) {
    if (selector === "[data-category-name]") return { value: "Tops" };
    if (selector === "[data-category-en]") return { value: "Tops" };
    if (selector === "[data-category-ar]") return { value: "قمصان" };
    if (selector === "[data-category-image]") return { files: [{ name: "replace.webp", type: "image/webp", size: 420_000 }], closest() { return { querySelector() { return null; } }; } };
    return null;
  },
};
assert.equal(await sandbox.saveOwnerCategory(editRow), true, "replacing a category photo saves through the same Owner path");
const afterEdit = JSON.parse(storage.getItem("shivan_shop_category_meta"));
assert.equal(afterEdit.Tops.image, replacementImageUrl, "replacement photos replace only the selected category image");
assert.equal(afterEdit.Tops.order, 2, "replacing a photo preserves category order");
assert.equal(afterEdit.Tops.visible, true, "replacing a photo preserves visibility");

const productsBeforeHide = JSON.stringify(products);
sandbox.currentCategory = "Tops";
assert.equal(await sandbox.setOwnerCategoryVisibility("Tops", false), true, "Owner visibility changes persist");
assert.equal(JSON.stringify(products), productsBeforeHide, "hiding a category never changes or deletes its products");
assert.equal(sandbox.currentCategory, "هەموو", "hiding the active category returns Home to its all-products view");

const orderBefore = Array.from(sandbox.getAllCategories());
const moveTarget = orderBefore[2];
assert.equal(await sandbox.moveOwnerCategory(moveTarget, -1), true, "Owner category ordering persists");
const orderAfter = Array.from(sandbox.getAllCategories());
assert.equal(orderAfter[1], moveTarget, "moving a category up changes its displayed order");

const reloadedStorage = new MemoryStorage(storage.values);
const reloadContext = vm.createContext({ ...sandbox, localStorage: reloadedStorage });
vm.runInContext(`${html.match(/const DEFAULT_CATEGORIES=[^\n]+;/)?.[0]}\n${["getOwnerCategoryMeta", "getOwnerCategoryRenames", "getDeletedOwnerCategories", "resolveCategoryName", "getSavedOwnerCategories", "getAllCategories", "categoryImageUrl"].map(functionSource).join("\n")}`, reloadContext);
assert.equal(reloadContext.categoryImageUrl("Tops"), replacementImageUrl, "saved category photos survive local refresh hydration");
console.log("Category management checks passed: image cards and fallback, live filtering, upload/create/replace, visibility, ordering, refresh persistence, and product preservation.");
