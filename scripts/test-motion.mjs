import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const motionBlock = html.match(/\/\* SHIVAN_SITE_MOTION_V1:[\s\S]*?<\/style>/)?.[0] || "";
assert.ok(motionBlock, "the website should include the shared motion layer");

for (const [pattern, message] of [
  [/button:not\(:disabled\):active/, "buttons should provide gentle press feedback"],
  [/\.shop-promo-onboarding-image\{transition:/, "onboarding slides should cross-fade and scale smoothly"],
  [/\.shop-promo-onboarding\[data-screen="3"\].*shopMotionWelcomeIn/, "the welcome slide should enter smoothly"],
  [/\.view\.active\{animation:shopMotionViewIn/, "screen navigation should animate when a view opens"],
  [/#productsGrid>\.product:nth-child\(-n\+8\)/, "the visible product cards should use a short stagger"],
  [/\.hero-slide\.active img/, "banner images should transition gently"],
  [/\.auth-ad-slide img\{[^}]*transition:/, "login-side promotional images should transition gently"],
  [/\.hero-slide\.active \.hero-copy\{animation:shopMotionBannerIn/, "each newly active banner should animate its copy"],
  [/#searchGrid>\.product/, "search results should share the product entrance motion"],
  [/#cartList>\*/, "cart rows should animate into view"],
  [/#ownerPanelContent>\*/, "Owner editing sections should animate into view"],
  [/\.modal\.show \.modal-card/, "modals should animate when opening"],
  [/transition:opacity 200ms ease,display 200ms allow-discrete/, "supported browsers should animate modal closing as well as opening"],
  [/@starting-style\{[\s\S]*?\.modal\.show/, "supported browsers should animate modal entrances"],
  [/@media\(prefers-reduced-motion:reduce\)/, "the motion layer should respect reduced-motion preferences"],
  [/\.hero-slide img,\.auth-ad-slide img/, "reduced-motion mode should include both shop and login promotional images"],
  [/animation:none!important/, "reduced-motion mode should turn off entrance animations"],
]) {
  assert.match(motionBlock, pattern, message);
}

let braces = 0;
let quote = "";
for (let index = motionBlock.indexOf("*/") + 2; index < motionBlock.length; index++) {
  const char = motionBlock[index];
  if (quote) {
    if (char === "\\") index++;
    else if (char === quote) quote = "";
    continue;
  }
  if (char === "\"" || char === "'") { quote = char; continue; }
  if (char === "/" && motionBlock[index + 1] === "*") {
    const end = motionBlock.indexOf("*/", index + 2);
    assert.notEqual(end, -1, "motion CSS comments should close");
    index = end + 1;
    continue;
  }
  if (char === "{") braces++;
  if (char === "}") braces--;
  assert.ok(braces >= 0, "motion CSS braces should be balanced in order");
}
assert.equal(braces, 0, "motion CSS blocks should have balanced braces");
const entranceMotionBlock = motionBlock.split("/* Product detail motion:")[0];
assert.doesNotMatch(entranceMotionBlock, /animation-fill-mode\s*:\s*forwards|\b(?:both|forwards)\s*(?:;|\})/i, "entrance effects should release their transforms so later press and hover feedback still works; only the brief close exit may retain its final frame");
assert.match(html, /\.shop-startup-splash\{/, "the existing logo splash should remain in the website");

const finish = html.match(/function finishShopOnboarding\(\)\{[\s\S]*?\n\}/)?.[0] || "";
assert.match(finish, /hideShopOnboarding\(\);\s*openMain\(\{resumeIntent:false\}\);\s*openView\("home"\)/, "finishing onboarding should still open Shop / Models immediately");
assert.doesNotMatch(finish, /setTimeout|requestAnimationFrame|await /, "the animation layer must not delay Skip or the final onboarding handoff");

console.log("Website motion checks passed: screen and list entrances, onboarding and banner transitions, button feedback, modal motion, reduced-motion support, and immediate Skip/completion handoff.");
