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

class MemoryD1 {
  shop = new Map();
  accounts = new Map();
  sessions = new Map();

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
    const results = [];
    for (const statement of statements) results.push(await statement.run());
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

const imageResponse = await context(new Request(`https://shop.test${imageUrl}`));
assert.equal(imageResponse.status, 200, "a shared shop image should be readable without an account");
assert.equal(imageResponse.headers.get("Content-Type"), "image/webp");
assert.deepEqual(new Uint8Array(await imageResponse.arrayBuffer()), imageBytes);

const inlineImage = `data:image/webp;base64,${Buffer.from(imageBytes).toString("base64")}`;
const save = await context(new Request("https://shop.test/api/sync", {
  method: "PUT",
  headers: { "Content-Type": "application/json", Cookie: cookie },
  body: JSON.stringify({ key: "shivan_shop_products", value: JSON.stringify([{ id: 1, image: inlineImage }]) }),
}));
assert.equal(save.status, 200, "owner product data and inline legacy photos should save into D1");
const storedProducts = JSON.parse(DB.shop.get("shivan_shop_products"));
assert.match(storedProducts[0].image, /^\/api\/media\/shop\//);

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

console.log(`Checks passed: ${inlineScripts.length} storefront script block(s), owner/customer authorization, D1 image persistence, public shop image retrieval, sync payload filtering, and image size limit.`);
