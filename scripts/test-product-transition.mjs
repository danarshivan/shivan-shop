import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
assert.match(html, /<div class="product" onclick="openProduct\(\$\{p\.id\}\)">/, "every shared-renderer product card should use the same direct opener");
assert.match(html, /#mainApp\.detail-mode #detailView\.active\.product-detail-entering\{animation:shopMotionProductOpen 190ms/, "product details should fade and slide in within the requested fast range");
assert.match(html, /#mainApp \.view\.active\.product-list-returning\{animation:shopMotionProductListReturn 100ms/, "returning to a product list should use a 100 ms transition");
assert.match(html, /\.detail-toolbar \.back\{[^}]*touch-action:manipulation/, "the detail close button should avoid tap-gesture delay on mobile");
assert.match(html, /@keyframes shopMotionProductOpen\{from\{opacity:0;transform:translate3d\(0,5px,0\)\}to\{opacity:1;transform:none\}\}/, "opening should use only a short, subtle slide with a fade");
assert.match(html, /@keyframes shopMotionProductListReturn\{from\{opacity:\.94;transform:translate3d\(0,3px,0\)\}to\{opacity:1;transform:none\}\}/, "the quick return should be subtle and visually restrained");
assert.match(html, /prefers-reduced-motion:reduce\)\{#mainApp\.detail-mode #detailView\.active\.product-detail-entering,[\s\S]*?animation:none!important/, "the product detail transition should respect reduced-motion settings");
assert.doesNotMatch(html, /shopMotionProductClose|product-detail-closing/, "the old delayed detail-exit animation should be removed");
assert.doesNotMatch(html, /view-transition-name:shivan-product-image|startViewTransition|runProductViewTransition|shopMotionDetailIn|shopMotionDetailImageIn/, "the prior shared-image and staggered product transition should be removed");

const helperStart = html.indexOf("function prefersReducedProductMotion(){");
const openStart = html.indexOf("function openProduct(id){", helperStart);
assert.ok(helperStart >= 0 && openStart > helperStart, "product motion helpers should exist");
const helpers = html.slice(helperStart, openStart).trim();
const openEnd = html.indexOf("function detailPhotosForProduct(){", openStart);
assert.ok(openEnd > openStart, "the product opener should remain available");
const openProductSource = html.slice(openStart, openEnd).trim();
const closeStart = html.indexOf("function closeProductDetails(){");
const backStart = html.indexOf("function goBack(){", closeStart);
assert.ok(closeStart >= 0 && backStart > closeStart, "the product close flow should remain available");
const closeProductSource = html.slice(closeStart, backStart).trim();
assert.doesNotMatch(openProductSource, /startViewTransition|requestAnimationFrame|setTimeout|await /, "opening must remain immediate and must not wait for an animation callback");
assert.match(openProductSource, /currentProduct=p;[\s\S]*?openView\("detail"\);[\s\S]*?classList\.add\("product-detail-entering"\)/, "the existing product detail state should open immediately before its brief animation");
assert.match(openProductSource, /previousViewScrollY=Math\.max\(0,Number\(window\.scrollY\|\|document\.documentElement\.scrollTop\|\|document\.body\.scrollTop\|\|0\)\)/, "opening should remember the product list scroll position");
assert.match(closeProductSource, /openView\(destinationView\);\s*window\.scrollTo\(0,previousViewScrollY\)/, "closing should return to the prior list and restore its scroll position synchronously");
assert.doesNotMatch(closeProductSource, /animationend|product-detail-closing|await |requestAnimationFrame/, "closing must not wait for an animation callback");
assert.match(closeProductSource, /},130\)/, "the short timer should only clear the return animation state");
assert.match(html, /function goBack\(\)\{\s*closeProductDetails\(\);/, "the existing back control should use the product close flow");

function createHarness({ reducedMotion = false } = {}) {
  const state = {
    openedViews: [],
    detailView: null,
    pendingClose: null,
    pendingDelay: null,
    scrollY: 421,
    scrollCalls: [],
    cart: [{ productId: 77, size: "M", color: "#112233", qty: 2 }],
  };
  const detailClasses = new Set();
  const detailClassList = {
    contains: name => detailClasses.has(name),
    add: name => detailClasses.add(name),
    remove: (...names) => names.forEach(name => detailClasses.delete(name)),
    toggle(name, force) { if (force) detailClasses.add(name); else detailClasses.delete(name); },
  };
  const homeClasses = new Set(["active"]);
  const searchClasses = new Set();
  const detailView = {
    classList: detailClassList,
  };
  state.detailView = detailView;
  const makeView = classes => ({classList:{
    contains:name=>classes.has(name),
    add:name=>classes.add(name),
    remove:(...names)=>names.forEach(name=>classes.delete(name)),
  }});
  const homeView=makeView(homeClasses);
  const searchView=makeView(searchClasses);
  state.homeView=homeView;
  state.searchView=searchView;
  const elements = new Map([
    ["detailView", detailView],
    ["detailName", { textContent: "" }],
    ["detailPrice", { textContent: "" }],
    ["detailDescription", { textContent: "" }],
    ["homeView", homeView],
    ["searchView", searchView],
  ]);
  const document = { getElementById: id => elements.get(id) };
  const product = {
    id: 1,
    name: "Purple Dress",
    image: "https://images.example/purple-dress.webp",
    variants: [{ size: "M", color: "#112233", stock: 4 }],
    sizes: ["M"],
    colors: ["#112233"],
    price: 12000,
    description: "A test product",
  };
  const secondProduct={...product,id:2,name:"Blue Coat",price:18000};
  const context = {
    document,
    window: {
      matchMedia: () => ({ matches: reducedMotion }),
      get scrollY(){return state.scrollY;},
      scrollTo(...args){state.scrollCalls.push(args);state.scrollY=typeof args[0]==="number"?(Number(args[1])||0):(Number(args[0]?.top)||0);},
    },
    console,
    products: [product,secondProduct],
    currentProduct: null,
    currentQty: 0,
    selectedSize: "",
    selectedColor: "",
    previousView: "home",
    previousViewScrollY: 0,
    productDetailCloseTimer: 0,
    productDetailReturnView: null,
    getProductName: item => item.name,
    formatPrice: price => String(price),
    renderDetailGallery() {},
    renderSizeOptions() {},
    renderColorOptions() {},
    updateDetailAvailability() {},
    renderDetailReviews() {},
    resetDetailRecommendations() {},
    openView(view) {
      state.openedViews.push(view);
      detailClasses.delete("active");
      if (view === "detail") { detailClasses.add("active"); homeClasses.delete("active"); searchClasses.delete("active"); }
      if (view === "home") { homeClasses.add("active"); searchClasses.delete("active"); }
      if (view === "search") { searchClasses.add("active"); homeClasses.delete("active"); }
      state.scrollCalls.push([0,0]);
      state.scrollY=0;
    },
    setTimeout(callback,delay) { state.pendingClose = callback;state.pendingDelay=delay;return 1; },
    clearTimeout() { state.pendingClose = null;state.pendingDelay=null; },
    state,
    activateSearch() { homeClasses.delete("active"); searchClasses.add("active"); },
  };
  vm.createContext(context);
  vm.runInContext(`${helpers};`, context);
  return {
    state,
    products:[product,secondProduct],
    context,
    product,
    activateSearch: context.activateSearch,
    openProduct: vm.runInContext(`(${openProductSource})`, context),
    closeProductDetails: vm.runInContext(`(${closeProductSource})`, context),
  };
}

const standard = createHarness();
standard.state.scrollY=421;
standard.openProduct(1);
assert.equal(standard.context.currentProduct, standard.product, "the selected product should open immediately");
assert.equal(standard.context.selectedSize, "M", "the original default available size should remain selected");
assert.equal(standard.context.selectedColor, "#112233", "the original default available color should remain selected");
assert.deepEqual(standard.state.cart, [{ productId: 77, size: "M", color: "#112233", qty: 2 }], "opening details must preserve cart contents");
assert.deepEqual(standard.state.openedViews, ["detail"], "opening a product should keep the existing detail route");
assert.equal(standard.state.detailView.classList.contains("product-detail-entering"), true, "the single brief entrance state should run after immediate navigation");
assert.equal(standard.context.previousViewScrollY,421,"opening should capture the list scroll position before moving into details");

standard.closeProductDetails();
assert.deepEqual(standard.state.openedViews,["detail","home"],"closing should return to the previous list synchronously");
assert.equal(standard.state.scrollY,421,"closing should restore the exact prior list scroll position immediately");
assert.equal(standard.state.homeView.classList.contains("product-list-returning"),true,"the restored list should use its tiny return animation");
assert.equal(standard.state.pendingDelay,130,"the cleanup timer must not delay the view switch");
standard.closeProductDetails();
assert.deepEqual(standard.state.openedViews,["detail","home"],"a rapid second close tap should not navigate or wait again");
const firstCloseCleanup=standard.state.pendingClose;standard.state.pendingClose=null;firstCloseCleanup();
assert.equal(standard.state.homeView.classList.contains("product-list-returning"),false,"the return animation state should clean itself up");

standard.state.scrollY=836;
standard.openProduct(2);
assert.equal(standard.context.currentProduct,standard.products[1],"a second product should open normally after closing the first");
assert.equal(standard.state.detailView.classList.contains("product-detail-entering"),true,"the existing opening animation should remain unchanged for later products");
assert.equal(standard.context.previousViewScrollY,836,"each product should remember the current list position");
standard.closeProductDetails();
assert.equal(standard.state.scrollY,836,"closing a second product should restore its own list position");
const secondCloseCleanup=standard.state.pendingClose;standard.state.pendingClose=null;secondCloseCleanup();

const search = createHarness();
search.activateSearch();
search.state.scrollY=638;
search.openProduct(1);
assert.equal(search.context.previousView, "search", "a product opened from Search should remember Search as its return route");
search.closeProductDetails();
assert.deepEqual(search.state.openedViews,["detail","search"],"closing should return immediately to the original Search list");
assert.equal(search.state.scrollY,638,"Search scroll position should be restored exactly");
const searchCloseCleanup=search.state.pendingClose;search.state.pendingClose=null;searchCloseCleanup();

const reduced = createHarness({ reducedMotion: true });
reduced.state.scrollY=290;
reduced.openProduct(1);
assert.equal(reduced.state.detailView.classList.contains("product-detail-entering"), false, "reduced-motion users should skip the entrance animation");
reduced.closeProductDetails();
assert.deepEqual(reduced.state.openedViews,["detail","home"],"reduced-motion users should navigate back immediately");
assert.equal(reduced.state.scrollY,290,"reduced-motion closing should also restore the prior scroll position");
assert.equal(reduced.state.pendingClose,null,"reduced-motion closing should not schedule animation cleanup");

console.log("Product transition tests passed: unchanged 190 ms opening, synchronous close and list restoration, 100 ms return animation, exact home/search scroll restoration, double-tap guard, multiple products, reduced motion, existing variants, and cart preservation.");
