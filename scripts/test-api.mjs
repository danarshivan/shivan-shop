import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";

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
const inventoryRendererSource = htmlSource.match(/function renderOwnerInventoryMatrix\(\)\{[\s\S]*?\n\}/)?.[0] || "";
const cropCompressionSource = htmlSource.match(/async function finishImageCrop\(apply\)\{[\s\S]*?\n\}/)?.[0] || "";
assert.match(productSaveSource, /await confirmCloudShopWrite\(PRODUCTS_KEY\)/, "the Owner form must wait for the shared-save result");
assert.match(productSaveSource, /shared database has not confirmed/i, "the Owner form must not report an unconfirmed cloud save as complete");
const cloudFailureBranch = productSaveSource.indexOf("if(cloudSyncRequired&&!cloudSaved)");
const productSuccessExit = productSaveSource.indexOf("editingProductId=null");
assert.ok(cloudFailureBranch >= 0 && cloudFailureBranch < productSuccessExit, "a failed shared save must keep the Owner form open before the success navigation");
assert.match(productSaveSource.slice(cloudFailureBranch, productSuccessExit), /editingProductId=record\.id/, "a retry must reuse the pending product ID instead of creating a duplicate");
assert.doesNotMatch(productSaveSource, /renderOwnerInventoryMatrix\(\)/, "saving a product must not rebuild the stock table");
assert.match(htmlSource, /const MAX_OWNER_PRODUCT_VARIANTS = 120;/, "the Owner form must cap color and size combinations");
assert.match(inventoryRendererSource, /type="number" min="0" step="1" inputmode="numeric"/, "stock quantity controls should be lightweight numeric inputs");
assert.doesNotMatch(inventoryRendererSource, /<select|<option/, "stock rendering must not generate large dropdown option lists");
assert.match(inventoryRendererSource, /combinationCount>MAX_OWNER_PRODUCT_VARIANTS/, "the stock table must stop rendering over the variant limit");
assert.match(productSaveSource, /combinationCount>MAX_OWNER_PRODUCT_VARIANTS/, "Save must reject over-limit variants before creating the product record");
assert.match(cropCompressionSource, /for\(const maxOutput of \[1000,760\]\)/, "crop encoding should use two bounded output sizes");
assert.match(cropCompressionSource, /\[\["image\/webp",\.76\],\["image\/jpeg",\.7\]\]/, "crop encoding should try one quality per format and output size");

class MemoryD1 {
  shop = new Map();
  accounts = new Map();
  sessions = new Map();
  failNextProductWrite = false;
  failNextMediaWrite = false;
  failNextProductResult = false;
  failNextMediaResult = false;

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
    if (sql.includes("FROM shop_state WHERE key=?")) {
      const value = this.shop.get(values[0]);
      return value === undefined ? null : { value };
    }
    if (sql.includes("FROM accounts WHERE identifier=?")) {
      return [...this.accounts.values()].find(account => account.identifier.toLowerCase() === String(values[0]).toLowerCase()) || null;
    }
    return null;
  }

  async all(sql) {
    if (sql.includes("FROM shop_state")) {
      return { results: [...this.shop.entries()]
        .filter(([key]) => !key.startsWith("media:"))
        .map(([key, value]) => ({ key, value })) };
    }
    return { results: [] };
  }

  async run(sql, values) {
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
    if (sql.includes("INSERT INTO shop_state")) {
      const [key, value] = values;
      if (key.startsWith("media:") && this.failNextMediaResult) {
        this.failNextMediaResult = false;
        return { success: false, error: "Simulated D1 media result failure" };
      }
      if (key.startsWith("media:") && this.failNextMediaWrite) {
        this.failNextMediaWrite = false;
        throw new Error("Simulated D1 media write failure");
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

const DB = new MemoryD1();
const env = { DB, OWNER_SETUP_TOKEN: "test-only-owner-code" };
const context = async request => onRequest({ request, env });
const imageBytes = Uint8Array.from([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]);
const ownerSetup = await context(new Request("https://shop.test/api/auth/setup-owner", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ setupToken: env.OWNER_SETUP_TOKEN, name: "Owner", identifier: "07502342153", password: "long-test-password" }),
}));
assert.equal(ownerSetup.status, 201, "owner setup should succeed in the test database");
const cookie = ownerSetup.headers.get("Set-Cookie").split(";")[0];

const uploadRequest = () => new Request("https://shop.test/api/media/upload", {
  method: "POST",
  headers: { Origin: "https://shop.test", "Content-Type": "image/webp", Cookie: cookie },
  body: imageBytes,
});
const upload = await context(uploadRequest());
assert.equal(upload.status, 201, "an authenticated owner should upload without an R2 binding");
const { url: imageUrl } = await upload.json();
assert.match(imageUrl, /^\/api\/media\/shop\/[A-Za-z0-9_-]{43}\.webp$/);

DB.failNextMediaWrite = true;
const originalConsoleError = console.error;
let failedImageUpload;
try {
  console.error = () => {};
  failedImageUpload = await context(uploadRequest());
} finally {
  console.error = originalConsoleError;
}
assert.equal(failedImageUpload.status, 503, "D1 image-write failures should be reported as shared-storage errors");
assert.match((await failedImageUpload.json()).error, /could not be saved to shared cloud storage/i);

DB.failNextMediaResult = true;
let unconfirmedImageUpload;
try {
  console.error = () => {};
  unconfirmedImageUpload = await context(uploadRequest());
} finally {
  console.error = originalConsoleError;
}
assert.equal(unconfirmedImageUpload.status, 503, "D1 success:false must not return an image URL as if the upload succeeded");
assert.match((await unconfirmedImageUpload.json()).error, /could not be saved to shared cloud storage/i);

const imageResponse = await context(new Request(`https://shop.test${imageUrl}`));
assert.equal(imageResponse.status, 200, "a shared shop image should be readable without an account");
assert.equal(imageResponse.headers.get("Content-Type"), "image/webp");
assert.deepEqual(new Uint8Array(await imageResponse.arrayBuffer()), imageBytes);

const inlineImage = `data:image/webp;base64,${Buffer.from(imageBytes).toString("base64")}`;
const productId = 1791835200123;
const save = await context(new Request("https://shop.test/api/sync", {
  method: "PUT",
  headers: { "Content-Type": "application/json", Cookie: cookie },
  body: JSON.stringify({ key: "shivan_shop_products", value: JSON.stringify([{ id: productId, name: "Test product", image: imageUrl, images: [{ src: imageUrl, color: "" }] }]) }),
}));
assert.equal(save.status, 200, "owner product data referencing an uploaded crop should save into D1");
assert.deepEqual(await save.json(), { ok: true, key: "shivan_shop_products", persisted: true }, "the save API should explicitly acknowledge the saved shop key");
const storedProducts = JSON.parse(DB.shop.get("shivan_shop_products"));
assert.equal(storedProducts.length, 1);
assert.equal(storedProducts[0].id, productId, "D1 persistence must preserve the numeric product ID");
assert.match(storedProducts[0].image, /^\/api\/media\/shop\//);
assert.equal(storedProducts[0].images[0].src, imageUrl, "the saved product must keep the uploaded cropped-image URL");

const reloaded = await context(new Request("https://shop.test/api/sync", { headers: { Cookie: cookie } }));
assert.equal(reloaded.status, 200);
const reloadedData = await reloaded.json();
const reloadedProducts = JSON.parse(reloadedData.shop.shivan_shop_products);
assert.equal(reloadedProducts.length, 1, "a new product must still exist after a server reload");
assert.equal(reloadedProducts[0].id, productId, "the product ID must survive a server reload unchanged");
assert.equal(reloadedProducts[0].images[0].src, imageUrl, "the cropped image reference must survive a server reload");
const secondDevice = await context(new Request("https://shop.test/api/sync"));
assert.equal(secondDevice.status, 200, "a separate device can load the public shop data from shared D1");
assert.equal(JSON.parse((await secondDevice.json()).shop.shivan_shop_products)[0].images[0].src, imageUrl, "the product and cropped image URL must be shared across devices");
const reloadedProductImage = await context(new Request(`https://shop.test${reloadedProducts[0].images[0].src}`));
assert.equal(reloadedProductImage.status, 200, "the product's cropped image must remain readable after a D1 reload");
assert.deepEqual(new Uint8Array(await reloadedProductImage.arrayBuffer()), imageBytes);

DB.failNextProductResult = true;
let unconfirmedProductSave;
try {
  console.error = () => {};
  unconfirmedProductSave = await context(new Request("https://shop.test/api/sync", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ key: "shivan_shop_products", value: JSON.stringify([{ id: productId + 1, name: "Unconfirmed product", image: imageUrl }]) }),
  }));
} finally {
  console.error = originalConsoleError;
}
assert.equal(unconfirmedProductSave.status, 503, "D1 success:false must not return persisted:true for a product write");
assert.match((await unconfirmedProductSave.json()).error, /shared database could not confirm/i);
assert.equal(JSON.parse(DB.shop.get("shivan_shop_products"))[0].id, productId, "an unconfirmed product write must leave the previous product data intact");

const otherBytes = Uint8Array.from([...imageBytes, 1]);
const otherInlineImage = `data:image/webp;base64,${Buffer.from(otherBytes).toString("base64")}`;
const mediaRowsBeforeBatchFailure = [...DB.shop.keys()].filter(key => key.startsWith("media:")).length;
DB.failNextMediaResult = true;
let unconfirmedCroppedImageReference;
try {
  console.error = () => {};
  unconfirmedCroppedImageReference = await context(new Request("https://shop.test/api/sync", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ key: "shivan_shop_products", value: JSON.stringify([{ id: productId + 2, name: "Product with unconfirmed crop", image: otherInlineImage }]) }),
  }));
} finally {
  console.error = originalConsoleError;
}
assert.equal(unconfirmedCroppedImageReference.status, 503, "a failed D1 media batch must block product persistence and return an error");
assert.match((await unconfirmedCroppedImageReference.json()).error, /shared database could not confirm/i);
assert.equal([...DB.shop.keys()].filter(key => key.startsWith("media:")).length, mediaRowsBeforeBatchFailure, "a failed D1 media batch must not leave a media row behind in the test database");
assert.equal(JSON.parse(DB.shop.get("shivan_shop_products"))[0].id, productId, "product data must not update when a referenced image write failed");

const bannerSave = await context(new Request("https://shop.test/api/sync", {
  method: "PUT",
  headers: { "Content-Type": "application/json", Cookie: cookie },
  body: JSON.stringify({ key: "shivan_shop_ads", value: JSON.stringify([{ id: "banner-1", title: "Test banner", image: inlineImage }]) }),
}));
assert.equal(bannerSave.status, 200, "owner banner data and inline photos should save into D1");
assert.deepEqual(await bannerSave.json(), { ok: true, key: "shivan_shop_ads", persisted: true });
const storedBanners = JSON.parse(DB.shop.get("shivan_shop_ads"));
assert.match(storedBanners[0].image, /^\/api\/media\/shop\//, "banner records should reference their shared D1 image");
const bannerImageResponse = await context(new Request(`https://shop.test${storedBanners[0].image}`));
assert.equal(bannerImageResponse.status, 200, "a saved banner image should load from D1");
assert.deepEqual(new Uint8Array(await bannerImageResponse.arrayBuffer()), imageBytes);

// Existing catalog URLs are kept intact. Simulate a legacy R2 object to ensure
// the read fallback remains available without using R2 for new uploads.
const legacyMediaKey = `shop/${"B".repeat(43)}.png`;
let legacyMediaReads = 0;
let legacyMediaWrites = 0;
env.MEDIA = {
  get: async key => {
    if (key !== legacyMediaKey) return null;
    legacyMediaReads++;
    return {
      body: imageBytes,
      writeHttpMetadata: headers => headers.set("Content-Type", "image/png"),
    };
  },
  put: async () => { legacyMediaWrites++; throw new Error("New media must not be written to R2"); },
};
const legacyImageResponse = await context(new Request(`https://shop.test/api/media/${legacyMediaKey}`));
assert.equal(legacyImageResponse.status, 200, "existing R2-backed image URLs should remain readable when MEDIA is configured");
assert.equal(legacyImageResponse.headers.get("Content-Type"), "image/png");
assert.equal(legacyMediaReads, 1);
assert.equal(legacyMediaWrites, 0, "new media uploads must not write to R2");

DB.failNextProductWrite = true;
let failedSave;
try {
  console.error = () => {};
  failedSave = await context(new Request("https://shop.test/api/sync", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ key: "shivan_shop_products", value: JSON.stringify([{ id: productId + 1, name: "Unsaved product" }]) }),
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
assert.equal(tooLarge.status, 413, "uploads above the D1-safe image limit should be rejected");

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
const customerUpload = await context(new Request("https://shop.test/api/media/upload", {
  method: "POST",
  headers: { Origin: "https://shop.test", "Content-Type": "image/webp", Cookie: customerCookie },
  body: imageBytes,
}));
assert.equal(customerUpload.status, 403, "a customer account must not upload owner catalog images");

const customerShopWrite = await context(new Request("https://shop.test/api/sync", {
  method: "PUT",
  headers: { "Content-Type": "application/json", Cookie: customerCookie },
  body: JSON.stringify({ key: "shivan_shop_products", value: "[]" }),
}));
assert.equal(customerShopWrite.status, 403, "a customer account must not edit shared shop data");

console.log(`Checks passed: ${inlineScripts.length} storefront script block(s), owner/customer authorization, explicit product-save acknowledgment, retry-safe Owner form behavior, successful cropped-image and product persistence in D1, refresh and second-device reads, D1 success:false handling for image uploads, image batches, and product writes, legacy R2 image read compatibility, no new R2 writes, simulated D1 exceptions, public shop image retrieval, sync payload filtering, and image size limit, bounded stock controls, variant limits, and reduced crop encoding attempts.`);
