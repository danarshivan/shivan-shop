import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import { runInNewContext } from "node:vm";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const apiSource = await readFile(new URL("../functions/api/[[path]].js", import.meta.url), "utf8");
const apiUrl = `data:text/javascript;base64,${Buffer.from(apiSource).toString("base64")}`;
const { onRequest } = await import(apiUrl);
const htmlSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
const inlineScripts = [...htmlSource.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]).filter(script => script.trim());
assert.ok(inlineScripts.length, "the storefront should contain its application script");
for (const [index, script] of inlineScripts.entries()) {
  try { new Function(script); }
  catch (exception) { throw new Error(`Storefront script ${index + 1} has a syntax error: ${exception.message}`); }
}
const productSaveSource = htmlSource.match(/async function saveOwnerProduct\(event\)\{[\s\S]*?\n\}/)?.[0] || "";
const productPricingSource = htmlSource.match(/function getProductPricing\(product\)\{[\s\S]*?\n\}/)?.[0] || "";
const renderPriceBreakdownSource = htmlSource.match(/function renderPriceBreakdown\(originalPrice,finalPrice,discountPercent,\{badge=false\}=\{\}\)\{[\s\S]*?\n\}/)?.[0] || "";
const renderProductPricingSource = htmlSource.match(/function renderProductPricing\(product,options=\{\}\)\{[\s\S]*?\n\}/)?.[0] || "";
const ownerDiscountPreviewSource = htmlSource.match(/function updateOwnerDiscountPreview\(\)\{[\s\S]*?\n\}/)?.[0] || "";
const ownerDiscountTimerEndSource = htmlSource.match(/function ownerDiscountTimerEndIso\(\)\{[\s\S]*?\n\}/)?.[0] || "";
const cartItemPricingSource = htmlSource.match(/function cartItemPricing\(item\)\{[\s\S]*?\n\}/)?.[0] || "";
const renderCartItemPriceSource = htmlSource.match(/function renderCartItemPrice\(item\)\{[\s\S]*?\n\}/)?.[0] || "";
const cartPriceSnapshotSource = htmlSource.match(/function cartPriceSnapshot\(product\)\{[\s\S]*?\n\}/)?.[0] || "";
const cartItemCheckoutSnapshotSource = htmlSource.match(/function cartItemCheckoutSnapshot\(item\)\{[\s\S]*?\n\}/)?.[0] || "";
const renderOrderItemPriceSource = htmlSource.match(/function renderOrderItemPrice\(item\)\{[\s\S]*?\n\}/)?.[0] || "";
const inventoryDraftSource = htmlSource.match(/function readOwnerInventoryDraft\(\)\{[\s\S]*?\n\}/)?.[0] || "";
const inventoryRendererSource = htmlSource.match(/function renderOwnerInventoryMatrix\(\)\{[\s\S]*?\n\}/)?.[0] || "";
const inventoryTotalSource = htmlSource.match(/function updateOwnerInventoryTotal\(\)\{[\s\S]*?\n\}/)?.[0] || "";
const finishImageCropSource = htmlSource.match(/async function finishImageCrop\(apply\)\{[\s\S]*?\n\}/)?.[0] || "";
const bindImageCropActionsSource = htmlSource.match(/function bindImageCropActions\(\)\{[\s\S]*?\n\}/)?.[0] || "";
const setImageCropBusySource = htmlSource.match(/function setImageCropBusy\(busy\)\{[\s\S]*?\n\}/)?.[0] || "";
const closeImageCropSource = htmlSource.match(/function closeImageCrop\(\)\{[\s\S]*?\n\}/)?.[0] || "";
const prepareOwnerCropSourceSource = htmlSource.match(/async function prepareOwnerCropSource\(file\)\{[\s\S]*?\n\}/)?.[0] || "";
const readOwnerImageDimensionsSource = htmlSource.match(/async function readOwnerImageDimensions\(file\)\{[\s\S]*?\n\}/)?.[0] || "";
const releasePreparedCropSourceSource = htmlSource.match(/function releasePreparedCropSource\(source\)\{[\s\S]*?\n\}/)?.[0] || "";
const openOwnerImageCropSource = htmlSource.match(/function openOwnerImageCrop\(file,details\)\{[\s\S]*?\n\}/)?.[0] || "";
const canvasBlobSource = htmlSource.match(/function canvasBlob\(canvas,type,quality,[\s\S]*?\n\}/)?.[0] || "";
const resetPasswordSource = htmlSource.match(/function resetPassword\(\)\{[\s\S]*?\n\}/)?.[0] || "";
const cloudRequestSource = htmlSource.match(/async function cloudRequest\(path,options=\{\}\)\{[\s\S]*?\n\}/)?.[0] || "";
const uploadOwnerImageToCloudSource = htmlSource.match(/async function uploadOwnerImageToCloud\(blob,requestId="",signal\)\{[\s\S]*?\n\}/)?.[0] || "";
const persistOwnerShopValueSource = htmlSource.match(/async function persistOwnerShopValue\(key,value,requestId\)\{[\s\S]*?\n\}/)?.[0] || "";
const confirmCloudShopWritesSource = htmlSource.match(/async function confirmCloudShopWrites\(keys,requestId=""\)\{[\s\S]*?\n\}/)?.[0] || "";
const confirmCloudShopWriteSource = htmlSource.match(/async function confirmCloudShopWrite\(key,requestId=""\)\{[\s\S]*?\n\}/)?.[0] || "";
const clearAcknowledgedCloudWriteSource = htmlSource.match(/function clearAcknowledgedCloudWrite\(key,accountId,value\)\{[\s\S]*?\n\}/)?.[0] || "";
assert.match(productSaveSource, /await confirmCloudShopWrite\(PRODUCTS_KEY,requestId\)/, "the Owner form must wait for the shared-save result");
assert.match(productSaveSource, /shared database has not confirmed/i, "the Owner form must not report an unconfirmed cloud save as complete");
assert.match(productSaveSource, /finally\{[\s\S]*?submitButton\.disabled=false/, "the Owner Save button must always unlock after a failed save");
assert.doesNotMatch(productSaveSource, /renderOwnerInventoryMatrix\(\)/, "saving a product must not rebuild the stock table on the main thread");
assert.match(htmlSource, /const MAX_OWNER_PRODUCT_VARIANTS = 120;/, "the Owner form must cap the color and size combination count");
assert.match(inventoryRendererSource, /type="number" min="0" step="1" inputmode="numeric"/, "stock quantities should use lightweight numeric inputs");
assert.doesNotMatch(inventoryRendererSource, /<select|<option/, "the stock matrix must not generate large option lists");
assert.match(inventoryRendererSource, /combinationCount>MAX_OWNER_PRODUCT_VARIANTS/, "the inventory table must stop rendering above the variant limit");
assert.match(productSaveSource, /combinationCount>MAX_OWNER_PRODUCT_VARIANTS/, "the save handler must reject over-limit variants before building product data");
assert.match(finishImageCropSource, /for\(const maxOutput of \[1000,760\]\)/, "crop compression should use two bounded output sizes");
assert.match(finishImageCropSource, /\[\["image\/webp",\.76\],\["image\/jpeg",\.7\]\]/, "crop compression should make at most one attempt per format and output size");
const cloudFailureBranch = productSaveSource.indexOf("if(cloudSyncRequired&&!cloudSaved)");
const productSuccessExit = productSaveSource.indexOf("editingProductId=null");
assert.ok(cloudFailureBranch >= 0 && cloudFailureBranch < productSuccessExit, "a failed shared save must keep the Owner form open before the success navigation");
assert.match(productSaveSource.slice(cloudFailureBranch, productSuccessExit), /editingProductId=record\.id/, "a retry must reuse the pending product ID instead of creating a duplicate");
assert.match(prepareOwnerCropSourceSource, /resizeOptions\.resizeWidth=resizeLongEdge/, "landscape photos must be resized on one axis to preserve their aspect ratio");
assert.match(prepareOwnerCropSourceSource, /resizeOptions\.resizeHeight=resizeLongEdge/, "portrait photos must be resized on one axis to preserve their aspect ratio");
assert.match(readOwnerImageDimensionsSource, /file\.slice\(0,Math\.min\(file\.size,1024\*1024\)\)/, "source dimensions must be read from a bounded header before decoding");
assert.match(prepareOwnerCropSourceSource, /bitmap\.width\*bitmap\.height>MAX_CROP_SOURCE_PIXELS/, "oversized decoded images must be rejected before crop work continues");
assert.match(htmlSource.match(/function closeImageCrop\(\)\{[\s\S]*?\n\}/)?.[0] || "", /releasePreparedCropSource\(state\)/, "closing the crop UI must release bitmap and temporary URL resources");
assert.doesNotMatch(htmlSource, /readAsDataURL\(/, "the Owner image flow must not create a full-size base64 copy");
assert.match(htmlSource, /\.crop-ratios button[^\n]*min-height:44px/, "crop ratio controls must remain thumb-friendly on phones");
assert.match(htmlSource, /crop-actions button\{min-height:48px\}/, "crop actions must have mobile-sized tap targets");
assert.match(htmlSource, /\.crop-modal button\[data-crop-action\][^\n]*touch-action:manipulation/, "crop action buttons must accept direct mobile taps");
assert.match(htmlSource, /data-crop-action="cancel"/, "crop cancel controls must have an explicit delegated action");
assert.match(htmlSource, /data-crop-action="apply"/, "crop save must have an explicit delegated action");
assert.doesNotMatch(htmlSource, /onclick="finishImageCrop\(/, "crop actions must not depend on inline click handlers");
assert.match(finishImageCropSource, /if\(!apply\)[\s\S]*?state\.abortController\?\.abort\(\)[\s\S]*?if\(state\.uploading\)return/, "Cancel must remain available during crop processing");
assert.match(finishImageCropSource, /setImageCropBusy\(true\)/, "crop controls should enter a deliberate busy state");
assert.match(finishImageCropSource, /state\.cancelled\|\|pendingImageCrop!==state/, "a canceled crop must not attach an image after an async step");
assert.match(canvasBlobSource, /timeoutMs=15000/, "image encoding must fail clearly instead of waiting forever");
assert.match(canvasBlobSource, /signal\?\.addEventListener\("abort",onAbort/, "pending image encoding must be cancelable");
assert.match(uploadOwnerImageToCloudSource, /body:blob,signal,requestId:traceId/, "Cancel must be able to abort an in-progress image upload");
assert.match(htmlSource, /id="cropStatus"[^>]*role="status"/, "crop processing should expose an accessible progress status");
assert.match(confirmCloudShopWritesSource, /persistOwnerShopValue\(key,latestValue,requestId\)/, "a missing or stale outbox entry must fall back to an explicit shared save request");
assert.match(confirmCloudShopWritesSource, /persistOwnerShopDelete\(key,requestId\)/, "a missing or stale delete marker must fall back to an explicit shared delete request");
assert.match(cloudRequestSource, /AbortController/, "owner cloud requests need a timeout so the UI cannot wait forever");
assert.match(resetPasswordSource, /if\(cloudMode\)[\s\S]*?cloud passwords can only be changed after signing in/i, "the hosted forgot-password flow must not bypass account verification");
assert.match(htmlSource, /stock-line \$\{\(Number\(p\.stock\)\|\|0\)<=0\?"out-of-stock":""\}/, "zero-stock products should receive the out-of-stock status style");
assert.match(htmlSource, /بەردەست نەماوە/, "the storefront should show a localized out-of-stock label");
assert.ok(productPricingSource, "the storefront should calculate a shared product price breakdown");
assert.match(productSaveSource, /ownerProductDiscount/, "Owner product saves should include the optional discount field");
assert.match(productSaveSource, /validDiscount/, "Owner product saves should reject invalid discount percentages before writing");
assert.match(htmlSource, /id="ownerProductDiscount" type="number" min="1" max="99" step="1"/, "the Owner form should constrain the optional discount to whole values from 1 through 99");
assert.match(htmlSource, /id="ownerDiscountPreview"[^>]*aria-live="polite"/, "the Owner form should display an accessible final-price preview");
assert.match(htmlSource, /productDiscountPercent\(p\).*product-discount-badge/s, "discounted product cards should show a red percentage badge on the image");
assert.match(htmlSource, /detailPrice"\)\.innerHTML=renderProductPricing\(p,\{badge:true\}\)/, "product details should show original, discounted price, and the percentage");
assert.match(htmlSource, /renderProductPricing\(item,\{badge:true\}\)/, "the Owner list should show the same discounted price breakdown");
assert.match(htmlSource, /function renderCartItemPrice\(item\)/, "cart items should display their effective discounted totals");
assert.match(htmlSource, /cartItemPricing\(item\)\.finalPrice/, "cart and checkout totals should use the final discounted unit price");
assert.match(htmlSource, /items:cart\.map\(cartItemCheckoutSnapshot\)/, "orders should preserve the selected final and original price snapshot");
assert.match(htmlSource, /renderOrderItemPrice\(item\)/, "customer and Owner order history should show saved item price breakdowns");

const priceSandbox = {
  Number,
  BigInt,
  formatPrice: price => `${Number(price).toLocaleString("en-US")} IQD`,
};
const productPricing = runInNewContext(`${productPricingSource}\n${renderPriceBreakdownSource}\n${renderProductPricingSource}\n({getProductPricing,renderProductPricing})`, priceSandbox);
assert.deepEqual({ ...productPricing.getProductPricing({ price: 12000 }) }, { originalPrice: 12000, discountPercent: 0, finalPrice: 12000 }, "products without a discount should keep the original price");
for (const [percent, expected] of [[10,10800],[20,9600],[30,8400],[50,6000],[99,120],[1,11880]]) {
  const pricing = productPricing.getProductPricing({ price: 12000, discount: percent });
  assert.equal(pricing.finalPrice, expected, `${percent}% should calculate the correct IQD final price`);
  const markup = productPricing.renderProductPricing({ price: 12000, discount: percent }, { badge: true });
  assert.match(markup, /original-price/, "a discounted price should retain its struck-through original amount");
  assert.match(markup, /discounted-price/, "a discounted price should emphasize the final amount");
  assert.match(markup, new RegExp(`-${percent}%`), "product details should show the discount percentage");
}
for (const discount of [0,100,-1,30.5,"bad"]) assert.equal(productPricing.getProductPricing({ price: 12000, discount }), null, `invalid discount ${discount} should not be priced as a valid offer`);

const previewElements = new Map([
  ["ownerProductPrice", { value: "12000" }],
  ["ownerProductDiscount", { value: "30", setAttribute(name, value) { this[name] = value; } }],
  ["ownerDiscountPreview", { textContent: "" }],
]);
const previewSandbox = {
  document: { getElementById: id => previewElements.get(id) || null },
  getProductPricing: productPricing.getProductPricing,
  formatPrice: price => `${Number(price).toLocaleString("en-US")} IQD`,
};
const updateDiscountPreview = runInNewContext(`${ownerDiscountTimerEndSource}\n${ownerDiscountPreviewSource}\nupdateOwnerDiscountPreview`, previewSandbox);
assert.equal(updateDiscountPreview(), true, "a valid Owner discount should render a final-price preview");
assert.match(previewElements.get("ownerDiscountPreview").textContent, /8,400 IQD after 30% off 12,000 IQD/);
previewElements.get("ownerProductDiscount").value = "";
assert.equal(updateDiscountPreview(), true, "blank discount should remain a valid no-discount product");
assert.match(previewElements.get("ownerDiscountPreview").textContent, /12,000 IQD \(no discount\)/);
previewElements.get("ownerProductDiscount").value = "100";
assert.equal(updateDiscountPreview(), false, "an invalid Owner discount should be rejected before saving");
assert.match(previewElements.get("ownerDiscountPreview").textContent, /from 1 to 99/);

const cartPricingProduct = { id: 7, price: 12000, discount: 30 };
const cartPricingSandbox = {
  products: [cartPricingProduct],
  getProductPricing: productPricing.getProductPricing,
  formatPrice: price => `${Number(price).toLocaleString("en-US")} IQD`,
};
const cartPricingFns = runInNewContext(`${renderPriceBreakdownSource}\n${cartItemPricingSource}\n${renderCartItemPriceSource}\n${cartPriceSnapshotSource}\n${cartItemCheckoutSnapshotSource}\n${renderOrderItemPriceSource}\n({cartItemPricing,renderCartItemPrice,cartPriceSnapshot,cartItemCheckoutSnapshot,renderOrderItemPrice})`, cartPricingSandbox);
const priorCartItem = { productId: 7, price: 12000, qty: 2, size: "M", color: "#ff0000" };
assert.equal(cartPricingFns.cartItemPricing(priorCartItem).finalPrice, 8400, "a cart should apply the current product discount once");
const cartMarkup = cartPricingFns.renderCartItemPrice(priorCartItem);
assert.match(cartMarkup, /24,000 IQD/, "cart should preserve the original extended price for reference");
assert.match(cartMarkup, /16,800 IQD/, "cart should use the discounted extended price");
assert.match(cartMarkup, /-30%/, "cart should show the current discount percentage");
const checkoutSnapshot = cartPricingFns.cartItemCheckoutSnapshot(priorCartItem);
assert.equal(checkoutSnapshot.price, 8400, "checkout should snapshot the already discounted unit price");
assert.equal(checkoutSnapshot.originalPrice, 12000, "checkout should snapshot the original unit price");
assert.equal(checkoutSnapshot.discount, 30, "checkout should snapshot the discount exactly once");
assert.equal(cartPricingProduct.price, 12000, "applying a discount must never mutate the original product price");
assert.equal(cartPricingFns.cartItemPricing(checkoutSnapshot).finalPrice, 8400, "a checkout snapshot must not receive the discount twice");
const orderMarkup = cartPricingFns.renderOrderItemPrice(checkoutSnapshot);
assert.match(orderMarkup, /24,000 IQD/);
assert.match(orderMarkup, /16,800 IQD/);
cartPricingProduct.discount = undefined;
assert.equal(cartPricingFns.cartItemPricing(checkoutSnapshot).finalPrice, 12000, "removing an active product discount should restore its original price for existing discounted cart items");
assert.equal(cartPricingFns.cartItemPricing({ productId: 7, price: 11000, qty: 1 }).finalPrice, 11000, "legacy no-discount cart prices should retain their existing snapshot behavior");
const noDiscountSnapshot = cartPricingFns.cartItemCheckoutSnapshot(checkoutSnapshot);
assert.equal(Object.hasOwn(noDiscountSnapshot, "discount"), false, "checkout should remove a discount that the Owner has removed");
assert.equal(Object.hasOwn(noDiscountSnapshot, "originalPrice"), false, "checkout should clear the previous discount reference when no discount remains");

let cropDelegatedClick = null;
const cropDelegatedModal = {
  dataset: {},
  addEventListener(type, listener) { assert.equal(type, "click"); cropDelegatedClick = listener; },
  contains(button) { return ["cancel", "apply"].includes(button?.dataset?.cropAction); },
};
const cropActionCalls = [];
runInNewContext(`${bindImageCropActionsSource}\nbindImageCropActions()`, {
  document: { getElementById: id => id === "imageCropModal" ? cropDelegatedModal : null },
  finishImageCrop: apply => cropActionCalls.push(apply),
});
let cropClickPrevented = 0;
for (const action of ["cancel", "apply"]) {
  cropDelegatedClick({ target: { closest: () => ({ dataset: { cropAction: action }, disabled: false }) }, preventDefault() { cropClickPrevented++; } });
}
assert.deepEqual(cropActionCalls, [false, true], "mobile crop taps should dispatch Cancel and Crop actions through the modal's delegated click handler");
assert.equal(cropClickPrevented, 2, "crop action taps should not bubble into unrelated page controls");
assert.equal(cropDelegatedModal.dataset.cropActionsBound, "true", "crop click handling should bind only once");

const timedCanvasBlobSource = canvasBlobSource.replace("timeoutMs=15000", "timeoutMs=5");
await assert.rejects(
  runInNewContext(`${timedCanvasBlobSource}\ncanvasBlob({toBlob(){}}, "image/webp", .8)`, { setTimeout, clearTimeout }),
  /Photo compression took too long/,
  "a canvas encoder that never calls back should fail clearly rather than lock the crop modal"
);

const inventoryBox = { innerHTML: "", hidden: false };
const inventorySizes = { value: "S, M" };
const inventoryColors = { value: "Red:#ff0000, Blue:#0000ff" };
const inventoryLimitMessage = { textContent: "" };
const inventoryTotal = { textContent: "" };
const inventoryElements = new Map([
  ["ownerInventoryMatrix", inventoryBox], ["ownerProductSizes", inventorySizes],
  ["ownerProductColors", inventoryColors], ["ownerInventoryLimitMessage", inventoryLimitMessage],
  ["ownerInventoryTotal", inventoryTotal],
]);
const inventorySandbox = {
  MAX_OWNER_PRODUCT_VARIANTS: 120,
  ownerInventoryDraft: new Map(),
  editingProductId: null,
  products: [],
  document: { getElementById: id => inventoryElements.get(id) || null, querySelectorAll: () => [] },
  parseOwnerColorEntries: () => [{ name: "Red", value: "#ff0000" }, { name: "Blue", value: "#0000ff" }],
  escapeHtml: value => String(value),
};
const renderInventory = runInNewContext(`${inventoryDraftSource}\n${inventoryTotalSource}\n${inventoryRendererSource}\nrenderOwnerInventoryMatrix`, inventorySandbox);
renderInventory();
assert.equal((inventoryBox.innerHTML.match(/<input type="number"/g) || []).length, 4, "each color and size pair should create one numeric stock input");
assert.doesNotMatch(inventoryBox.innerHTML, /<select|<option/, "stock rendering must not create hundreds of quantity options");
inventorySizes.value = Array.from({ length: 121 }, (_, index) => `S${index}`).join(", ");
inventoryColors.value = "Red:#ff0000";
renderInventory();
assert.equal(inventoryBox.innerHTML, "", "an over-limit stock matrix should not render a large table");
assert.equal(inventoryBox.hidden, true, "an over-limit matrix should remain hidden while the owner corrects it");
assert.match(inventoryLimitMessage.textContent, /at most 120/, "the Owner form should explain the variant limit");

class MemoryD1 {
  shop = new Map();
  accounts = new Map();
  sessions = new Map();
  orders = new Map();
  failNextProductWrite = false;
  failNextProductResult = false;
  failNextShopResult = false;
  failNextOrderWrite = false;

  prepare(sql) {
    const statement = {
      sql,
      values: [],
      bind: (...values) => { statement.values = values; return statement; },
      first: async () => this.first(statement.sql, statement.values),
      all: async () => this.all(statement.sql, statement.values),
      run: async () => this.run(statement.sql, statement.values),
    };
    return statement;
  }

  async batch(statements) {
    const previousShop = new Map(this.shop);
    const results = [];
    try {
      for (const statement of statements) {
        const result = await statement.run();
        results.push(result);
        if (result?.success !== true) {
          this.shop = previousShop;
          break;
        }
      }
    } catch (exception) {
      this.shop = previousShop;
      throw exception;
    }
    return results;
  }

  async first(sql, values) {
    if (sql.includes("FROM orders WHERE id=?")) {
      const order = this.orders.get(values[0]);
      if (!order) return null;
      return sql.includes("SELECT payload") ? { payload: order.payload } : { account_id: order.account_id };
    }
    if (sql.includes("FROM accounts WHERE role='owner'")) {
      const row = [...this.accounts.values()].find(account => account.role === "owner");
      return row ? { id: row.id } : null;
    }
    if (sql.includes("FROM sessions s JOIN accounts a")) {
      const [tokenHash, timestamp] = values;
      const session = this.sessions.get(tokenHash);
      if (!session || session.expiresAt <= timestamp) return null;
      const account = this.accounts.get(session.accountId);
      return account ? { id: account.id, identifier: account.identifier, name: account.name, role: account.role } : null;
    }
    if (sql.includes("FROM shop_state WHERE key=?") || sql.includes("FROM shop_state WHERE key='shivan_shop_products'")) {
      const key = sql.includes("key='shivan_shop_products'") ? "shivan_shop_products" : values[0];
      const value = this.shop.get(key);
      return value === undefined ? null : { value };
    }
    if (sql.includes("FROM accounts WHERE identifier=?")) {
      return [...this.accounts.values()].find(account => account.identifier.toLowerCase() === String(values[0]).toLowerCase()) || null;
    }
    if (sql.includes("FROM accounts WHERE id=?")) {
      const account = this.accounts.get(values[0]);
      if (!account || (sql.includes("role='customer'") && account.role !== "customer")) return null;
      return sql.includes("password_salt")
        ? { password_salt: account.password_salt, password_hash: account.password_hash }
        : { id: account.id };
    }
    return null;
  }

  async all(sql, values) {
    if (sql.includes("FROM shop_state")) {
      return { results: [...this.shop.entries()]
        .filter(([key]) => !key.startsWith("media:"))
        .map(([key, value]) => ({ key, value })) };
    }
    if (sql.includes("FROM orders")) {
      const accountId = values?.[0];
      return { results: [...this.orders.values()]
        .filter(order => !sql.includes("WHERE account_id=?") || order.account_id === accountId)
        .map(order => ({ payload: order.payload })) };
    }
    return { results: [] };
  }

  async run(sql, values) {
    if (sql.includes("UPDATE orders SET payload=json_set")) {
      const [status, id, priorPayload] = values;
      if (this.failNextOrderWrite) { this.failNextOrderWrite = false; throw new Error("Simulated D1 order status write failure"); }
      const saved = this.orders.get(id);
      if (!saved || saved.payload !== priorPayload) return { success: true, meta: { changes: 0 } };
      const payload = JSON.parse(saved.payload);
      payload.status = status;
      saved.payload = JSON.stringify(payload);
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.includes("UPDATE shop_state SET value=?")) {
      const [value, , previousValue] = values;
      if (this.shop.get("shivan_shop_products") !== previousValue) return { success: true, meta: { changes: 0 } };
      this.shop.set("shivan_shop_products", value);
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.includes("INSERT INTO orders")) {
      const [id, accountId, payload] = values;
      if (sql.includes("DO NOTHING") && this.orders.has(id)) return { success: true, meta: { changes: 0 } };
      this.orders.set(id, { account_id: accountId, payload });
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.includes("INSERT INTO user_state") && sql.includes("SELECT")) return { success: true, meta: { changes: 1 } };
    if (sql.includes("DELETE FROM user_state")) return { success: true, meta: { changes: 1 } };
    if (sql.includes("INSERT INTO accounts")) {
      const [id, identifier, name, salt, hash, createdAt] = values;
      if ([...this.accounts.values()].some(account => account.identifier.toLowerCase() === identifier.toLowerCase())) throw new Error("Unique identifier");
      const role = sql.includes("'owner'") ? "owner" : "customer";
      this.accounts.set(id, { id, identifier, name, role, password_salt: salt, password_hash: hash, created_at: createdAt });
      return { success: true };
    }
    if (sql.includes("INSERT INTO sessions")) {
      const [tokenHash, accountId, expiresAt] = values;
      this.sessions.set(tokenHash, { accountId, expiresAt });
      return { success: true };
    }
    if (sql.includes("DELETE FROM sessions")) {
      this.sessions.delete(values[0]);
      return { success: true };
    }
    if (sql.includes("UPDATE accounts SET password_salt")) {
      const [salt, hash, id] = values;
      const account = this.accounts.get(id);
      if (account) { account.password_salt = salt; account.password_hash = hash; }
      return { success: true };
    }
    if (sql.includes("INSERT INTO shop_state")) {
      const [key, value] = values;
      if (this.failNextShopResult) {
        this.failNextShopResult = false;
        return { success: false, error: "Simulated D1 shop result failure" };
      }
      if (key === "shivan_shop_products" && this.failNextProductResult) {
        this.failNextProductResult = false;
        return { success: false, error: "Simulated D1 product result failure" };
      }
      if (key === "shivan_shop_products" && this.failNextProductWrite) {
        this.failNextProductWrite = false;
        throw new Error("Simulated D1 write failure");
      }
      if (sql.includes("DO NOTHING") && this.shop.has(key)) return { success: true };
      this.shop.set(key, value);
      return { success: true };
    }
    return { success: true };
  }
}

class MemoryR2 {
  objects = new Map();
  failNextPut = false;
  putCount = 0;

  async put(key, bytes, options = {}) {
    this.putCount++;
    if (this.failNextPut) {
      this.failNextPut = false;
      throw new Error("Simulated R2 write failure");
    }
    const body = new Uint8Array(bytes);
    const contentType = options.httpMetadata?.contentType || "application/octet-stream";
    this.objects.set(key, { bytes: body, contentType, cacheControl: options.httpMetadata?.cacheControl || "" });
    return { key, size: body.byteLength };
  }

  async get(key) {
    const object = this.objects.get(key);
    if (!object) return null;
    return {
      body: new Uint8Array(object.bytes),
      writeHttpMetadata: headers => {
        if (object.contentType) headers.set("Content-Type", object.contentType);
        if (object.cacheControl) headers.set("Cache-Control", object.cacheControl);
      },
    };
  }
}

const DB = new MemoryD1();
const MEDIA = new MemoryR2();
const env = { DB, MEDIA, OWNER_SETUP_TOKEN: "test-only-owner-code" };
const context = async request => onRequest({ request, env });
const ownerSaveLogLines = [];
const originalConsoleInfo = console.info;
console.info = (...args) => ownerSaveLogLines.push(args.join(" "));
const imageBytes = Uint8Array.from([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]);
const ownerSetup = await context(new Request("https://shop.test/api/auth/setup-owner", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ setupToken: env.OWNER_SETUP_TOKEN, name: "Owner", identifier: "07502342153", password: "long-test-password" }),
}));
assert.equal(ownerSetup.status, 201, "owner setup should succeed in the test database");
const cookie = ownerSetup.headers.get("Set-Cookie").split(";")[0];
const ownerLogin = await context(new Request("https://shop.test/api/auth/login", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ identifier: "07502342153", password: "long-test-password" }),
}));
assert.equal(ownerLogin.status, 200, "the authorized owner should be able to sign in");
const ownerLoginCookie = ownerLogin.headers.get("Set-Cookie").split(";")[0];
const ownerMe = await context(new Request("https://shop.test/api/auth/me", { headers: { Cookie: ownerLoginCookie } }));
assert.equal((await ownerMe.json()).account.role, "owner", "the session API should preserve the owner role");
const nextOrderId = "order-status-next-test";
const nextOrderBefore = { id: nextOrderId, userId: "customer-order-owner-test", name: "Order Customer", phone: "+9647500000999", address: "Erbil", status: "لە چاوەڕوانی", total: 7400, items: [{ productId: 71, qty: 2, size: "M", color: "#000000" }], paymentMethod: "cash", customerNote: "keep this order data" };
const nextOrderUntouched = { id: "order-status-untouched-test", userId: "customer-order-owner-test", status: "لە چاوەڕوانی", total: 1200, items: [{ productId: 72, qty: 1 }] };
DB.orders.set(nextOrderId, { account_id: nextOrderBefore.userId, payload: JSON.stringify(nextOrderBefore) });
DB.orders.set(nextOrderUntouched.id, { account_id: nextOrderUntouched.userId, payload: JSON.stringify(nextOrderUntouched) });
const nextOrderRequest = (id, expectedStatus, cookie = ownerLoginCookie, method = "PATCH") => context(new Request(`https://shop.test/api/orders/${encodeURIComponent(id)}/next-status`, {
  method, headers: { ...(cookie ? { Cookie: cookie } : {}), "Content-Type": "application/json" },
  body: method === "PATCH" ? JSON.stringify({ expectedStatus }) : undefined,
}));
const anonymousOrderAdvance = await nextOrderRequest(nextOrderId, "لە چاوەڕوانی", "");
assert.equal(anonymousOrderAdvance.status, 401, "order status advancement requires an authenticated session");
const wrongMethodOrderAdvance = await nextOrderRequest(nextOrderId, "لە چاوەڕوانی", ownerLoginCookie, "POST");
assert.equal(wrongMethodOrderAdvance.status, 405, "only the narrow PATCH status action is accepted");
const nextOrderPayloadBefore = DB.orders.get(nextOrderId).payload;
const untouchedOrderPayloadBefore = DB.orders.get(nextOrderUntouched.id).payload;
const advanceToProcessing = await nextOrderRequest(nextOrderId, "لە چاوەڕوانی");
assert.equal(advanceToProcessing.status, 200, "the Owner can advance a saved new order through the existing D1 API");
assert.deepEqual(await advanceToProcessing.json(), { ok: true, persisted: true, orderId: nextOrderId, status: "پێچرا" });
const processingOrder = JSON.parse(DB.orders.get(nextOrderId).payload);
assert.equal(processingOrder.status, "پێچرا", "New advances to Processing");
assert.deepEqual({ ...processingOrder, status: "لە چاوەڕوانی" }, JSON.parse(nextOrderPayloadBefore), "all other fields on the selected order remain unchanged");
assert.equal(DB.orders.get(nextOrderUntouched.id).payload, untouchedOrderPayloadBefore, "the status request does not write another order");
const staleAdvance = await nextOrderRequest(nextOrderId, "لە چاوەڕوانی");
assert.equal(staleAdvance.status, 409, "stale or duplicate clicks cannot overwrite a newer order status");
const advanceToCompleted = await nextOrderRequest(nextOrderId, "پێچرا");
assert.equal(advanceToCompleted.status, 200, "Processing advances to Completed");
assert.equal(JSON.parse(DB.orders.get(nextOrderId).payload).status, "گەهشت");
const completedAgain = await nextOrderRequest(nextOrderId, "گەهشت");
assert.equal(completedAgain.status, 409, "completed orders cannot be advanced again");
const writeFailOrderId = "order-status-write-fail-test";
DB.orders.set(writeFailOrderId, { account_id: nextOrderBefore.userId, payload: JSON.stringify({ id: writeFailOrderId, userId: nextOrderBefore.userId, status: "پێچرا", total: 1200 }) });
DB.failNextOrderWrite = true;
const failedOrderAdvance = await nextOrderRequest(writeFailOrderId, "پێچرا");
assert.equal(failedOrderAdvance.status, 503, "D1 write failures are returned as errors, not false success");
assert.equal(JSON.parse(DB.orders.get(writeFailOrderId).payload).status, "پێچرا", "failed writes leave the persisted order unchanged");
const ownerBadPassword = await context(new Request("https://shop.test/api/auth/login", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ identifier: "07502342153", password: "wrong-password" }),
}));
assert.equal(ownerBadPassword.status, 401, "an incorrect owner password must not create a session");

const uploadRequest = (bytes = imageBytes, requestId = "upload-regression-test-001") => new Request("https://shop.test/api/media/upload", {
  method: "POST",
  headers: { Origin: "https://shop.test", "Content-Type": "image/webp", Cookie: cookie, "X-Client-Request-ID": requestId },
  body: bytes,
});
const upload = await context(uploadRequest());
assert.equal(upload.status, 201, "an authenticated owner upload should be acknowledged after R2 confirms it");
const uploadData = await upload.json();
const { url: imageUrl } = uploadData;
assert.equal(uploadData.persisted, true, "the image API must explicitly acknowledge its R2 write");
assert.equal(uploadData.requestId, "upload-regression-test-001");
assert.match(imageUrl, /^\/api\/media\/shop\/[A-Za-z0-9_-]{43}\.webp$/);
const uploadedKey = imageUrl.replace(/^\/api\/media\//, "");
assert.equal(MEDIA.objects.has(uploadedKey), true, "the uploaded image bytes must exist in the shared R2 bucket");
assert.deepEqual(MEDIA.objects.get(uploadedKey).bytes, imageBytes, "R2 must receive the original validated image bytes");
assert.equal(MEDIA.objects.get(uploadedKey).contentType, "image/webp", "R2 metadata must preserve the image content type");
assert.equal(DB.shop.has(`media:${uploadedKey}`), false, "new image bytes must not be stored in D1");

const originalConsoleError = console.error;
const failedUploadBytes = Uint8Array.from([...imageBytes, 2]);
MEDIA.failNextPut = true;
let failedImageUpload;
try {
  console.error = () => {};
  failedImageUpload = await context(uploadRequest(failedUploadBytes, "upload-r2-failure-test"));
} finally {
  console.error = originalConsoleError;
}
assert.equal(failedImageUpload.status, 503, "R2 image-write failures should be reported as shared-storage errors");
assert.match((await failedImageUpload.json()).error, /could not be saved to shared cloud storage/i);

const unconfirmedUploadBytes = Uint8Array.from([...imageBytes, 3]);
MEDIA.failNextPut = true;
let unconfirmedImageUpload;
try {
  console.error = () => {};
  unconfirmedImageUpload = await context(uploadRequest(unconfirmedUploadBytes, "upload-r2-unconfirmed-test"));
} finally {
  console.error = originalConsoleError;
}
assert.equal(unconfirmedImageUpload.status, 503, "a failed R2 put must not return an image URL as if the upload succeeded");
assert.match((await unconfirmedImageUpload.json()).error, /could not be saved to shared cloud storage/i);
const unboundMediaUpload = await onRequest({ request: uploadRequest(Uint8Array.from([...imageBytes, 6]), "upload-r2-binding-missing-test"), env: { DB, OWNER_SETUP_TOKEN: env.OWNER_SETUP_TOKEN } });
assert.equal(unboundMediaUpload.status, 503, "a missing MEDIA binding must fail clearly instead of acknowledging a D1-only image save");
assert.equal((await unboundMediaUpload.json()).code, "MEDIA_UNAVAILABLE");

const imageResponse = await context(new Request(`https://shop.test${imageUrl}`));
assert.equal(imageResponse.status, 200, "a shared shop image should be readable without an account");
assert.equal(imageResponse.headers.get("Content-Type"), "image/webp");
assert.deepEqual(new Uint8Array(await imageResponse.arrayBuffer()), imageBytes);

const inlineImage = `data:image/webp;base64,${Buffer.from(imageBytes).toString("base64")}`;
const productId = 1791835200123;
const save = await context(new Request("https://shop.test/api/sync", {
  method: "PUT",
  headers: { "Content-Type": "application/json", Cookie: cookie, "X-Client-Request-ID": "product-save-regression-001" },
  body: JSON.stringify({ key: "shivan_shop_products", value: JSON.stringify([{
    id: productId, name: "Test product", names: { en: "Test product", ar: "منتج اختبار", ku: "بەرهەمی تاقیکردنەوە" },
    price: 12000, category: "Jackets", sizes: ["M", "L"], colors: ["#ff0000"], colorNames: ["Red"],
    variants: [{ color: "#ff0000", size: "M", stock: 3 }, { color: "#ff0000", size: "L", stock: 0 }],
    stock: 3, description: "Product details", image: inlineImage, images: [{ src: inlineImage, color: "#ff0000" }],
  }]) }),
}));
assert.equal(save.status, 200, "owner product data referencing an uploaded crop should save into D1");
const saveData = await save.json();
assert.equal(saveData.ok, true, "the save API should explicitly acknowledge the saved shop key");
assert.equal(saveData.key, "shivan_shop_products");
assert.equal(saveData.persisted, true);
assert.equal(saveData.requestId, "product-save-regression-001");
assert.equal(save.headers.get("X-Request-ID"), "product-save-regression-001");
const storedProducts = JSON.parse(DB.shop.get("shivan_shop_products"));
assert.equal(storedProducts.length, 1);
assert.equal(storedProducts[0].id, productId, "D1 persistence must preserve the numeric product ID");
assert.equal(storedProducts[0].price, 12000, "the shared product save must preserve price");
assert.deepEqual(storedProducts[0].sizes, ["M", "L"], "the shared product save must preserve sizes");
assert.deepEqual(storedProducts[0].colors, ["#ff0000"], "the shared product save must preserve colors");
assert.equal(storedProducts[0].variants[0].stock, 3, "the shared product save must preserve variant stock");
assert.equal(storedProducts[0].variants[1].stock, 0, "the shared product save must preserve out-of-stock variants");
assert.equal(storedProducts[0].category, "Jackets", "the shared product save must preserve category");
assert.equal(storedProducts[0].description, "Product details", "the shared product save must preserve product details");
assert.match(storedProducts[0].image, /^\/api\/media\/shop\//);
assert.equal(storedProducts[0].images[0].src, imageUrl, "the saved product must keep the uploaded cropped-image URL");
assert.equal(storedProducts[0].image, imageUrl, "inline product images should be converted to their shared R2 URL before D1 persistence");
assert.doesNotMatch(DB.shop.get("shivan_shop_products"), /data:image\//, "D1 should persist product data and image URLs, not image bytes");

const discountBaseProduct = JSON.parse(DB.shop.get("shivan_shop_products"))[0];
for (const percent of [1,10,20,30,50,99]) {
  const response = await context(new Request("https://shop.test/api/sync", {
    method: "PUT", headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ key: "shivan_shop_products", value: JSON.stringify([{ ...discountBaseProduct, discount: percent }]) }),
  }));
  assert.equal(response.status, 200, `${percent}% product discounts should be accepted by the shared API`);
  const savedDiscountProduct = JSON.parse(DB.shop.get("shivan_shop_products"))[0];
  assert.equal(savedDiscountProduct.price, 12000, "saving a discount must preserve the original product price");
  assert.equal(savedDiscountProduct.discount, percent, "the percentage should persist as product data");
}
const saved99PercentProduct = JSON.parse(DB.shop.get("shivan_shop_products"))[0];
for (const invalidDiscount of [0,100,-1,30.5,"not-a-number"]) {
  const response = await context(new Request("https://shop.test/api/sync", {
    method: "PUT", headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ key: "shivan_shop_products", value: JSON.stringify([{ ...saved99PercentProduct, discount: invalidDiscount }]) }),
  }));
  assert.equal(response.status, 400, `invalid discount ${invalidDiscount} should be rejected by the server`);
  assert.equal((await response.json()).code, "INVALID_PRODUCT_PRICING");
  assert.equal(JSON.parse(DB.shop.get("shivan_shop_products"))[0].discount, 99, "a rejected discount must leave the previous shared product intact");
}
const discountRemovedProduct = { ...saved99PercentProduct };
delete discountRemovedProduct.discount;
const discountRemoval = await context(new Request("https://shop.test/api/sync", {
  method: "PUT", headers: { "Content-Type": "application/json", Cookie: cookie },
  body: JSON.stringify({ key: "shivan_shop_products", value: JSON.stringify([discountRemovedProduct]) }),
}));
assert.equal(discountRemoval.status, 200, "an owner should be able to remove a saved discount");
assert.equal(Object.hasOwn(JSON.parse(DB.shop.get("shivan_shop_products"))[0], "discount"), false, "removing a discount should omit it while preserving the original price");

const reloaded = await context(new Request("https://shop.test/api/sync", { headers: { Cookie: cookie } }));
assert.equal(reloaded.status, 200);
const reloadedData = await reloaded.json();
const reloadedProducts = JSON.parse(reloadedData.shop.shivan_shop_products);
assert.equal(reloadedProducts.length, 1, "a new product must still exist after a server reload");
assert.equal(reloadedProducts[0].id, productId, "the product ID must survive a server reload unchanged");
assert.equal(reloadedProducts[0].price, 12000, "the product price must survive a server reload");
assert.equal(reloadedProducts[0].variants[1].stock, 0, "the out-of-stock quantity must survive a server reload");
assert.equal(reloadedProducts[0].images[0].src, imageUrl, "the cropped image reference must survive a server reload");
const secondDevice = await context(new Request("https://shop.test/api/sync"));
assert.equal(secondDevice.status, 200, "a separate device can load the public shop data from shared D1");
assert.equal(JSON.parse((await secondDevice.json()).shop.shivan_shop_products)[0].images[0].src, imageUrl, "the product and cropped image URL must be shared across devices");
const reloadedProductImage = await context(new Request(`https://shop.test${reloadedProducts[0].images[0].src}`));
assert.equal(reloadedProductImage.status, 200, "the product's cropped image must remain readable after a D1 reload");
assert.deepEqual(new Uint8Array(await reloadedProductImage.arrayBuffer()), imageBytes);

const editedProduct = { ...storedProducts[0], price: 13500, variants: [{ color: "#ff0000", size: "M", stock: 2 }, { color: "#ff0000", size: "L", stock: 0 }], stock: 2 };
const editProductResponse = await context(new Request("https://shop.test/api/sync", {
  method: "PUT", headers: { "Content-Type": "application/json", Cookie: cookie },
  body: JSON.stringify({ key: "shivan_shop_products", value: JSON.stringify([editedProduct]) }),
}));
assert.equal(editProductResponse.status, 200, "editing an existing product should be acknowledged by the shared API");
assert.equal(JSON.parse(DB.shop.get("shivan_shop_products"))[0].price, 13500, "an edited price must replace the shared product value");
assert.equal(JSON.parse(DB.shop.get("shivan_shop_products"))[0].variants[0].stock, 2, "an edited stock quantity must replace the shared value");

const categoryKey = "shivan_shop_categories";
const categoryValue = JSON.stringify(["Jackets", "Tops"]);
const categorySave = await context(new Request("https://shop.test/api/sync", {
  method: "PUT", headers: { "Content-Type": "application/json", Cookie: cookie, "X-Client-Request-ID": "category-save-regression-001" },
  body: JSON.stringify({ key: categoryKey, value: categoryValue }),
}));
assert.equal(categorySave.status, 200, "owner categories should save to shared D1");
assert.equal((await categorySave.json()).persisted, true, "category save should include D1 acknowledgement");
assert.equal(DB.shop.get(categoryKey), categoryValue, "category names should persist in D1");
const bannerImageBytes = Uint8Array.from([...imageBytes, 4]);
const inlineBannerImage = `data:image/webp;base64,${Buffer.from(bannerImageBytes).toString("base64")}`;
const bannerSave = await context(new Request("https://shop.test/api/sync", {
  method: "PUT",
  headers: { "Content-Type": "application/json", Cookie: cookie },
  body: JSON.stringify({ key: "shivan_shop_ads", value: JSON.stringify([{ id: "banner-1", title: "Test banner", image: inlineBannerImage }]) }),
}));
assert.equal(bannerSave.status, 200, "owner banner data and inline photos should save into D1");
assert.deepEqual(await bannerSave.json(), { ok: true, key: "shivan_shop_ads", persisted: true, requestId: bannerSave.headers.get("X-Request-ID") });
assert.equal(JSON.parse(DB.shop.get("shivan_shop_ads"))[0].title, "Test banner", "banner text should persist with its image URL");
const categorySecondDevice = await context(new Request("https://shop.test/api/sync"));
assert.equal(JSON.parse((await categorySecondDevice.json()).shop[categoryKey])[1], "Tops", "category data should load for another device");
const bannerStored = JSON.parse(DB.shop.get("shivan_shop_ads"));
assert.match(bannerStored[0].image, /^\/api\/media\/shop\//, "banner records should reference their shared R2 image");
assert.doesNotMatch(DB.shop.get("shivan_shop_ads"), /data:image\//, "D1 should persist banner text and image URL, not the image bytes");
const bannerImageResponse = await context(new Request(`https://shop.test${bannerStored[0].image}`));
assert.equal(bannerImageResponse.status, 200, "a saved banner image should load from R2");
assert.deepEqual(new Uint8Array(await bannerImageResponse.arrayBuffer()), bannerImageBytes);
const bannerR2Key = bannerStored[0].image.replace(/^\/api\/media\//, "");
assert.equal(MEDIA.objects.has(bannerR2Key), true, "the banner image bytes must be stored in R2");
const savedBannerForSecondDevice = JSON.parse((await (await context(new Request("https://shop.test/api/sync"))).json()).shop.shivan_shop_ads)[0];
assert.equal(savedBannerForSecondDevice.image, bannerStored[0].image, "another device should receive the persisted banner image URL from D1");
const priorBannerValue = DB.shop.get("shivan_shop_ads");
const failedBannerImageBytes = Uint8Array.from([...imageBytes, 5]);
MEDIA.failNextPut = true;
const failedBannerSave = await context(new Request("https://shop.test/api/sync", {
  method: "PUT", headers: { "Content-Type": "application/json", Cookie: cookie },
  body: JSON.stringify({ key: "shivan_shop_ads", value: JSON.stringify([{ id: "banner-2", title: "Unstored banner", image: `data:image/webp;base64,${Buffer.from(failedBannerImageBytes).toString("base64")}` }]) }),
}));
assert.equal(failedBannerSave.status, 503, "failed R2 image storage must reject a banner update");
assert.equal((await failedBannerSave.json()).code, "R2_WRITE_FAILED");
assert.equal(DB.shop.get("shivan_shop_ads"), priorBannerValue, "a failed banner image write must leave the previous banner data unchanged");

DB.failNextShopResult = true;
const failedOwnerSettingWrite = await context(new Request("https://shop.test/api/sync", {
  method: "PUT", headers: { "Content-Type": "application/json", Cookie: cookie, "X-Client-Request-ID": "banner-failure-test-001" },
  body: JSON.stringify({ key: "shivan_shop_owner_appearance", value: JSON.stringify({ accent: "#123456" }) }),
}));
assert.equal(failedOwnerSettingWrite.status, 503, "failed D1 writes for other Owner settings must not look successful");
const failedOwnerSettingData = await failedOwnerSettingWrite.json();
assert.equal(failedOwnerSettingData.requestId, "banner-failure-test-001", "shop setting errors must carry a safe request reference");
assert.equal(failedOwnerSettingData.code, "D1_WRITE_FAILED", "shop setting errors must report the database failure code");

DB.failNextProductResult = true;
let unconfirmedProductSave;
try {
  console.error = () => {};
  unconfirmedProductSave = await context(new Request("https://shop.test/api/sync", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ key: "shivan_shop_products", value: JSON.stringify([{ ...JSON.parse(DB.shop.get("shivan_shop_products"))[0], id: productId + 1, name: "Unconfirmed product" }]) }),
  }));
} finally {
  console.error = originalConsoleError;
}
assert.equal(unconfirmedProductSave.status, 503, "D1 success:false must not return persisted:true for a product write");
const unconfirmedProductData = await unconfirmedProductSave.json();
assert.match(unconfirmedProductData.error, /shared database could not confirm/i);
assert.equal(unconfirmedProductData.code, "D1_WRITE_FAILED");
assert.match(unconfirmedProductData.requestId, /^[A-Za-z0-9_-]{12,80}$/);
assert.equal(unconfirmedProductSave.headers.get("X-Request-ID"), unconfirmedProductData.requestId);
assert.equal(JSON.parse(DB.shop.get("shivan_shop_products"))[0].id, productId, "an unconfirmed product write must leave the previous product data intact");

const otherBytes = Uint8Array.from([...imageBytes, 1]);
const otherInlineImage = `data:image/webp;base64,${Buffer.from(otherBytes).toString("base64")}`;
MEDIA.failNextPut = true;
let failedCroppedImageReference;
try {
  console.error = () => {};
  failedCroppedImageReference = await context(new Request("https://shop.test/api/sync", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ key: "shivan_shop_products", value: JSON.stringify([{ ...JSON.parse(DB.shop.get("shivan_shop_products"))[0], id: productId + 2, name: "Product with unconfirmed crop", image: otherInlineImage, images: [{ src: otherInlineImage, color: "#ff0000" }] }]) }),
  }));
} finally {
  console.error = originalConsoleError;
}
assert.equal(failedCroppedImageReference.status, 503, "a failed R2 image write must block product persistence and return an error");
const failedCropData = await failedCroppedImageReference.json();
assert.equal(failedCropData.code, "R2_WRITE_FAILED");
assert.match(failedCropData.error, /image could not be saved to shared cloud storage/i);
assert.equal(JSON.parse(DB.shop.get("shivan_shop_products"))[0].id, productId, "product data must not update when a referenced image write failed");

// Existing D1- and R2-backed image URLs remain readable without migrating them.
const legacyD1Key = `shop/${"A".repeat(43)}.png`;
DB.shop.set(`media:${legacyD1Key}`, JSON.stringify({ mime: "image/png", data: Buffer.from(imageBytes).toString("base64") }));
const legacyD1ImageResponse = await context(new Request(`https://shop.test/api/media/${legacyD1Key}`));
assert.equal(legacyD1ImageResponse.status, 200, "existing D1-backed images remain readable");
assert.equal(legacyD1ImageResponse.headers.get("Content-Type"), "image/png");
assert.deepEqual(new Uint8Array(await legacyD1ImageResponse.arrayBuffer()), imageBytes);
const legacyMediaKey = `shop/${"B".repeat(43)}.png`;
MEDIA.objects.set(legacyMediaKey, { bytes: new Uint8Array(imageBytes), contentType: "", cacheControl: "" });
const legacyImageResponse = await context(new Request(`https://shop.test/api/media/${legacyMediaKey}`));
assert.equal(legacyImageResponse.status, 200, "existing R2-backed image URLs should remain readable when MEDIA is configured");
assert.equal(legacyImageResponse.headers.get("Content-Type"), "image/png");
assert.deepEqual(new Uint8Array(await legacyImageResponse.arrayBuffer()), imageBytes);

DB.failNextProductWrite = true;
let failedSave;
try {
  console.error = () => {};
  failedSave = await context(new Request("https://shop.test/api/sync", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ key: "shivan_shop_products", value: JSON.stringify([{ ...JSON.parse(DB.shop.get("shivan_shop_products"))[0], id: productId + 1, name: "Unsaved product" }]) }),
  }));
} finally {
  console.error = originalConsoleError;
}
assert.equal(failedSave.status, 503, "D1 failures should be reported as a shared-storage error, not an image-size error");
assert.match((await failedSave.json()).error, /shared database could not confirm/i);
assert.equal(JSON.parse(DB.shop.get("shivan_shop_products"))[0].id, productId, "a failed D1 write must not replace the previous product list");

const bootstrap = await context(new Request("https://shop.test/api/bootstrap"));
assert.equal(bootstrap.status, 200);
const bootstrapData = await bootstrap.json();
assert.equal(Object.keys(bootstrapData.shop).some(key => key.startsWith("media:")), false, "image bytes should not be sent in bootstrap data");

const oversized = new Uint8Array(1_300_001);
oversized.set(imageBytes);
const tooLarge = await context(new Request("https://shop.test/api/media/upload", {
  method: "POST",
  headers: { Origin: "https://shop.test", "Content-Type": "image/webp", Cookie: cookie },
  body: oversized,
}));
assert.equal(tooLarge.status, 413, "uploads above the shared image-size limit should be rejected");

const unauthenticated = await context(new Request("https://shop.test/api/media/upload", {
  method: "POST",
  headers: { Origin: "https://shop.test", "Content-Type": "image/webp" },
  body: imageBytes,
}));
assert.equal(unauthenticated.status, 401, "shop-image uploads must require a signed-in account");

const signup = await context(new Request("https://shop.test/api/auth/signup", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "Customer", identifier: "customer@example.test", password: "customer-password" }),
}));
assert.equal(signup.status, 201, "customer sign-up should work with the shared account API");
const customerCookie = signup.headers.get("Set-Cookie").split(";")[0];
const customerAccount = [...DB.accounts.values()].find(account => account.identifier === "customer@example.test");
assert.ok(customerAccount, "the simulated customer account should exist for offline checkout tests");
const customerOrderForAuthorization = { id: "customer-status-owner-only-test", userId: customerAccount.id, status: "لە چاوەڕوانی", total: 1000, items: [] };
DB.orders.set(customerOrderForAuthorization.id, { account_id: customerAccount.id, payload: JSON.stringify(customerOrderForAuthorization) });
const customerOrderStatusBefore = DB.orders.get(customerOrderForAuthorization.id).payload;
const customerOrderAdvance = await nextOrderRequest(customerOrderForAuthorization.id, "لە چاوەڕوانی", customerCookie);
assert.equal(customerOrderAdvance.status, 403, "a signed-in customer cannot use the Owner-only order status API");
assert.equal(DB.orders.get(customerOrderForAuthorization.id).payload, customerOrderStatusBefore, "unauthorized customer requests do not alter order data");
const orderProductBeforeDiscount = JSON.parse(DB.shop.get("shivan_shop_products"))[0];
const orderProductWithDiscount = { ...orderProductBeforeDiscount, discount: 30 };
const saveOrderDiscount = await context(new Request("https://shop.test/api/sync", {
  method: "PUT", headers: { "Content-Type": "application/json", Cookie: cookie },
  body: JSON.stringify({ key: "shivan_shop_products", value: JSON.stringify([orderProductWithDiscount]) }),
}));
assert.equal(saveOrderDiscount.status, 200, "the Owner should be able to save the active discount used by checkout");
const apiDiscountProduct = JSON.parse(DB.shop.get("shivan_shop_products"))[0];
assert.ok(apiDiscountProduct.variants.some(variant => variant.size === "M" && variant.color.toLowerCase() === "#ff0000" && variant.stock >= 2), `the offline FIB fixture must retain the available M/red variant (${JSON.stringify(apiDiscountProduct.variants)})`);

const originalFetch = globalThis.fetch;
const fibRequests = [];
try {
  env.FIB_CLIENT_ID = "offline-test-client-id";
  env.FIB_CLIENT_SECRET = "offline-test-client-secret";
  globalThis.fetch = async (url, options = {}) => {
    fibRequests.push({ url: String(url), options });
    if (String(url).includes("/auth/realms/fib-online-shop/")) return new Response(JSON.stringify({ access_token: "offline-test-access-token" }), { status: 200 });
    if (String(url).includes("/protected/v1/payments")) return new Response(JSON.stringify({
      paymentId: "offline-discount-payment", personalAppLink: "https://fib.iq/pay/offline-test", status: "UNPAID", validUntil: "2030-01-01T00:00:00Z",
    }), { status: 201 });
    throw new Error("Unexpected external request in offline discount test.");
  };
  const fibPayment = await context(new Request("https://shop.test/api/fib/create-payment", {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: customerCookie },
    body: JSON.stringify({ orderId: "Sdiscount-payment-regression-001", items: [{ productId, size: "M", color: "#ff0000", qty: 2 }] }),
  }));
  const fibPaymentData = await fibPayment.json();
  assert.equal(fibPayment.status, 200, `the simulated FIB payment request should use the saved discounted product price (${JSON.stringify(fibPaymentData)})`);
  assert.equal(fibPaymentData.amount, 18900, "FIB payment amount should use 30% off 13,500 IQD for two units");
  assert.equal(JSON.parse(fibRequests[1].options.body).monetaryValue.amount, "18900", "the provider payload should contain the server-calculated discounted amount");
} finally {
  globalThis.fetch = originalFetch;
  delete env.FIB_CLIENT_ID;
  delete env.FIB_CLIENT_SECRET;
}

const discountedOrderId = "Sdiscount-order-regression-001";
const spoofedOrder = {
  id: discountedOrderId, userId: customerAccount.id, date: "offline test", total: 1, paymentMethod: "cash", receiptImage: "",
  name: "Test Customer", phone: "000", city: "Test City", area: "Test Area", address: "Offline only", status: "pending",
  items: [{ productId, size: "M", color: "#ff0000", qty: 1, price: 1, originalPrice: 999999, discount: 99 }],
};
const discountedOrderResponse = await context(new Request("https://shop.test/api/sync", {
  method: "PUT", headers: { "Content-Type": "application/json", Cookie: customerCookie },
  body: JSON.stringify({ key: "shivan_shop_orders", value: JSON.stringify([spoofedOrder]) }),
}));
const discountedOrderResponseData = await discountedOrderResponse.json();
assert.equal(discountedOrderResponse.status, 200, `the customer order should save with a server-confirmed discount total (${JSON.stringify(discountedOrderResponseData)})`);
const trustedOrder = JSON.parse(DB.orders.get(discountedOrderId).payload);
assert.equal(trustedOrder.total, 9450, "the server should calculate the 30% discounted order total from shared D1 product data");
assert.equal(trustedOrder.items[0].price, 9450, "the saved order item should use the final discounted unit price");
assert.equal(trustedOrder.items[0].originalPrice, 13500, "the saved order should retain the original unit price for reference");
assert.equal(trustedOrder.items[0].discount, 30, "the saved order should retain the verified discount percentage");
const orderReload = await context(new Request("https://shop.test/api/sync", { headers: { Cookie: customerCookie } }));
assert.equal(orderReload.status, 200);
const reloadedOrders = JSON.parse((await orderReload.json()).user.shivan_shop_orders);
assert.equal(reloadedOrders.find(order => order.id === discountedOrderId).total, 9450, "the discounted order total should survive refresh from shared D1");

const customerLogin = await context(new Request("https://shop.test/api/auth/login", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ identifier: "customer@example.test", password: "customer-password" }),
}));
assert.equal(customerLogin.status, 200, "a newly created customer account should be able to sign in");
const customerLoginCookie = customerLogin.headers.get("Set-Cookie").split(";")[0];
const passwordChange = await context(new Request("https://shop.test/api/auth/password", {
  method: "POST", headers: { "Content-Type": "application/json", Cookie: customerLoginCookie },
  body: JSON.stringify({ oldPassword: "customer-password", newPassword: "updated-customer-password" }),
}));
assert.equal(passwordChange.status, 200, "a signed-in customer should be able to change their password");
const changedPasswordLogin = await context(new Request("https://shop.test/api/auth/login", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ identifier: "customer@example.test", password: "updated-customer-password" }),
}));
assert.equal(changedPasswordLogin.status, 200, "a password change should persist to the shared account database");
const customerLogout = await context(new Request("https://shop.test/api/auth/logout", { method: "POST", headers: { Cookie: customerLoginCookie } }));
assert.equal(customerLogout.status, 200, "sign-out should revoke the shared session");
const loggedOutMe = await context(new Request("https://shop.test/api/auth/me", { headers: { Cookie: customerLoginCookie } }));
assert.equal((await loggedOutMe.json()).account, null, "a logged-out session must no longer authenticate");
const customerUpload = await context(new Request("https://shop.test/api/media/upload", {
  method: "POST",
  headers: { Origin: "https://shop.test", "Content-Type": "image/webp", Cookie: customerCookie },
  body: imageBytes,
}));
assert.equal(customerUpload.status, 403, "a customer account must not upload owner catalog images");

const customerShopWrite = await context(new Request("https://shop.test/api/sync", {
  method: "PUT",
  headers: { "Content-Type": "application/json", Cookie: customerCookie, "X-Client-Request-ID": "customer-product-save-001" },
  body: JSON.stringify({ key: "shivan_shop_products", value: "[]" }),
}));
assert.equal(customerShopWrite.status, 403, "a customer account must not edit shared shop data");
const customerShopWriteData = await customerShopWrite.json();
assert.equal(customerShopWriteData.code, "OWNER_REQUIRED", "the auth rejection should have a safe diagnostic code");
assert.equal(customerShopWriteData.requestId, "customer-product-save-001", "the auth rejection should preserve its correlation ID");
const deniedProductDelete = await context(new Request("https://shop.test/api/sync?key=shivan_shop_products", {
  method: "DELETE", headers: { Cookie: customerCookie },
}));
assert.equal(deniedProductDelete.status, 403, "customers must not delete the shared product catalog");
assert.equal(JSON.parse(DB.shop.get("shivan_shop_products"))[0].id, productId, "a denied delete must preserve the shared product list");
const productDelete = await context(new Request("https://shop.test/api/sync", {
  method: "PUT", headers: { "Content-Type": "application/json", Cookie: cookie },
  body: JSON.stringify({ key: "shivan_shop_products", value: "[]" }),
}));
assert.equal(productDelete.status, 200, "an owner product deletion should be confirmed by the API");
assert.equal((await productDelete.json()).persisted, true, "product deletion should be acknowledged as persisted");
assert.equal(JSON.parse(DB.shop.get("shivan_shop_products")).length, 0, "the owner product deletion should persist the updated catalog");

const unauthenticatedProductWrite = await context(new Request("https://shop.test/api/sync", {
  method: "PUT",
  headers: { "Content-Type": "application/json", "X-Client-Request-ID": "unauth-product-save-001" },
  body: JSON.stringify({ key: "shivan_shop_products", value: "[]" }),
}));
assert.equal(unauthenticatedProductWrite.status, 401, "product sync must still require an authenticated account");
assert.equal((await unauthenticatedProductWrite.json()).code, "AUTH_REQUIRED", "the unauthenticated response should identify the auth stage safely");

// Verify that source photos are resized before crop preview creation, and that
// a failed preparation returns control to the image picker and Save button.
let requestedBitmapOptions;
let previewCanvasSize;
let previewDrawSource;
let createdPreviewUrl = "";
let revokedPreviewUrl = "";
const resizedTestBitmap = { width: 2048, height: 1536, closed: false, close() { this.closed = true; } };
const testPngHeader = new Uint8Array(24);
testPngHeader.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
testPngHeader[16] = 0; testPngHeader[17] = 0; testPngHeader[18] = 0x0f; testPngHeader[19] = 0xa0;
testPngHeader[20] = 0; testPngHeader[21] = 0; testPngHeader[22] = 0x0b; testPngHeader[23] = 0xb8;
const resizeSandbox = {
  Blob,
  setTimeout,
  clearTimeout,
  URL: {
    createObjectURL(blob) { assert.equal(blob.type, "image/webp"); createdPreviewUrl = "blob:bounded-preview"; return createdPreviewUrl; },
    revokeObjectURL(url) { revokedPreviewUrl = url; },
  },
  MAX_OWNER_IMAGE_INPUT_BYTES: 15 * 1024 * 1024,
  MAX_CROP_SOURCE_EDGE: 2048,
  MAX_CROP_SOURCE_PIXELS: 4_194_304,
  MAX_CROP_PREVIEW_EDGE: 1200,
  async createImageBitmap(file, options) { requestedBitmapOptions = options; return resizedTestBitmap; },
  document: {
    createElement(tag) {
      assert.equal(tag, "canvas");
      const canvas = { _width: 0, _height: 0, getContext: () => ({ drawImage(source) { previewDrawSource = source; } }), toBlob(callback, type) { callback(new Blob(["preview"], { type })); } };
      Object.defineProperties(canvas, {
        width: { get: () => canvas._width, set: value => { previewCanvasSize = previewCanvasSize || {}; previewCanvasSize.width = value; canvas._width = value; } },
        height: { get: () => canvas._height, set: value => { previewCanvasSize = previewCanvasSize || {}; previewCanvasSize.height = value; canvas._height = value; } },
      });
      return canvas;
    },
  },
};
const prepareResizeCode = `${canvasBlobSource}\n${readOwnerImageDimensionsSource}\n${prepareOwnerCropSourceSource}\nprepareOwnerCropSource({ size: 8 * 1024 * 1024, slice: () => ({ arrayBuffer: async () => testPngHeader.buffer }) })`;
const preparedCropSource = await runInNewContext(prepareResizeCode, { ...resizeSandbox, testPngHeader });
assert.equal(requestedBitmapOptions.resizeWidth, 2048, "the browser decoder must bound the source width before crop preview creation");
assert.equal(requestedBitmapOptions.resizeHeight, undefined, "the browser decoder must leave the other axis proportional to avoid distortion");
assert.equal(requestedBitmapOptions.resizeQuality, "high", "the browser decoder should use high-quality downsampling");
assert.equal(previewDrawSource, resizedTestBitmap, "the preview must be drawn only from the bounded bitmap");
assert.equal(previewCanvasSize.width, 0, "the temporary preview canvas width must be released after encoding");
assert.equal(previewCanvasSize.height, 0, "the temporary preview canvas height must be released after encoding");
assert.equal(preparedCropSource.width, 2048);
assert.equal(preparedCropSource.height, 1536);
assert.equal(preparedCropSource.objectUrl, createdPreviewUrl);
const releaseCropSource = runInNewContext(`${releasePreparedCropSourceSource}\nreleasePreparedCropSource`, resizeSandbox);
releaseCropSource(preparedCropSource);
assert.equal(resizedTestBitmap.closed, true, "closing a crop should release its decoded bitmap");
assert.equal(revokedPreviewUrl, createdPreviewUrl, "closing a crop should revoke the preview URL");

const portraitPngHeader = new Uint8Array(24);
portraitPngHeader.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
portraitPngHeader[16] = 0; portraitPngHeader[17] = 0; portraitPngHeader[18] = 0x0b; portraitPngHeader[19] = 0xd8;
portraitPngHeader[20] = 0; portraitPngHeader[21] = 0; portraitPngHeader[22] = 0x0f; portraitPngHeader[23] = 0xa0;
const portraitBitmap = { width: 1536, height: 2048, close() {} };
requestedBitmapOptions = null;
const portraitPrepared = await runInNewContext(`${canvasBlobSource}\n${readOwnerImageDimensionsSource}\n${prepareOwnerCropSourceSource}\nprepareOwnerCropSource({ size: 8 * 1024 * 1024, slice: () => ({ arrayBuffer: async () => portraitPngHeader.buffer }) })`, {
  ...resizeSandbox,
  portraitPngHeader,
  async createImageBitmap(file, options) { requestedBitmapOptions = options; return portraitBitmap; },
});
assert.equal(requestedBitmapOptions.resizeHeight, 2048, "portrait photos must be resized by height while preserving their aspect ratio");
assert.equal(requestedBitmapOptions.resizeWidth, undefined, "portrait downsampling must not stretch the width");
assert.equal(portraitPrepared.width, 1536);
assert.equal(portraitPrepared.height, 2048);

let oversizedPhotoDecoded = false;
let oversizedPhotoError = "";
try {
  await runInNewContext(`${canvasBlobSource}\n${readOwnerImageDimensionsSource}\n${prepareOwnerCropSourceSource}\nprepareOwnerCropSource({ size: 15 * 1024 * 1024 + 1 })`, {
    ...resizeSandbox,
    async createImageBitmap() { oversizedPhotoDecoded = true; throw new Error("should not decode"); },
  });
} catch (error) { oversizedPhotoError = error.message; }
assert.equal(oversizedPhotoDecoded, false, "oversized files must be rejected before image decoding");
assert.match(oversizedPhotoError, /smaller than 15 MB/);

const failedPrepareInput = { disabled: true, value: "selected-image" };
const failedPrepareSubmit = { disabled: true };
let failedPrepareToast = "";
await runInNewContext(`${openOwnerImageCropSource}\nopenOwnerImageCrop({}, { input, submit })`, {
  prepareOwnerCropSource: async () => { throw new Error("Photo processing failed safely"); },
  showToast: message => { failedPrepareToast = message; },
  releaseCropForm: state => { state.input.disabled = false; state.input.value = ""; state.submit.disabled = false; },
  ownerProductImageQueue: null,
  startNextQueuedProductImage() {},
  input: failedPrepareInput,
  submit: failedPrepareSubmit,
});
assert.equal(failedPrepareInput.disabled, false, "failed image preparation must unlock the image picker");
assert.equal(failedPrepareSubmit.disabled, false, "failed image preparation must keep product Save usable");
assert.match(failedPrepareToast, /Photo processing failed safely/);

// Exercise the browser's actual crop callback and product form against an
// isolated in-memory D1. The first product write fails, then the same draft is
// retried successfully without adding a duplicate product.
const uiDB = new MemoryD1();
const uiEnv = { DB: uiDB, MEDIA: new MemoryR2(), OWNER_SETUP_TOKEN: "test-only-ui-owner-code" };
const uiContext = request => onRequest({ request, env: uiEnv });
const uiOwnerSetup = await uiContext(new Request("https://shop.test/api/auth/setup-owner", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ setupToken: uiEnv.OWNER_SETUP_TOKEN, name: "Owner", identifier: "07502342153", password: "long-test-password" }),
}));
assert.equal(uiOwnerSetup.status, 201);
const uiCookie = uiOwnerSetup.headers.get("Set-Cookie").split(";")[0];
const uiOwnerAccount = (await uiOwnerSetup.json()).account;
const uiRequestId = "owner-crop-flow-regression-001";
const cropTarget = { value: "[]" };
const cropColor = { value: "#ff0000" };
const cropCancelButton = { disabled: false, dataset: { cropAction: "cancel" } };
const cropApplyButton = { disabled: false, dataset: { cropAction: "apply" } };
const cropButtons = [cropCancelButton, cropApplyButton];
const cropSubmitButton = { disabled: true };
const cropInput = { disabled: true, value: "selected-image" };
const cropQueue = { files: [{}], index: 0, input: cropInput, submit: cropSubmitButton, colors: ["#ff0000"], requestId: uiRequestId };
const cropImage = { naturalWidth: 40, naturalHeight: 50, style: {} };
const cropViewport = { clientWidth: 40, clientHeight: 50 };
const cropModal = { classList: { add() {}, remove() {} }, setAttribute() {} };
const compressedCropBlob = new Blob([imageBytes], { type: "image/webp" });
let cropDrawSource = null;
let cropDrawArgs = null;
let cropBitmapClosed = false;
let cropEncodeAttempts = 0;
const cropObjectUrlsRevoked = [];
const cropSourceBitmap = { width: 80, height: 100, close() { cropBitmapClosed = true; } };
const cropStatus = { textContent: "" };
const cropElements = new Map([
  ["cropViewport", cropViewport], ["cropImage", cropImage], ["imageCropModal", cropModal],
  ["ownerProductImagesData", cropTarget], ["cropImageColor", cropColor], ["cropStatus", cropStatus],
]);
let cropToast = "";
let pendingImageCrop = {
  scale: 1, left: 0, top: 0, ratio: 0.8, ratioMode: "0.8", kind: "product", queue: true, requestId: uiRequestId,
  bitmap: cropSourceBitmap, objectUrl: "blob:crop-source",
};
let ownerProductImageQueue = cropQueue;
const cropSandbox = {
  Blob,
  URL: { revokeObjectURL: url => cropObjectUrlsRevoked.push(url) },
  document: {
    querySelectorAll: selector => selector.includes("#imageCropModal button") ? (selector.includes(":not(") ? [cropApplyButton] : cropButtons) : [],
    getElementById: id => cropElements.get(id) || null,
    createElement: tag => tag === "canvas" ? {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage(...args) { cropDrawArgs = args; cropDrawSource = args[0]; } }),
      toBlob: (callback, type) => {
        cropEncodeAttempts++;
        const blob = cropEncodeAttempts <= 2 ? new Blob([new Uint8Array(1_300_001)], { type }) : new Blob([imageBytes], { type });
        callback(blob);
      },
    } : {},
  },
  MAX_CLOUD_IMAGE_BYTES: 1_300_000,
  pendingImageCrop,
  ownerProductImageQueue,
  canvasBlob: (canvas, type, quality) => new Promise(resolve => canvas.toBlob(resolve, type, quality)),
  uploadOwnerImageToCloud: async (blob, requestId) => {
    assert.equal(cropApplyButton.disabled, true, "Crop and save should lock while its operation is active");
    assert.equal(cropCancelButton.disabled, false, "Cancel must remain tappable while crop processing or upload is active");
    const response = await uiContext(new Request("https://shop.test/api/media/upload", {
      method: "POST",
      headers: { Origin: "https://shop.test", "Content-Type": blob.type, Cookie: uiCookie, "X-Client-Request-ID": requestId },
      body: blob,
    }));
    const data = await response.json();
    assert.equal(response.status, 201, "cropped image upload should be persisted before the product save");
    assert.equal(data.persisted, true);
    return data.url;
  },
  readOwnerProductPhotos: () => JSON.parse(cropTarget.value),
  normalizeHexColor: value => String(value || ""),
  renderOwnerProductPhotoList() {},
  closeImageCrop() { cropSourceBitmap.close(); cropObjectUrlsRevoked.push("blob:crop-source"); pendingImageCrop = null; cropSandbox.pendingImageCrop = null; },
  releaseCropForm(state) { if (state?.input) state.input.disabled = false; if (state?.submit) state.submit.disabled = false; },
  startNextQueuedProductImage() {
    ownerProductImageQueue.index++;
    if (ownerProductImageQueue.index >= ownerProductImageQueue.files.length) {
      cropSandbox.releaseCropForm(ownerProductImageQueue);
      ownerProductImageQueue = null;
      cropSandbox.ownerProductImageQueue = null;
    }
  },
  ownerSaveDiagnostic() {},
  ownerSaveDiagnosticCode: () => "TEST_FAILURE",
  showToast: message => { cropToast = message; },
};
await runInNewContext(`${setImageCropBusySource}\n${finishImageCropSource}\nfinishImageCrop(true)`, cropSandbox);
const croppedPhotos = JSON.parse(cropTarget.value);
assert.equal(croppedPhotos.length, 1, "the completed crop should be attached to the product form");
assert.match(croppedPhotos[0].src, /^\/api\/media\/shop\//);
assert.equal(croppedPhotos[0].color, "#ff0000");
assert.equal(cropDrawSource, cropSourceBitmap, "final crop rendering should use the bounded bitmap rather than the preview image");
assert.equal(cropDrawArgs[3], 80, "crop coordinates should map from the smaller preview back to the resized source width");
assert.equal(cropDrawArgs[4], 100, "crop coordinates should map from the smaller preview back to the resized source height");
assert.equal(cropBitmapClosed, true, "successful crop should release its decoded image resources");
assert.deepEqual(cropObjectUrlsRevoked, ["blob:crop-source"], "successful crop should release its temporary preview URL");
assert.equal(cropSubmitButton.disabled, false, "the crop flow should re-enable the Owner form after upload");
assert.equal(cropToast, "", "successful cropping should not leave the image flow in an error state");
assert.equal(cropEncodeAttempts, 3, "crop compression should finish after three tries instead of looping through many quality levels");

const failedCropCancelButton = { disabled: false, dataset: { cropAction: "cancel" } };
const failedCropApplyButton = { disabled: false, dataset: { cropAction: "apply" } };
const failedCropButtons = [failedCropCancelButton, failedCropApplyButton];
const failedCropSubmit = { disabled: true };
const failedCropState = { scale: 1, left: 0, top: 0, ratio: 0.8, ratioMode: "0.8", kind: "product", queue: true, requestId: uiRequestId, uploading: false };
const failedCropSandbox = {
  ...cropSandbox,
  pendingImageCrop: failedCropState,
  ownerProductImageQueue: { files: [{}], index: 0, input: { disabled: true }, submit: failedCropSubmit, colors: ["#ff0000"], requestId: uiRequestId },
  showToast: message => { cropToast = message; },
  uploadOwnerImageToCloud: async () => { const error = new Error("Simulated image-service failure"); error.status = 503; throw error; },
  document: {
    ...cropSandbox.document,
    querySelectorAll: selector => selector.includes("#imageCropModal button") ? (selector.includes(":not(") ? [failedCropApplyButton] : failedCropButtons) : [],
    createElement: tag => tag === "canvas" ? { width: 0, height: 0, getContext: () => ({ drawImage() {} }), toBlob: callback => callback(compressedCropBlob) } : {},
  },
};
cropToast = "";
await runInNewContext(`${setImageCropBusySource}\n${finishImageCropSource}\nfinishImageCrop(true)`, failedCropSandbox);
assert.equal(failedCropState.uploading, false, "a failed cropped-image upload should clear the busy state");
assert.equal(failedCropButtons.every(button => !button.disabled), true, "crop controls should remain usable after a failed upload");
assert.equal(failedCropSubmit.disabled, false, "the product form should remain responsive after a failed upload");
assert.match(cropToast, /Simulated image-service failure/, "the user should see an actionable upload error");

const cancelTarget = { value: "[]" };
const cancelInput = { disabled: true, value: "selected-image" };
const cancelSubmit = { disabled: true };
const cancelQueue = { files: [{}], index: 0, input: cancelInput, submit: cancelSubmit };
let cancelAbortCount = 0;
let cancelCloseCount = 0;
let cancelCropStatus = "";
let cancelImageUploadCount = 0;
const busyCropState = {
  queue: true,
  uploading: true,
  cancelled: false,
  requestId: uiRequestId,
  abortController: { abort() { cancelAbortCount++; } },
};
const cancelSandbox = {
  pendingImageCrop: busyCropState,
  ownerProductImageQueue: cancelQueue,
  document: { querySelectorAll: () => [], getElementById: () => null },
  setImageCropBusy() {},
  closeImageCrop() { cancelCloseCount++; },
  releaseCropForm(state) { state.input.disabled = false; state.input.value = ""; state.submit.disabled = false; },
  setOwnerImageStatus: message => { cancelCropStatus = message; },
  showToast() {},
  uploadOwnerImageToCloud: async () => { cancelImageUploadCount++; return "/api/media/shop/unused"; },
};
await runInNewContext(`${finishImageCropSource}\nfinishImageCrop(false)`, cancelSandbox);
assert.equal(busyCropState.cancelled, true, "Cancel must clear the crop operation even after Crop and save has started");
assert.equal(cancelAbortCount, 1, "Cancel must abort pending compression or upload work");
assert.equal(cancelCloseCount, 1, "Cancel must close the crop modal");
assert.equal(cancelSandbox.ownerProductImageQueue, null, "Cancel must discard the queued image selection");
assert.equal(cancelInput.disabled, false, "Cancel must unlock the image picker");
assert.equal(cancelSubmit.disabled, false, "Cancel must keep the Owner form usable");
assert.equal(cancelTarget.value, "[]", "Cancel must not attach or save a cropped image");
assert.equal(cancelImageUploadCount, 0, "Cancel must not start a new image upload");
assert.match(cancelCropStatus, /canceled/i, "Cancel must report that the selection was discarded");

const timeoutApplyButton = { disabled: false, dataset: { cropAction: "apply" } };
const timeoutCancelButton = { disabled: false, dataset: { cropAction: "cancel" } };
const timeoutCropStatus = { textContent: "" };
const timeoutSubmitButton = { disabled: true };
const timeoutInput = { disabled: true, value: "selected-image" };
const timeoutCropModal = { classList: { remove() {} }, setAttribute() {} };
const timeoutCropImage = { naturalWidth: 40, naturalHeight: 50, onload: null, onerror: null, removeAttribute() {}, style: {} };
const timeoutElements = new Map([
  ["cropViewport", { clientWidth: 40, clientHeight: 50 }],
  ["cropImage", timeoutCropImage],
  ["imageCropModal", timeoutCropModal],
  ["cropStatus", timeoutCropStatus],
]);
const timeoutCropState = { scale: 1, left: 0, top: 0, ratio: 0.8, queue: false, uploading: false, input: timeoutInput, submit: timeoutSubmitButton, hiddenId: "cropImageValue", previewId: "cropPreview" };
let timeoutCropToast = "";
let timeoutCropUploads = 0;
const timeoutCropSandbox = {
  AbortController,
  URL: { revokeObjectURL() {} },
  pendingImageCrop: timeoutCropState,
  ownerProductImageQueue: null,
  MAX_CLOUD_IMAGE_BYTES: 1_300_000,
  document: {
    querySelectorAll: selector => selector.includes(":not(") ? [timeoutApplyButton] : selector.includes("#imageCropModal button") ? [timeoutApplyButton, timeoutCancelButton] : [],
    getElementById: id => timeoutElements.get(id) || (id === "cropImageValue" ? { value: "" } : id === "cropPreview" ? { src: "", classList: { add() {} } } : null),
    createElement: tag => tag === "canvas" ? { width: 0, height: 0, getContext: () => ({ drawImage() {} }), toBlob() {} } : {},
  },
  setTimeout,
  clearTimeout,
  ownerSaveDiagnostic() {},
  ownerSaveDiagnosticCode: () => "COMPRESSION_TIMEOUT",
  uploadOwnerImageToCloud: async () => { timeoutCropUploads++; return "/api/media/shop/unused"; },
  releaseCropForm(state) { state.input.disabled = false; state.submit.disabled = false; },
  showToast: message => { timeoutCropToast = message; },
};
const timeoutFinishSource = canvasBlobSource.replace("timeoutMs=15000", "timeoutMs=5");
await runInNewContext(`${setImageCropBusySource}\n${timeoutFinishSource}\n${releasePreparedCropSourceSource}\n${closeImageCropSource}\n${finishImageCropSource}\nfinishImageCrop(true)`, timeoutCropSandbox);
assert.equal(timeoutCropState.uploading, false, "a stalled canvas encoder must release the crop busy state");
assert.equal(timeoutApplyButton.disabled, false, "Crop and save must become available after an encoding timeout");
assert.equal(timeoutCancelButton.disabled, false, "Cancel must stay available after an encoding timeout");
assert.match(timeoutCropStatus.textContent, /Photo compression took too long/, "the crop modal must show a clear encoding timeout");
assert.match(timeoutCropToast, /Photo compression took too long/, "the user must receive the crop failure message");
assert.equal(timeoutSubmitButton.disabled, false, "the Owner product form must unlock after a crop timeout");
assert.equal(timeoutCropUploads, 0, "a failed crop must not upload or attach an image");

const productForm = { dataset: { saving: "false" }, querySelector: () => productSubmitButton };
const productSubmitButton = { disabled: false };
const productFields = new Map([
  ["ownerProductNameEn", { value: "Test crop jacket" }],
  ["ownerProductNameAr", { value: "سترة اختبار" }],
  ["ownerProductNameKu", { value: "کراسێ تاقیکردنەوە" }],
  ["ownerProductPrice", { value: "12000" }],
  ["ownerProductDiscount", { value: "30" }],
  ["ownerProductDiscountTimerEnabled", { checked: true }],
  ["ownerProductDiscountEndsAt", { value: "2030-01-02T03:04" }],
  ["ownerProductImagesData", cropTarget],
  ["ownerProductCategory", { value: "جلوبەرگ" }],
  ["ownerProductSizes", { value: "M" }],
  ["ownerProductColors", { value: "Red:#ff0000" }],
  ["ownerProductDescription", { value: "Local regression test product" }],
]);
const localShopStorage = new Map();
const productToasts = [];
const productApiResults = [];
const testEvent = { currentTarget: productForm, preventDefault() {} };
const productSandbox = {
  AbortController,
  Blob,
  Headers,
  Request,
  Response,
  TextEncoder,
  URL,
  crypto: webcrypto,
  location: { href: "https://shop.test/" },
  cloudMode: true,
  cloudAccount: uiOwnerAccount,
  cloudWriteFailureNoticeShown: false,
  ownerProductWorkflowId: uiRequestId,
  ownerProductMode: "form",
  ownerPanel: "products",
  editingProductId: null,
  ownerInventoryDraft: new Map(),
  MAX_OWNER_PRODUCT_VARIANTS: 120,
  PRODUCTS_KEY: "shivan_shop_products",
  CLOUD_OWNER_KEYS: new Set(["shivan_shop_products"]),
  products: [],
  testEvent,
  document: { getElementById: id => productFields.get(id) || null },
  localStorage: {
    getItem: key => localShopStorage.has(key) ? localShopStorage.get(key) : null,
    setItem: (key, value) => localShopStorage.set(key, String(value)),
  },
  readCloudOutbox: () => ({}),
  flushCloudWrites: async () => false,
  saveCloudOutbox: () => true,
  createOwnerSaveRequestId: () => uiRequestId,
  ownerSaveDiagnostic() {},
  ownerSaveDiagnosticCode: error => error?.code || "REQUEST_FAILED",
  ownerDiscountTimerEndIso: () => "2030-01-02T03:04:00.000Z",
  isOwner: () => true,
  readOwnerProductPhotos: () => JSON.parse(cropTarget.value),
  safeImageUrl: value => /^\/api\/media\/shop\//.test(String(value || "")) ? String(value) : "",
  parseOwnerColorEntries: () => [{ name: "Red", value: "#ff0000" }],
  renderOwnerInventoryMatrix() { throw new Error("product Save must not rebuild the inventory table"); },
  readOwnerInventoryDraft: () => new Map([[JSON.stringify(["#ff0000", "M"]), "3"]]),
  saveProducts() { localShopStorage.set("shivan_shop_products", JSON.stringify(productSandbox.products)); return true; },
  createOwnerProductId: () => 20261012001,
  renderCategoryButtons() {},
  renderProducts() {},
  renderOwnerPanel() {},
  scrollOwnerTo() {},
  showToast: message => productToasts.push(message),
  setTimeout,
  clearTimeout,
  console: { info() {} },
  fetch: async (path, options = {}) => {
    const url = new URL(path, "https://shop.test/");
    const method = String(options.method || "GET").toUpperCase();
    const headers = new Headers(options.headers || {});
    headers.set("Cookie", uiCookie);
    if (method !== "GET") headers.set("Origin", "https://shop.test");
    const request = new Request(url, { method, headers, ...(method === "GET" ? {} : { body: options.body }) });
    const response = await uiContext(request);
    if (url.pathname === "/api/sync" && method === "PUT") productApiResults.push({ status: response.status, data: await response.clone().json() });
    return response;
  },
};
uiDB.failNextProductWrite = true;
await runInNewContext(`${cloudRequestSource}\n${clearAcknowledgedCloudWriteSource}\n${persistOwnerShopValueSource}\n${confirmCloudShopWritesSource}\n${confirmCloudShopWriteSource}\n${productSaveSource}\nsaveOwnerProduct(testEvent)`, productSandbox);
assert.equal(productApiResults[0]?.status, 503, "the simulated production-like D1 failure should reach the product API");
assert.equal(productApiResults[0]?.data.code, "D1_WRITE_FAILED", "the save API should return a safe real failure code");
assert.equal(productApiResults[0]?.data.requestId, uiRequestId, "the API failure should be correlated to the crop and product workflow");
assert.equal(productSubmitButton.disabled, false, "a failed shared save must leave the Owner Save button usable");
assert.equal(productForm.dataset.saving, "false", "a failed shared save must clear the form busy state");
assert.equal(productSandbox.ownerProductMode, "form", "a failed shared save must keep the Owner form open");
assert.equal(productSandbox.editingProductId, 20261012001, "a retry must retain the pending product ID");
assert.equal(productSandbox.products.length, 1, "a failed save should retain one local retry draft");

await runInNewContext(`${cloudRequestSource}\n${clearAcknowledgedCloudWriteSource}\n${persistOwnerShopValueSource}\n${confirmCloudShopWritesSource}\n${confirmCloudShopWriteSource}\n${productSaveSource}\nsaveOwnerProduct(testEvent)`, productSandbox);
assert.equal(productApiResults[1]?.status, 200, "retrying the same form should persist the product through the shared API");
assert.equal(productApiResults[1]?.data.persisted, true);
assert.equal(productSubmitButton.disabled, false, "the Save button should remain responsive after retry success");
assert.equal(productSandbox.products.length, 1, "retrying a failed save must not duplicate the product");
const uiStoredProducts = JSON.parse(uiDB.shop.get("shivan_shop_products"));
assert.equal(uiStoredProducts.length, 1);
assert.equal(uiStoredProducts[0].id, 20261012001);
assert.equal(uiStoredProducts[0].price, 12000, "the Owner form should save the entered product price");
assert.equal(uiStoredProducts[0].discount, 30, "the Owner form should save the optional discount percentage");
assert.equal(uiStoredProducts[0].discountTimerEnabled, true, "the Owner form should persist the limited-time toggle in the shared product record");
assert.equal(uiStoredProducts[0].discountEndsAt, "2030-01-02T03:04:00.000Z", "the exact Owner-selected end time should persist through the shared API");
const invalidTimerProduct = { ...uiStoredProducts[0], discountEndsAt: "not a date" };
const invalidTimerResponse = await uiContext(new Request("https://shop.test/api/sync", {
  method: "PUT",
  headers: { "Content-Type": "application/json", Cookie: uiCookie, Origin: "https://shop.test" },
  body: JSON.stringify({ key: "shivan_shop_products", value: JSON.stringify([invalidTimerProduct]) }),
}));
assert.equal(invalidTimerResponse.status, 400, "the shared product API must reject an invalid countdown even if a client sends it directly");
assert.equal((await invalidTimerResponse.json()).code, "INVALID_PRODUCT_DISCOUNT_TIMER");
assert.deepEqual(uiStoredProducts[0].sizes, ["M"], "the Owner form should save selected sizes");
assert.deepEqual(uiStoredProducts[0].colors, ["#ff0000"], "the Owner form should save selected colors");
assert.equal(uiStoredProducts[0].variants[0].stock, 3, "the Owner form should save the stock quantity");
assert.equal(uiStoredProducts[0].category, "جلوبەرگ", "the Owner form should save the selected category");
assert.equal(uiStoredProducts[0].images[0].src, croppedPhotos[0].src, "the cropped image URL should be stored with the product");
const uiReload = await uiContext(new Request("https://shop.test/api/sync", { headers: { Cookie: uiCookie } }));
assert.equal(JSON.parse((await uiReload.json()).shop.shivan_shop_products)[0].images[0].src, croppedPhotos[0].src, "the cropped product should survive reload through D1");
const uiSecondDevice = await uiContext(new Request("https://shop.test/api/sync"));
const uiSecondDeviceProduct = JSON.parse((await uiSecondDevice.json()).shop.shivan_shop_products)[0];
assert.equal(uiSecondDeviceProduct.price, 12000, "a second device should receive product fields saved through the Owner form");
assert.equal(uiSecondDeviceProduct.images[0].src, croppedPhotos[0].src, "a second device should receive the cropped image URL");
const uiImageReload = await uiContext(new Request(`https://shop.test${croppedPhotos[0].src}`));
assert.equal(uiImageReload.status, 200, "the cropped image should remain readable after a product reload");

productSandbox.editingProductId = 20261012001;
productSandbox.ownerProductWorkflowId = "owner-product-edit-regression-001";
productFields.get("ownerProductDiscountTimerEnabled").checked = false;
productFields.get("ownerProductPrice").value = "13500";
productFields.get("ownerProductDiscount").value = "";
productFields.get("ownerProductDescription").value = "Edited product details";
productSandbox.readOwnerInventoryDraft = () => new Map([[JSON.stringify(["#ff0000", "M"]), "4"]]);
await runInNewContext(`${cloudRequestSource}\n${clearAcknowledgedCloudWriteSource}\n${persistOwnerShopValueSource}\n${confirmCloudShopWritesSource}\n${confirmCloudShopWriteSource}\n${productSaveSource}\nsaveOwnerProduct(testEvent)`, productSandbox);
assert.equal(productApiResults[2]?.status, 200, "editing a product in the Owner form should be acknowledged by D1");
const uiEditedProduct = JSON.parse(uiDB.shop.get("shivan_shop_products"))[0];
assert.equal(uiEditedProduct.id, 20261012001, "editing an Owner product must retain the existing ID");
assert.equal(uiEditedProduct.price, 13500, "editing an Owner product should persist its new price");
assert.equal(Object.hasOwn(uiEditedProduct, "discount"), false, "leaving the optional discount blank should remove it on edit");
assert.equal(Object.hasOwn(uiEditedProduct, "discountTimerEnabled"), false, "disabling a timed discount should remove its timer from the updated product record");
assert.equal(uiEditedProduct.stock, 4, "editing an Owner product should persist its new stock");
assert.equal(uiEditedProduct.images[0].src, croppedPhotos[0].src, "editing product details must preserve its saved crop");

const productCountBeforeInvalidDiscount = productSandbox.products.length;
const writesBeforeInvalidDiscount = productApiResults.length;
productFields.get("ownerProductDiscount").value = "100";
await runInNewContext(`${cloudRequestSource}\n${clearAcknowledgedCloudWriteSource}\n${persistOwnerShopValueSource}\n${confirmCloudShopWritesSource}\n${confirmCloudShopWriteSource}\n${productSaveSource}\nsaveOwnerProduct(testEvent)`, productSandbox);
assert.equal(productApiResults.length, writesBeforeInvalidDiscount, "the Owner form must reject an invalid percentage before calling the shared API");
assert.equal(productSandbox.products.length, productCountBeforeInvalidDiscount, "an invalid percentage must not mutate the local product list");
assert.match(productToasts.at(-1), /from 1 to 99/);
productFields.get("ownerProductDiscount").value = "";

const productCountBeforeMissingTimerDiscount = productSandbox.products.length;
const writesBeforeMissingTimerDiscount = productApiResults.length;
productFields.get("ownerProductDiscountTimerEnabled").checked = true;
await runInNewContext(`${cloudRequestSource}\n${clearAcknowledgedCloudWriteSource}\n${persistOwnerShopValueSource}\n${confirmCloudShopWritesSource}\n${confirmCloudShopWriteSource}\n${productSaveSource}\nsaveOwnerProduct(testEvent)`, productSandbox);
assert.equal(productApiResults.length, writesBeforeMissingTimerDiscount, "an enabled timer without a percentage discount must be rejected before a shared write");
assert.equal(productSandbox.products.length, productCountBeforeMissingTimerDiscount, "an invalid timed offer must not alter local product data");
assert.match(productToasts.at(-1), /limited-time discount needs a valid discount and end date\/time/i);
productFields.get("ownerProductDiscountTimerEnabled").checked = false;

const productCountBeforeLimit = productSandbox.products.length;
const apiWriteCountBeforeLimit = productApiResults.length;
productFields.get("ownerProductSizes").value = Array.from({ length: 121 }, (_, index) => `S${index}`).join(", ");
await runInNewContext(`${cloudRequestSource}\n${clearAcknowledgedCloudWriteSource}\n${persistOwnerShopValueSource}\n${confirmCloudShopWritesSource}\n${confirmCloudShopWriteSource}\n${productSaveSource}\nsaveOwnerProduct(testEvent)`, productSandbox);
assert.equal(productSandbox.products.length, productCountBeforeLimit, "an over-limit product must not alter the saved product list");
assert.equal(productApiResults.length, apiWriteCountBeforeLimit, "an over-limit product must be rejected before any cloud write");
assert.match(productToasts.at(-1), /at most 120 color and size combinations/, "an over-limit product should show a clear correction message");

console.info = originalConsoleInfo;
assert.ok(ownerSaveLogLines.some(line => line.includes("image.upload.r2_write_confirmed")), "server diagnostics should confirm successful R2 image persistence");
assert.ok(ownerSaveLogLines.some(line => line.includes("product.sync.d1_write_failed") && line.includes("D1_WRITE_FAILED")), "server diagnostics should identify failed D1 product writes by safe code");
assert.ok(ownerSaveLogLines.some(line => line.includes("product.sync.d1_write_confirmed")), "server diagnostics should confirm successful product persistence");
assert.equal(ownerSaveLogLines.join("\n").includes("long-test-password"), false, "server diagnostics must not log passwords");
assert.equal(ownerSaveLogLines.join("\n").includes("07502342153"), false, "server diagnostics must not log owner identifiers");

console.log(`Checks passed: ${inlineScripts.length} storefront script block(s), owner/customer signup/login/password-change/logout and permissions, product create/edit/delete fields, optional discount validation/preview/removal, 1/10/20/30/50/99% price calculations, discount cart snapshots and no-double-discount behavior, server-verified FIB and order totals, original-price order history and refresh, shared product/discount persistence, bounded numeric stock matrix and 120-variant limit, reduced crop compression attempts, delegated mobile crop actions, cancel-during-processing abort without attaching an image, bounded canvas-encoding timeout with a clear recoverable error, category/banner/image shared D1 and R2 persistence, successful R2 upload/retrieval, failure-safe product/banner saves, explicit D1 acknowledgments and traced failures, outbox fallback, bounded portrait/landscape mobile crop and resource cleanup, failed-preparation recovery, crop and product-save recovery without duplicate IDs, refresh and second-device reads, safe request-correlated diagnostics, legacy D1 and R2 image read compatibility, public catalog-image access, sync payload filtering, and shared image-size limits.`);
