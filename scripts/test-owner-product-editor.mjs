import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const productRenderer = html.match(/function renderOwnerProducts\(box\)\{[\s\S]*?\n\}/)?.[0] || "";
const productOpen = html.match(/function openProduct\(id,options=\{\}\)\{[\s\S]*?\n\}/)?.[0] || "";
const saveProduct = html.match(/async function saveOwnerProduct\(event\)\{[\s\S]*?\n\}/)?.[0] || "";
const photoList = html.match(/function renderOwnerProductPhotoList\(\)\{[\s\S]*?\n\}/)?.[0] || "";
const editPhoto = html.match(/async function editOwnerProductPhoto\(index\)\{[\s\S]*?\n\}/)?.[0] || "";
const cropFinish = html.match(/async function finishImageCrop\(apply\)\{[\s\S]*?\n\}/)?.[0] || "";
const inventory = html.match(/function renderOwnerInventoryMatrix\(\)\{[\s\S]*?\n\}/)?.[0] || "";
const tabSwitch = html.match(/function selectOwnerProductEditorTab\(tab,scroll=true\)\{[\s\S]*?\n\}/)?.[0] || "";
const ownerNavigationIdentity = html.match(/function ownerNavigationIdentity\(snapshot\)\{[\s\S]*?\n\}/)?.[0] || "";
const createOwnerNavigationLedger = html.match(/function createOwnerNavigationLedger\(\)\{[\s\S]*?\n\}/)?.[0] || "";
const cropMatrix = html.match(/function ownerCropDrawMatrix\(width,height,rotation,flipX,flipY,cropX,cropY,cropWidth,cropHeight,outputWidth,outputHeight\)\{[\s\S]*?\n\}/)?.[0] || "";
const normalizeCropTransform = values => Array.from(values, value => Object.is(value, -0) ? 0 : value);

for (const [name, source] of Object.entries({ productRenderer, saveProduct, productOpen, photoList, editPhoto, cropFinish, inventory, tabSwitch, ownerNavigationIdentity, createOwnerNavigationLedger, cropMatrix })) {
  assert.ok(source, `Expected ${name} implementation to exist`);
}
assert.match(productRenderer, /id="ownerProductStoreAvailability"[^>]*required/, "the Owner product form requires Store Availability");
for (const value of ["shop1", "shop2", "both"]) assert.ok(productRenderer.includes(`value="${value}"`), `the Owner form provides the ${value} store choice`);
assert.match(saveProduct, /validStoreAvailability[\s\S]*record\.storeAvailability=storeAvailability/, "Owner product saves validate and persist Store Availability");
assert.match(html, /id="detailStoreAvailability"/, "Product Details has a customer-facing store availability row");
assert.match(productOpen, /productStoreAvailabilityLabel\(p\)/, "Product Details shows the saved store assignment");
for (const label of ["Basic Info", "Photos", "Colors & Stock", "Discounts & Offers"]) {
  assert.ok(productRenderer.includes(label), `the Owner editor exposes ${label}`);
}
for (const field of ["ownerProductBasicPanel", "ownerProductPhotosPanel", "ownerProductInventoryPanel", "ownerProductNameEn", "ownerProductNameAr", "ownerProductNameKu", "ownerProductImagesData", "ownerProductColors", "ownerInventoryMatrix"]) {
  assert.ok(productRenderer.includes(field), `the redesigned screen preserves ${field}`);
}
assert.match(productRenderer, /role="tablist"/);
assert.match(productRenderer, /novalidate/);
assert.ok((productRenderer.match(/type="submit"/g) || []).length >= 2, "Save stays available at the top and bottom without covering form controls");
assert.match(productRenderer, /canEditPrices\?renderProductPricing/);
assert.match(productRenderer, /Price hidden/);
assert.match(productRenderer, /staffHasPermission\("prices"\)/);
assert.match(productRenderer, /staffHasPermission\("inventory"\)/);
assert.match(productRenderer, /ownerProductPhotoList select,#ownerProductPhotoList button/);
assert.match(productRenderer, /navigateOwnerProductSection\('products'\)/);
assert.match(productRenderer, /navigateOwnerProductSection\('categories'\)/);
assert.match(productRenderer, /navigateOwnerProductSection\('discounts'\)/);
assert.match(productRenderer, /ownerDashboardText\(en,ku,ar\)/, "labels are produced in the selected Kurdish, Arabic, or English language");
assert.match(inventory, /owner-inventory-color-card/);
assert.match(inventory, /owner-inventory-size-grid/);
assert.doesNotMatch(inventory, /<table/);
assert.match(photoList, /updateOwnerProductPhotoColor/);
assert.match(photoList, /editOwnerProductPhoto/);
assert.match(editPhoto, /fetch\(safeImageUrl\(photo\.src\)/);
assert.match(editPhoto, /openOwnerImageCrop\(blob/);
assert.match(cropFinish, /state\.kind==="product"&&Number\.isInteger\(state\.photoIndex\)/);
assert.match(cropFinish, /photos\[state\.photoIndex\]=\{src:imageUrl,color:/);
assert.ok(cropFinish.indexOf("if(!apply)") < cropFinish.indexOf("uploadOwnerImageToCloud"), "Cancel exits before any photo upload or replacement");
assert.match(cropFinish, /renderOwnerCropBlob\(state\)/);

for (const ratio of ["free", "1", "0.75", "0.8", "0.5625"]) assert.ok(html.includes(`data-crop-ratio="${ratio}"`), `crop supports ${ratio}`);
for (const languageLabel of [
  `["زانیاریێن سەرەکی","Basic Info","المعلومات الأساسية"]`,
  `["ڕەنگ و ستۆک","Colors & Stock","الألوان والمخزون"]`,
  `["ئازاد","Free","حر"]`,
]) assert.ok(html.includes(languageLabel), `translation row exists: ${languageLabel}`);
assert.match(html, /\.owner-inventory-size-grid\{display:grid;grid-template-columns:repeat\(auto-fit/);
assert.match(html, /\.owner-product-editor-tabs\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
assert.match(html, /\.crop-handle\[data-crop-handle="nw"\]\{top:3px;left:3px\}/);
assert.match(html, /\.crop-handle\[data-crop-handle="ne"\]\{top:3px;right:3px/);

const selectorButtons = ["basic", "photos", "inventory"].map(value => ({ dataset: { ownerProductTab: value }, setAttribute(name, val) { this[name] = val; } }));
const panels = ["basic", "photos", "inventory"].map(value => ({ dataset: { ownerProductPanel: value }, hidden: false, scrollIntoView() { this.scrolled = true; } }));
const tabContext = vm.createContext({
  ownerProductEditorTab: "basic",
  document: { querySelectorAll(selector) { return selector.includes("owner-product-tab]") ? selectorButtons : panels; }, querySelector() { return panels.find(panel => panel.dataset.ownerProductPanel === "photos"); } },
});
vm.runInContext(`${ownerNavigationIdentity}\n${createOwnerNavigationLedger}\nlet ownerNavigationLedger=createOwnerNavigationLedger();ownerNavigationLedger.start({productEditorTab:"basic"});\n${tabSwitch}\nthis.selectOwnerProductEditorTab=selectOwnerProductEditorTab;this.ownerNavigationLedger=ownerNavigationLedger;`, tabContext);
assert.equal(tabContext.selectOwnerProductEditorTab("photos", false), "photos");
assert.equal(tabContext.ownerProductEditorTab, "photos");
assert.equal(tabContext.ownerNavigationLedger.current().productEditorTab, "photos", "the selected tab updates the real Owner navigation ledger context");
assert.deepEqual(panels.map(panel => panel.hidden), [true, false, true]);
assert.deepEqual(selectorButtons.map(button => button["aria-selected"]), ["false", "true", "false"]);
assert.deepEqual(normalizeCropTransform(vm.runInNewContext(`${cropMatrix}\nownerCropDrawMatrix(80,100,90,true,false,0,0,100,80,100,80)`)), [0, 1, 1, 0, 0, 0]);

console.log("Owner product redesign checks passed: multilingual sections, staff price visibility, responsive stock cards, original-photo safety, and crop geometry.");
