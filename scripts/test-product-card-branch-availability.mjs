import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html=await readFile(new URL("../index.html",import.meta.url),"utf8");
function source(name){const match=html.match(new RegExp("function "+name+"\\([^\\n]*\\)\\s*\\{[\\s\\S]*?\\n\\}","m"));assert.ok(match,"Expected "+name);return match[0];}
const context={productHasAvailableInventory:p=>p.available===true,customerUiText:en=>en,escapeHtml:value=>String(value),translateText:value=>value};
vm.createContext(context);
vm.runInContext(source("renderProductCardAvailability")+"\n"+source("renderProductCardStockStatus")+"\nthis.renderAvailability=renderProductCardAvailability;this.renderStock=renderProductCardStockStatus;",context);
const one=context.renderAvailability({available:true,storeAvailability:"shop1"});
assert.ok(one.includes('Shivan 1</span><span class="product-store-branch-check" role="img" aria-label="Available">✓</span>'));
assert.doesNotMatch(one,/Shivan 2/);
const two=context.renderAvailability({available:true,storeAvailability:"shop2"});
assert.ok(two.includes('Shivan 2</span><span class="product-store-branch-check" role="img" aria-label="Available">✓</span>'));
assert.doesNotMatch(two,/Shivan 1/);
const both=context.renderAvailability({available:true,storeAvailability:"both"});
assert.ok(both.indexOf("Shivan 1")<both.indexOf("Shivan 2"));
assert.equal((both.match(/class="product-store-branch"/g)||[]).length,2,"both shops are separate lines");
for(const product of [{available:true},{available:true,storeAvailability:"unknown"},{available:false,storeAvailability:"shop1"},{available:false,storeAvailability:"both"}])assert.equal(context.renderAvailability(product),"","unassigned or unavailable branches stay hidden");
assert.equal(context.renderStock({available:true}),'<div class="stock-line" aria-hidden="true"></div>',"in-stock text is absent while the original status-row space remains");
const soldOut=context.renderStock({available:false});
assert.match(soldOut,/class="stock-line out-of-stock" role="status"/);
assert.match(soldOut,/بەردەست نەماوە/);
assert.doesNotMatch(soldOut,/In stock/);
assert.match(html,/\.product-info \.product-store-location\.product-store-branches\{[^}]*flex-direction:column[^}]*direction:ltr/);
assert.match(html,/\.product-info \.product-store-branches \.product-store-branch-check\{color:#2ed37b/);
assert.match(source("renderProducts"),/\$\{renderProductCardAvailability\(p\)\}/);
assert.match(source("renderStoreProductCards"),/\$\{renderProductCardAvailability\(p\)\}/);
console.log("Product card availability checks passed: no in-stock text, explicit one/two-branch checks, hidden unknown or unavailable branches, and unchanged out-of-stock status.");
