import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
function functionSource(name) {
  const match = html.match(new RegExp(`(?:async\\s+)?function ${name}\\([^\\n]*\\)\\s*\\{[\\s\\S]*?\\n\\}`, "m"));
  assert.ok(match, `Expected ${name} implementation.`);
  return match[0];
}

const categoryCssStart = html.indexOf("/* HOME IMAGE-FIRST CATEGORY CARDS */");
const categoryCssEnd = html.indexOf("/* Compact Product Details", categoryCssStart);
assert.ok(categoryCssStart >= 0 && categoryCssEnd > categoryCssStart, "Home category layout has a final scoped stylesheet block");
const homeCategoryStyles = html.slice(categoryCssStart, categoryCssEnd);
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
assert.ok(functionSource("renderOwnerCategoryManager").includes("data-category-image-url"), "the Owner form keeps a draft crop URL separate from the saved category image");
assert.ok(functionSource("renderOwnerCategoryManager").includes("data-category-edit-image"), "the Owner can reopen an existing category photo");
assert.ok(html.includes("id=\"ownerNewCategoryImageDraft\""), "new categories use a separate image-crop draft field");
assert.ok(functionSource("editOwnerCategoryImage").includes("openSavedOwnerImageCrop"), "existing category images reopen from shared storage");
assert.match(functionSource("bindOwnerCategoryManager"), /#ownerCategoryAddRow \[data-category-edit-image\]/, "the new-category form wires its saved crop back into the editor");
assert.match(functionSource("editOwnerAdImage"), /openSavedOwnerImageCrop/, "saved banner images can be reopened in the shared editor");
assert.match(html, /\.categories\{[\s\S]*?overflow-x:auto/);
assert.match(html, /\.categories\{cursor:grab;[\s\S]*?touch-action:pan-x pan-y/);
assert.match(homeCategoryStyles, /#homeView \.category\{[^}]*flex:0 0 calc\(25% - 5.25px\)/, "mobile Home categories size four equal cards across the row");
assert.match(homeCategoryStyles, /#homeView \.category>span:last-child\{(?=[^}]*white-space:normal)(?=[^}]*text-overflow:clip)[^}]*\}/, "full category names wrap instead of being clipped or ellipsized");
assert.match(homeCategoryStyles, /#homeView \.category\.active>span:last-child\{[^}]*background:linear-gradient\(135deg,#8350ff,#6337df\)[^}]*box-shadow:/, "the selected category label receives the purple highlight");
assert.match(homeCategoryStyles, /#homeView \.category\.active\{[^}]*box-shadow:[^}]*rgba\(112,67,255,.34\)/, "the selected category card receives a subtle purple glow");
assert.match(homeCategoryStyles, /#homeView \.categories\{[^}]*margin:0 0 12px/, "the category row has clear separation from New Arrivals");
assert.match(homeCategoryStyles, /#homeView \.category \.cat-icon\{[^}]*width:100%[^}]*aspect-ratio:1\/1[^}]*border:0/, "the category photo is a complete square inside its card");
assert.match(homeCategoryStyles, /#homeView \.category \.cat-icon img\{[^}]*width:100%[^}]*height:100%[^}]*object-fit:cover/, "square category photos cover the image area without distortion");
assert.match(homeCategoryStyles, /#homeView \.category \.category-image-placeholder\{[^}]*radial-gradient/, "categories without photos receive a full-card decorative fallback");
assert.match(homeCategoryStyles, /@media\(max-width:380px\)\{#homeView \.categories\{gap:6px[^}]*\}#homeView \.category\{flex-basis:calc\(25% - 4.5px\)/, "four category cards fit narrow iPhone widths with horizontal scrolling for the rest");
assert.match(homeCategoryStyles, /@media\(min-width:700px\)\{#homeView \.categories\{gap:12px[^}]*\}#homeView \.category\{flex:0 0 112px/, "desktop Home categories retain consistent card dimensions");
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
let requestNumber = 0, failNextCategorySync = false, fetchedCategoryUrl = ""; const cropRequests = [];
const sandbox = vm.createContext({
  DEFAULT_CATEGORIES: DEFAULTS,
  OWNER_CATEGORIES_KEY: "shivan_shop_categories", OWNER_CATEGORY_META_KEY: "shivan_shop_category_meta",
  OWNER_CATEGORY_RENAMES_KEY: "shivan_shop_category_renames", OWNER_CATEGORY_DELETED_KEY: "shivan_shop_deleted_categories",
  MAX_CLOUD_IMAGE_BYTES: 1_300_000, MAX_OWNER_IMAGE_INPUT_BYTES: 15 * 1024 * 1024, Blob, localStorage: storage, products, activeLanguage: "en", currentCategory: "هەموو",
  cloudMode: true, cloudAccount: { role: "owner" }, isOwner: () => true,
  document: { getElementById: id => elements.get(id) || null, querySelectorAll: () => [] }, window: fakeWindow,
  URL: { createObjectURL: file => `blob:https://shop.test/${file.name}`, revokeObjectURL() {} },
  safeImageUrl: value => /^(?:https?:\/\/|data:image\/|\/api\/media\/|blob:)/i.test(String(value || "")) ? String(value) : "",
  escapeHtml: value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;"),
  translateText: value => value, ownerDashboardText: (en) => en,
  filterCategory: category => { sandbox.currentCategory = category; renderCalls.push(products.filter(product => product.category === category)); },
  renderProducts: list => renderCalls.push(list), showToast: message => toastMessages.push(message),
  selectSearchCategory() {}, populateOwnerCategorySelect() {}, scrollOwnerTo() {},
  renderCategoryButtons: () => {}, refreshOwnerCategoryManager: () => {}, openOwnerImageCrop: async (file, details) => { cropRequests.push({ file, details }); return true; }, fetch: async url => { fetchedCategoryUrl = String(url); return { ok: true, blob: async () => new Blob(["saved image"], { type: "image/webp" }) }; },
  createOwnerSaveRequestId: () => `category-request-${++requestNumber}`,
  uploadOwnerImageToCloud: async () => { throw new Error("Category handlers must upload only a confirmed crop, never a raw file."); },
  confirmCloudShopWrites: async keys => { savedWrites.push([...keys]); if (failNextCategorySync) { failNextCategorySync = false; throw Object.assign(new Error("Shared category save not confirmed"), { requestId: "category-sync-failed" }); } return true; },
  confirmCloudShopWrite: async key => { savedWrites.push([key]); return true; },
  ownerSaveDiagnostic() {}, ownerSaveDiagnosticCode: () => "TEST", saveProducts: () => true,
});
const names = [
  "getOwnerCategoryMeta", "getOwnerCategoryRenames", "getDeletedOwnerCategories", "resolveCategoryName", "categoryLabel",
  "categoryImageUrl", "categoryPreviewMarkup", "categoryArtworkMarkup", "homeCategoryArtworkMarkup", "bindCategoryImageFallbacks", "bindCategoryStripDrag",
  "validateOwnerCategoryImageFile", "previewOwnerCategoryImage", "releaseOwnerCategoryPreview", "openSavedOwnerImageCrop", "editOwnerCategoryImage", "getSavedOwnerCategories",
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
const createImageDraft = { value: "" }, createPreview = { innerHTML: "" }, createStatus = { textContent: "" }, createSubmit = { disabled: false };
const createImageEdit = { hidden: true, dataset: {}, bindingCount: 0, addEventListener(type, listener) { this[`${type}Listener`] = listener; this.bindingCount++; }, closest(selector) { return selector === ".owner-category-image-control" ? createHost : null; }, click() { return this.clickListener?.(); } };
const createForm = { querySelector(selector) { return selector === '[type="submit"]' ? createSubmit : null; } };
const createHost = {
  querySelector(selector) {
    if (selector === "[data-category-image-url]") return createImageDraft;
    if (selector === "[data-category-preview]") return createPreview;
    if (selector === "[data-category-image-status]") return createStatus;
    if (selector === "[data-category-edit-image]") return createImageEdit;
    if (selector === "[data-category-image]") return createImage;
    return null;
  },
  closest(selector) { return selector === "form" ? createForm : null; },
};
const createImage = {
  files: [{ name: "new.webp", type: "image/webp", size: 5 * 1024 * 1024 }], value: "chosen", disabled: false, dataset: {},
  closest(selector) { return selector === ".owner-category-image-control" ? createHost : selector === "form" ? createForm : null; },
};
elements.set("ownerNewCategory", createInput); elements.set("ownerNewCategoryEn", createEnglish); elements.set("ownerNewCategoryAr", createArabic); elements.set("ownerNewCategoryImage", createImage); elements.set("ownerNewCategoryImageDraft", createImageDraft);
sandbox.document.querySelectorAll = selector => selector === "#ownerCategoryManager [data-category-edit-image],#ownerCategoryAddRow [data-category-edit-image]" ? [createImageEdit] : [];
sandbox.bindOwnerCategoryManager();
sandbox.bindOwnerCategoryManager();
assert.equal(createImageEdit.bindingCount, 1, "refreshing category management does not bind the new-category crop button twice");
assert.equal(createImageEdit.hidden, true, "the new-category edit control stays hidden until an image crop exists");
assert.equal(await sandbox.previewOwnerCategoryImage(createImage), true, "selecting a category photo opens the shared crop editor");
assert.equal(cropRequests.at(-1).details.kind, "category", "new category photos use the category crop ratio");
assert.equal(cropRequests.at(-1).details.categoryImageTarget, createImageDraft, "the editor writes only to the unsaved category draft field");
assert.equal(savedWrites.length, 0, "opening the crop editor does not publish category metadata");
assert.equal(await sandbox.addOwnerCategory(), false, "a selected raw file cannot bypass the crop confirmation");
assert.equal(JSON.parse(storage.getItem("shivan_shop_categories")).includes("New model pieces"), false, "the unconfirmed category photo does not create a category");
createImage.files = [];
createImageDraft.value = imageUrl;
createPreview.innerHTML = `<img src="${imageUrl}">`;
createImageEdit.hidden = false;
assert.equal(createImageEdit.hidden, false, "a confirmed crop can be reopened before the category is saved");
createImageEdit.clickListener = () => sandbox.editOwnerCategoryImage(createImageEdit);
assert.equal(await createImageEdit.click(), true, "the unsaved category crop button reopens the editor");
assert.equal(fetchedCategoryUrl, imageUrl, "reopening a category crop fetches the current draft from shared storage");
assert.equal(cropRequests.at(-1).details.kind, "category");
assert.equal(await sandbox.addOwnerCategory(), true, "Owner category creation succeeds after crop confirmation and cloud metadata confirmation");
const afterCreate = JSON.parse(storage.getItem("shivan_shop_category_meta"));
assert.equal(afterCreate["New model pieces"].image, imageUrl, "the created category keeps the shared uploaded image URL");
assert.equal(afterCreate["New model pieces"].visible, true, "new categories default to visible");
assert.equal(createImageDraft.value, "", "the confirmed category draft clears only after cloud metadata succeeds");
assert.equal(createImageEdit.hidden, true, "saving a new category clears its stale crop action");
assert.ok(savedWrites.some(keys => keys.includes("shivan_shop_category_meta")), "category creation waits for shared metadata confirmation");

function makeEditRow({ draft = "", file = null } = {}) {
  const rowImageDraft = { value: draft }, rowPreview = { innerHTML: "" }, rowStatus = { textContent: "" }, rowEditButton = { hidden: false }, rowSubmit = { disabled: false };
  const rowForm = { querySelector(selector) { return selector === "button[type=submit]" ? rowSubmit : null; } };
  const rowHost = {
    querySelector(selector) {
      if (selector === "[data-category-image-url]") return rowImageDraft;
      if (selector === "[data-category-preview]") return rowPreview;
      if (selector === "[data-category-image-status]") return rowStatus;
      if (selector === "[data-category-edit-image]") return rowEditButton;
      if (selector === "[data-category-image]") return rowImage;
      return null;
    },
    closest(selector) { return selector === "form" ? rowForm : null; },
  };
  const rowImage = { files: file ? [file] : [], value: "", disabled: false, dataset: { savedImage: imageUrl }, closest(selector) { return selector === ".owner-category-image-control" ? rowHost : selector === "form" ? rowForm : null; } };
  const row = {
    dataset: { categoryEdit: "Tops" },
    querySelector(selector) {
      if (selector === "[data-category-name]") return { value: "Tops" };
      if (selector === "[data-category-en]") return { value: "Tops" };
      if (selector === "[data-category-ar]") return { value: "قمصان" };
      if (selector === "[data-category-image]") return rowImage;
      if (selector === "[data-category-image-url]") return rowImageDraft;
      if (selector === "[data-save-category]") return rowSubmit;
      return null;
    },
  };
  const button = { closest(selector) { return selector === ".owner-category-image-control" ? rowHost : selector === "[data-category-edit]" ? row : null; } };
  return { row, button, image: rowImage, draft: rowImageDraft, preview: rowPreview, status: rowStatus, editButton: rowEditButton, submit: rowSubmit };
}
const existingImageEdit = makeEditRow();
assert.equal(await sandbox.editOwnerCategoryImage(existingImageEdit.button), true, "an existing category photo can be reopened for cropping");
assert.equal(fetchedCategoryUrl, imageUrl, "reopened category images are read from their saved shared-storage URL");
assert.equal(cropRequests.at(-1).details.kind, "category");
const replacement = makeEditRow({ file: { name: "replace.webp", type: "image/webp", size: 5 * 1024 * 1024 } });
assert.equal(await sandbox.previewOwnerCategoryImage(replacement.image), true, "replacement photos use the same crop editor");
assert.equal(await sandbox.saveOwnerCategory(replacement.row), false, "raw replacement photos cannot bypass crop confirmation");
replacement.image.files = [];
replacement.draft.value = replacementImageUrl;
assert.equal(await sandbox.saveOwnerCategory(replacement.row), true, "replacing a category photo saves through the same Owner path");
const afterEdit = JSON.parse(storage.getItem("shivan_shop_category_meta"));
assert.equal(afterEdit.Tops.image, replacementImageUrl, "replacement photos replace only the selected category image");
assert.equal(afterEdit.Tops.order, 2, "replacing a photo preserves category order");
assert.equal(afterEdit.Tops.visible, true, "replacing a photo preserves visibility");
const failedReplacementUrl = "/api/media/shop/" + "C".repeat(43) + ".webp";
const failedEdit = makeEditRow({ draft: failedReplacementUrl });
const productsBeforeFailedReplacement = JSON.stringify(products);
failNextCategorySync = true;
assert.equal(await sandbox.saveOwnerCategory(failedEdit.row), false, "a failed cloud metadata save is reported as failure");
assert.equal(JSON.parse(storage.getItem("shivan_shop_category_meta")).Tops.image, replacementImageUrl, "a cloud failure preserves the original shared category image");
assert.equal(failedEdit.draft.value, failedReplacementUrl, "the unconfirmed edited image remains available in the form for retry");
assert.equal(JSON.stringify(products), productsBeforeFailedReplacement, "a failed image replacement preserves the product relationships");

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
