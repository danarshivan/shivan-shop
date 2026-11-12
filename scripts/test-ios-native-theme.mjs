import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../ios-app-theme.css", import.meta.url), "utf8");
const build = await readFile(new URL("./build.mjs", import.meta.url), "utf8");

const head = html.slice(0, html.indexOf("</head>"));
assert.match(head, /viewport-fit=cover/, "the page uses the full iPhone safe-area viewport");
assert.match(head, /<meta name="theme-color" content="#050509">/, "the original dark Shop browser color is restored");
assert.match(head, /<link rel="stylesheet" href="\/ios-app-theme\.css">/, "the layout-only viewport stylesheet loads in the document head");
assert.doesNotMatch(head, /<link rel="stylesheet" href="\/luxury-theme\.css">/, "the unused legacy luxury theme remains unloaded");
assert.ok(build.includes('"ios-app-theme.css"'), "future production builds copy the viewport stylesheet");

assert.match(html, /:root\{--shop-primary:#8966ff;--shop-secondary:#b49aff;--shop-page-background:#03050d;/, "the original navy and purple Shop palette remains the source of brand colors");
assert.doesNotMatch(css, /--ios-cyan|#[0-9a-f]{3,8}\s*!important|color\s*:/i, "the viewport layer does not override the existing Shop palette or control styling");

const navOpen = html.indexOf('<nav class="bottom-nav">');
const mainClose = html.lastIndexOf("</section>", html.indexOf("<!-- ================= FORGOT PASSWORD ================= -->"));
const navClose = html.indexOf("</nav>", navOpen);
assert.ok(navOpen > mainClose, "the navigation is a sibling after the scrolling #mainApp section");
assert.ok(navClose > navOpen, "the customer and authorized Owner navigation remains in the document");
assert.match(css, /#mainApp\s*\{[\s\S]*?padding-top:\s*env\(safe-area-inset-top,\s*0px\)\s*!important/, "the scrollable app content reserves the iPhone top safe area before its header and page content");
assert.match(css, /#mainApp\s*\{[\s\S]*?overflow-y:\s*auto[\s\S]*?padding-bottom:\s*calc\(82px \+ env\(safe-area-inset-bottom\)\)/, "the scrollable content reserves room for the bottom navigation and safe area");
assert.match(css, /\.app\s*>\s*\.bottom-nav\s*\{[\s\S]*?position:\s*absolute !important[\s\S]*?bottom:\s*0 !important[\s\S]*?env\(safe-area-inset-bottom\)/, "the navigation stays anchored to the app viewport rather than the browser or scroll content");
assert.match(css, /\.app\.auth-mode\s*>\s*\.bottom-nav\s*\{\s*display:\s*none !important/, "navigation remains hidden on authentication screens");
assert.match(css, /@media \(min-width: 700px\)[\s\S]*?width: min\(430px, calc\(100vw - 48px\)\)[\s\S]*?border-radius: 46px/, "Windows desktop presents the app in a centered phone-sized frame");
assert.match(css, /@media \(max-width: 699px\)[\s\S]*?width: 100% !important[\s\S]*?height: 100dvh/, "phones use the full available screen");
assert.match(css, /@media \(prefers-reduced-motion: reduce\)/, "motion respects reduced-motion preferences");

const viewportGeometryStart = css.indexOf("/* Dynamic Safari viewport sizing and single-owner safe areas. */");
assert.ok(viewportGeometryStart >= 0, "the dynamic viewport correction is present");
const viewportGeometry = css.slice(viewportGeometryStart);
assert.match(viewportGeometry, /html,\s*body\s*\{[^}]*height:\s*100vh;[^}]*height:\s*var\(--shivan-visible-viewport-height,\s*100dvh\)/, "the root and body share the measured visible viewport height instead of a percentage layout height");
assert.doesNotMatch(viewportGeometry, /html,\s*body\s*\{[^}]*height:\s*100%/, "the root no longer centers a dvh app inside a percentage-height viewport");
assert.match(viewportGeometry, /\.app\.detail-mode #mainApp\s*\{[^}]*display:\s*flex !important[\s\S]*?padding-top:\s*env\(safe-area-inset-top,\s*0px\) !important/, "Product Details uses the existing app safe-area boundary once");
assert.match(viewportGeometry, /#mainApp > #detailView:not\(\.product-detail-leaving\)\s*\{[^}]*height:\s*auto !important;[^}]*min-height:\s*0 !important/, "Product Details fills the available app area without a second full-viewport height");
assert.match(viewportGeometry, /#detailView:not\(\.product-detail-leaving\) \.detail\s*\{[^}]*padding:\s*8px 12px calc\(18px \+ env\(safe-area-inset-bottom,\s*0px\)\)/, "the detail content has compact top spacing and reserves only the bottom home-indicator inset");

const viewportInstaller = html.match(/function installShivanVisibleViewportSync\(\)\s*\{[\s\S]*?\n\}/)?.[0];
assert.ok(viewportInstaller, "the visible viewport synchronizer is defined in the page");
assert.match(html, /installShivanVisibleViewportSync\(\);/, "the viewport synchronizer starts before storefront interaction");
const viewportStyle = new Map();
const windowListeners = new Map();
const viewportListeners = new Map();
const animationFrames = [];
const visualViewport = {
  height: 844,
  addEventListener(type, handler) { const list = viewportListeners.get(type) || []; list.push(handler); viewportListeners.set(type, list); },
};
const viewportWindow = {
  innerHeight: 900,
  visualViewport,
  addEventListener(type, handler) { const list = windowListeners.get(type) || []; list.push(handler); windowListeners.set(type, list); },
  requestAnimationFrame(handler) { animationFrames.push(handler); return animationFrames.length; },
};
const viewportContext = vm.createContext({
  window: viewportWindow,
  document: { documentElement: { style: { setProperty(name, value) { viewportStyle.set(name, value); } } } },
});
vm.runInContext(`${viewportInstaller}\ninstallShivanVisibleViewportSync();`, viewportContext);
assert.equal(viewportStyle.get("--shivan-visible-viewport-height"), "844px", "the initial app height follows the visible iPhone viewport");
assert.equal(viewportListeners.has("resize"), true, "Safari visual viewport resizing is observed");
assert.equal(windowListeners.has("orientationchange"), true, "orientation changes are observed");
visualViewport.height = 720;
viewportListeners.get("resize")[0]();
assert.equal(animationFrames.length, 1, "viewport events are coalesced into one animation frame");
animationFrames.shift()();
assert.equal(viewportStyle.get("--shivan-visible-viewport-height"), "720px", "the app height follows Safari toolbar viewport changes");
visualViewport.height = 390;
windowListeners.get("orientationchange")[0]();
animationFrames.shift()();
assert.equal(viewportStyle.get("--shivan-visible-viewport-height"), "390px", "the app height updates after orientation changes");
const listenerCount = [...windowListeners.values(), ...viewportListeners.values()].reduce((sum, list) => sum + list.length, 0);
assert.equal(viewportContext.installShivanVisibleViewportSync(), false, "the viewport synchronizer does not register duplicate listeners");
assert.equal([...windowListeners.values(), ...viewportListeners.values()].reduce((sum, list) => sum + list.length, 0), listenerCount);

for (const flow of ["function login(", "function signup(", "function resetPassword(", "function openView(", "function isOwner(", "function isStaffSession(", "function renderOrders(", "function addDetailToCart("]) {
  assert.ok(html.includes(flow), `existing application flow remains present: ${flow}`);
}

let depth = 0;
for (const character of css) {
  if (character === "{") depth += 1;
  if (character === "}") depth -= 1;
  assert.ok(depth >= 0, "stylesheet braces never close before they open");
}
assert.equal(depth, 0, "stylesheet blocks are balanced");

console.log("Shop viewport checks passed: original navy/purple styling, navigation outside the scroll container, reserved content space, safe-area sizing, centered desktop phone frame, full-screen mobile layout, reduced motion, and preserved app-flow entry points.");
