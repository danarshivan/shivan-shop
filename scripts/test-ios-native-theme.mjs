import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

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
