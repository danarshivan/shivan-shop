import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import { runInNewContext } from "node:vm";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const apiSource = await readFile(new URL("../functions/api/[[path]].js", import.meta.url), "utf8");
const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]).filter(script => script.trim());
assert.ok(inlineScripts.length, "the website should contain its application script");
for (const [index, script] of inlineScripts.entries()) {
  try { new Function(script); }
  catch (error) { throw new Error(`Storefront script ${index + 1} has a syntax error: ${error.message}`); }
}

const extractFunction = name => {
  const source = html.match(new RegExp(`function ${name}\\([^\\n]*\\)\\{[\\s\\S]*?\\n\\}`))?.[0];
  assert.ok(source, `the website should define ${name}`);
  return source;
};
const sharedImageKey = html.match(/const SHOP_ONBOARDING_IMAGES_KEY = "([^"]+)";/)?.[1];
assert.equal(sharedImageKey, "shivan_shop_ios_onboarding_images", "website and iOS app must share the same Owner-managed slide image key");
assert.doesNotMatch(html, /SHOP_ONBOARDING_COMPLETED_KEY|markShopOnboardingCompleted|resetShopOnboardingCompletion/, "onboarding completion must not be persisted");

assert.match(html, /id="shopPromoOnboarding"[^>]*role="dialog"[^>]*aria-modal="true"/);
const defaultPageScrollCss=html.match(/html,body\{[^}]*\}/)?.[0]||"";
const onboardingScrollLockCss=html.match(/html\.shop-promo-onboarding-open,body\.shop-promo-onboarding-open\{[^}]*\}/)?.[0]||"";
const onboardingShellCss=html.match(/\.shop-promo-onboarding\{[^}]*\}/)?.[0]||"";
assert.ok(defaultPageScrollCss.includes("overflow-y:auto"), "normal shop scrolling should remain enabled outside onboarding");
assert.ok(html.includes("html{scrollbar-gutter:stable}"), "scrollbar width should remain stable when the onboarding lock toggles");
assert.ok(onboardingScrollLockCss.includes("overflow:hidden!important")&&onboardingScrollLockCss.includes("overscroll-behavior:none"), "both the root and body must stop scrolling only during onboarding");
assert.ok(onboardingShellCss.includes("position:fixed;inset:0")&&onboardingShellCss.includes("touch-action:none")&&onboardingShellCss.includes("overscroll-behavior:contain"), "the viewport-filling onboarding layer should block vertical panning while JavaScript handles horizontal swipes");
assert.match(html, /height:100vh;height:100dvh;min-height:0;[^}]*env\(safe-area-inset-top\)[^}]*env\(safe-area-inset-bottom\)/, "slide content should fit the dynamic viewport and retain iPhone safe-area padding");
const onboardingMarkup=html.match(/<section id="shopPromoOnboarding"[\s\S]*?<\/section>/)?.[0]||"";
assert.equal((onboardingMarkup.match(/<img\b/g)||[]).length, 1, "the onboarding overlay should contain a single reusable fashion image element");
const mediaMarkup=onboardingMarkup.match(/<div class="shop-promo-onboarding-media">[\s\S]*?<\/div>/)?.[0]||"";
assert.match(mediaMarkup, /<img id="shopPromoOnboardingImage"[\s\S]*?<\/div>/, "the existing fashion image should appear inside its framed media panel");
assert.match(mediaMarkup, /class="shop-promo-onboarding-shade"/, "the image panel should retain a subtle dark lower gradient");
assert.match(html, /\.shop-promo-onboarding-media\{[^}]*border:1px solid color-mix\(in srgb,var\(--shop-secondary,/,
  "the promo image frame border should follow the globally saved secondary theme color");
assert.match(html, /\.shop-promo-onboarding-media\{[^}]*border-radius:/);
const onboardingMediaCss=html.match(/\.shop-promo-onboarding-media\{[^}]*\}/)?.[0]||"";
const onboardingImageCss=html.match(/\.shop-promo-onboarding-image\{[^}]*\}/)?.[0]||"";
assert.ok(onboardingMediaCss.includes("aspect-ratio:3/4"), "all promo slides should use the same portrait frame ratio");
assert.ok(onboardingMediaCss.includes("align-self:center"), "the fixed-ratio frame should stay centered in the responsive slide layout");
assert.ok(onboardingMediaCss.includes("calc((100dvh - clamp(180px,30dvh,240px))*.75)"), "the frame should scale smoothly with available viewport height");
assert.match(onboardingImageCss, /object-fit:cover/, "promotional images should fill the rounded frame without letterboxing");
assert.match(onboardingImageCss, /object-position:center/, "image crops should remain centered by default");
assert.match(html, /@media\(max-height:560px\)\{\.shop-promo-onboarding-content\{gap:8px/);
for (const viewport of [{width:375,height:560},{width:375,height:561},{width:375,height:568},{width:390,height:667},{width:393,height:852},{width:430,height:932},{width:844,height:390},{width:1440,height:900}]) {
  const short=viewport.height<=560;
  const reserved=Math.min(240,Math.max(180,viewport.height*.3));
  const availableWidth=Math.max(0,viewport.width-(viewport.width<=600?36:96));
  const width=Math.min(availableWidth,520,Math.max(0,(viewport.height-reserved)*.75));
  const height=width*4/3;
  const controlsReserve=short?150:reserved;
  assert.ok(width>0 && height>0, `onboarding image frame should fit ${viewport.width}x${viewport.height}`);
  assert.ok(height<=viewport.height-controlsReserve+0.01, `onboarding image frame should leave controls and safe-area room at ${viewport.width}x${viewport.height}`);
  assert.ok(Math.abs(width/height-.75)<0.001, `onboarding image ratio should remain consistent at ${viewport.width}x${viewport.height}`);
}
const brandMarkup=onboardingMarkup.match(/<div class="shop-promo-onboarding-brand"[^>]*>[\s\S]*?<\/div>/)?.[0]||"";
assert.match(brandMarkup, /<span>SHIVAN SHOP<\/span>/, "the centered brand name should appear at the top");
assert.doesNotMatch(brandMarkup, /<svg|cart|bag/i, "the onboarding brand should not display a shopping icon");
assert.match(html, /\.shop-promo-onboarding-brand\{[^}]*justify-content:center/, "the header brand should remain centered after removing the icon");
assert.match(html, /\.shop-promo-onboarding-brand span\{color:var\(--shop-readable-text,/, "the brand wordmark should use the global readable text token");
assert.match(html, /linear-gradient\(0deg,rgba\(2,2,5,\.88\),rgba\(2,2,5,\.4\) 23%,transparent 50%\)/, "the lower black gradient should keep slide controls legible");
assert.match(onboardingMarkup, /id="shopPromoOnboardingNext"[^>]*onclick="advanceShopOnboarding\(\)"[^>]*>Next/, "slides one and two should provide a Next button");
assert.match(onboardingMarkup, /id="shopPromoOnboardingChoices"[^>]*hidden>[\s\S]*?onclick="startShopOnboardingSignup\(\)"[^>]*>Create Account[\s\S]*?onclick="finishShopOnboarding\(\)"[^>]*>Explore Models/, "the last slide should show the two requested choices");
assert.doesNotMatch(onboardingMarkup, /\bSkip\b|shopPromoOnboardingSkip/);
assert.ok(onboardingMarkup.indexOf('class="shop-promo-onboarding-actions"')<onboardingMarkup.indexOf('id="shopPromoOnboardingDots"'), "pagination dots should sit beneath the action buttons");
assert.match(html, /\.shop-promo-onboarding\{--onboarding-purple:var\(--shop-primary,/,
  "onboarding accents should use the global primary theme token");
assert.match(html, /linear-gradient\(180deg,color-mix\(in srgb,var\(--shop-page-background,/,
  "onboarding background should follow the global page background token");
assert.match(html, /\.shop-promo-onboarding-choices\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/, "the final choices should sit side by side on phones");
assert.match(html, /shopMotionOnboardingForward 300ms/);
assert.match(html, /shopMotionOnboardingBackward 300ms/);
assert.match(html, /prefers-reduced-motion:reduce\)[\s\S]*?\.shop-promo-onboarding-content/);
assert.match(html, /\.shop-promo-onboarding\.is-handoff-exiting\{[^}]*animation:shopMotionOnboardingHandoff 260ms/, "onboarding choices should reveal their destination with a short directional fade and slide");
assert.match(html, /\.shop-promo-onboarding\.is-handoff-exiting\{animation:none!important/, "onboarding page handoffs should honor reduced-motion preferences");
assert.match(html, /function warmShopOnboardingImages\(\)\{[\s\S]*?new Set\(shopOnboardingImages\)/, "shared slides should warm in asynchronously");
const defaultImageList=html.match(/const SHOP_ONBOARDING_DEFAULT_IMAGES = Object\.freeze\(\[([\s\S]*?)\]\);/)?.[1]||"";
assert.deepEqual([...defaultImageList.matchAll(/"(https:\/\/[^"]+)"/g)].map(match=>match[1]), [
  "https://images.unsplash.com/photo-1539109136881-3be0616acf4b?auto=format&fit=crop&w=1000&q=75",
  "https://images.unsplash.com/photo-1445205170230-053b83016050?auto=format&fit=crop&w=1000&q=75",
  "https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=1000&q=75",
], "the three existing promotional images must keep their order");
assert.match(html, /Women’s fashion collection, slide 3/);
assert.match(html, /pointerdown/);
assert.match(html, /pointerup/);
assert.match(html, /safe-area-inset-bottom/);
assert.match(html, /\["onboarding","▣",ownerDashboardText\("Promotional Slides"/);
assert.match(html, /uploadOwnerImage\(input,`shopPromoImageData\$\{index\}`,`shopPromoImagePreview\$\{index\}`,"ad"\)/);
assert.match(extractFunction("renderShopOnboardingOwnerEditor"), /if\(!isOwner\(\)\)/, "the Owner editor must check the current role");
assert.match(extractFunction("saveShopOnboardingImages"), /cloudAccount\?\.role!=="owner"/, "the client editor must require the shared Owner account");
assert.match(extractFunction("saveShopOnboardingImages"), /SHOP_ONBOARDING_IMAGES_KEY/);
assert.match(extractFunction("saveShopOnboardingImages"), /originalStorageSetItem\.call\(localStorage,SHOP_ONBOARDING_IMAGES_KEY,value\)/, "a confirmed save should update the local mirror used by the existing sync flow");
assert.match(extractFunction("renderOwnerPanel"), /route\.panel==="onboarding"\)renderShopOnboardingOwnerEditor\(sectionBox\)/);
assert.match(extractFunction("showShopOnboardingIfNeeded"), /getShopOnboardingStartupView/);
assert.match(extractFunction("showShopOnboarding"), /document\.documentElement\?\.classList\.add\("shop-promo-onboarding-open"\)[\s\S]*?document\.body\?\.classList\.add\("shop-promo-onboarding-open"\)/, "showing onboarding should lock both root and body before reveal");
assert.match(extractFunction("hideShopOnboarding"), /document\.documentElement\?\.classList\.remove\("shop-promo-onboarding-open"\)[\s\S]*?document\.body\?\.classList\.remove\("shop-promo-onboarding-open"\)/, "closing onboarding should restore normal root and body scrolling");
assert.doesNotMatch(extractFunction("hideShopOnboarding"), /if\(!layer\)return/, "onboarding scroll locks must still be cleared if its overlay element is missing");
assert.match(extractFunction("openView"), /if\(!onboardingLayer\|\|onboardingLayer\.hidden\)[\s\S]*?if\(staleOnboardingLock\)hideShopOnboarding\(\)/, "normal route navigation should remove stale onboarding locks before opening a section");
assert.match(extractFunction("finishShopOnboarding"), /beginShopOnboardingPageHandoff\("shop"[\s\S]*?openMain\(\{resumeIntent:false\}\);\s*openView\("home"\)/, "Explore Models must enter Shop without replaying a pending intent");
assert.match(extractFunction("startShopOnboardingSignup"), /showAuth\("signup"\)/, "Create Account should use the existing sign-up screen");
assert.match(extractFunction("startShopOnboardingSignup"), /beginShopOnboardingPageHandoff\("signup"[\s\S]*?mainApp\.style\.display="none"[\s\S]*?authPage\.style\.display=""/, "registration should use the existing signup screen without recreating account state");
assert.match(extractFunction("beginShopOnboardingPageHandoff"), /shopOnboardingHandoffLocked[\s\S]*?prepareDestination\(\)[\s\S]*?prefersReducedShopOnboardingMotion\(\)[\s\S]*?SHOP_ONBOARDING_HANDOFF_MS/, "page handoffs should lock repeated taps, prepare the destination under the overlay, and bypass animation when reduced motion is enabled");
assert.match(extractFunction("openMain"), /if\(!shopOnboardingActive\)hideShopOnboarding\(\)/, "cloud session restoration must not close an active onboarding overlay");
assert.match(extractFunction("logout"), /showShopOnboarding\(\)/, "logout should show the same three-slide introduction");
assert.match(html, /if\(!cloudMode\)await restoreSession\(\);/, "startup should still restore any saved session after cloud initialization");
const startupHandler = html.match(/document\.addEventListener\("DOMContentLoaded",\(\)=>\{[\s\S]*?\n\}\);/)?.[0] || "";
assert.ok(startupHandler, "the website should retain its startup handler");
assert.doesNotMatch(startupHandler, /showShopOnboardingIfNeeded\(\)/, "initial startup should enter Shop / Models after the branded splash");
assert.match(extractFunction("finishShopStartupSplash"), /shopStartupCompleted=true;\s*showShopOnboardingIfNeeded\(\)/, "the three-slide introduction should appear after the branded splash");
assert.match(html, /function logout\(\)\{[\s\S]*?showShopOnboarding\(\)/, "logout should keep the existing onboarding replay behavior");

const flowNames = [
  "getShopOnboardingStartupView", "getNextShopOnboardingStep", "getShopOnboardingSwipeTarget",
  "getShopOnboardingVisibilityAction", "getActiveShopView", "readShopViewPosition", "captureShopOnboardingResumeState", "restoreShopOnboardingResumeState", "prefersReducedShopOnboardingMotion", "warmShopOnboardingImages", "renderShopOnboardingSlide", "moveShopOnboardingTo",
  "advanceShopOnboarding", "beginShopOnboardingPageHandoff", "startShopOnboardingSignup",
  "finishShopOnboarding", "hideShopOnboarding", "setupShopOnboardingGestures", "showShopOnboardingIfNeeded", "showShopOnboarding",
  "handleShopOnboardingVisibilityChange",
];
const flowSource = [
  `const SHOP_ONBOARDING_IMAGES_KEY = "${sharedImageKey}";`,
  "const SHOP_ONBOARDING_SLIDE_COUNT = 3;",
  "const SHOP_ONBOARDING_TRANSITION_MS = 300;",
  "const SHOP_ONBOARDING_REDUCED_MOTION_GUARD_MS = 120;",
  "const SHOP_ONBOARDING_HANDOFF_MS = 260;",
  "const shopOnboardingImagePreloads=new Map();",
  'const SHOP_ONBOARDING_DEFAULT_IMAGES = Object.freeze(["https://fallback.example.test/1.jpg", "https://fallback.example.test/2.jpg", "https://fallback.example.test/3.jpg"]);',
  "let shopOnboardingSlideIndex=0;",
  "let shopOnboardingLastRenderedIndex=-1;",
  "let shopOnboardingTransitionTimer=0;",
  "let shopOnboardingTransitionLocked=false;",
  "let shopOnboardingHandoffTimer=0;",
  "let shopOnboardingHandoffLocked=false;",
  "let shopOnboardingImages=[...SHOP_ONBOARDING_DEFAULT_IMAGES];",
  "let shopOnboardingActive=false;",
  "let shopAppWasHidden=false;",
  "let shopOnboardingResumeState=null;",
  "let currentCategory=\"هەموو\";",
  "let currentProduct=null;",
  "let selectedSize=\"\";",
  "let selectedColor=\"\";",
  "let currentQty=1;",
  "let currentGalleryIndex=0;",
  "let ownerPanel=\"products\";",
  "let shopStartupCompleted=true;",
  ...[...flowNames, "readShopOnboardingImages"].map(extractFunction),
  "({advance:advanceShopOnboarding,move:moveShopOnboardingTo,signup:startShopOnboardingSignup,setup:setupShopOnboardingGestures,render:renderShopOnboardingSlide,index:()=>shopOnboardingSlideIndex,locked:()=>shopOnboardingTransitionLocked,handoffLocked:()=>shopOnboardingHandoffLocked,view:getShopOnboardingStartupView,showIfNeeded:showShopOnboardingIfNeeded,show:showShopOnboarding,finish:finishShopOnboarding,hide:hideShopOnboarding,visibility:getShopOnboardingVisibilityAction,handleVisibility:handleShopOnboardingVisibilityChange,swipeTarget:getShopOnboardingSwipeTarget,readImages:readShopOnboardingImages,active:()=>shopOnboardingActive,resumeState:()=>shopOnboardingResumeState})",
].join("\n");
function createFlow({currentUser=null,cloudAccount=null,pendingAuthenticationIntent=null,activeView="home",reducedMotion=false}={}){
  const values = new Map();
  const storage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(String(key), String(value)),
    removeItem: key => values.delete(String(key)),
  };
  const listeners = new Map();
  const timers=new Map();
  const classes=new Set();
  const rootClasses=new Set();
  const bodyClasses=new Set();
  const pageClassList=target=>({add(name){target.add(name);},remove(name){target.delete(name);},contains(name){return target.has(name);}});
  const preloadedImageUrls=[];
  class WarmImage {
    decoding="";
    set src(value){this.url=value;preloadedImageUrls.push(value);}
    get src(){return this.url||"";}
  }
  let timerSequence=0;
  let renderedDots="";
  let renderCount=0;
  let openedView=activeView;
  let openedOnboarding=false;
  let openMainOptions=null;
  let authMode=false;
  const layer = {
    hidden: false,
    inert: false,
    dataset: {},
    setAttribute(){},
    addEventListener(name, callback){listeners.set(name, callback);},
    classList: {add(name){classes.add(name);},remove(name){classes.delete(name);},contains(name){return classes.has(name);}},
  };
  const image={hidden:false,alt:"",src:"",getAttribute(name){return name==="src"?this.src:null;}};
  const dots={setAttribute(){},set innerHTML(value){renderedDots=value;renderCount++;},get innerHTML(){return renderedDots;}};
  const nextButton={hidden:false,setAttribute(){},focus(){}};
  const choices={hidden:true};
  const authPage={inert:false,style:{display:"none"}};
  const mainApp={inert:false,style:{display:"block"}};
  const app={classList:{add(name){if(name==="auth-mode")authMode=true;},remove(name){if(name==="auth-mode")authMode=false;},contains(name){return name==="auth-mode"&&authMode;},toggle(name,force){if(name==="auth-mode")authMode=force;}}};
  const pageView=(id,active)=>{const viewTokens=new Set(active?["active"]:[]);return {scrollTop:0,classList:{add(name){viewTokens.add(name);},remove(name){viewTokens.delete(name);},contains(name){return viewTokens.has(name);},toggle(name,force){force?viewTokens.add(name):viewTokens.delete(name);}}};};
  const viewElements=new Map(["home","search","cart","profile","detail","owner"].map(view=>[`${view}View`,pageView(`${view}View`,activeView===view)]));
  const searchInput={value:""};
  const elements=new Map([
    ["shopPromoOnboarding",layer],
    ["shopPromoOnboardingImage",image],
    ["shopPromoOnboardingStep",{textContent:""}],
    ["shopPromoOnboardingDots",dots],
    ["shopPromoOnboardingNext",nextButton],
    ["shopPromoOnboardingChoices",choices],
    ["shopPromoOnboardingCreateAccount",{focus(){}}],
    ["authPage",authPage],
    ["mainApp",mainApp],
    ...viewElements,
    ["searchPageInput",searchInput],
  ]);
  let authScreen = "";
  let openedShop = false;
  const runtime = {
    localStorage: storage,
    safeImageUrl: value => /^(https:\/\/|\/api\/media\/shop\/)/i.test(String(value || "")) ? String(value) : "",
    currentUser,
    cloudAccount,
    pendingAuthenticationIntent,
    window: {scrollY:0,scrollTo(_x,y){this.scrollY=Number(y)||0;},matchMedia:()=>({matches:reducedMotion})},
    Image: WarmImage,
    setTimeout: (callback,delay) => { const id=++timerSequence; timers.set(id,{callback,delay}); return id; },
    clearTimeout: id => timers.delete(id),
    document: { documentElement:{style:{scrollBehavior:"smooth"},scrollTop:0,classList:pageClassList(rootClasses)}, getElementById: id => elements.get(id)||null, querySelector: selector => selector===".app"?app:null, body:{scrollTop:0,classList:pageClassList(bodyClasses)} },
    requestAnimationFrame: callback => callback(),
    showShopOnboarding: () => { layer.hidden = false; openedOnboarding = true; },
    showAuth: type => { authScreen = type; },
    openMain: options => { openedShop = true; openMainOptions = options; if(options?.resumeIntent!==false&&runtime.pendingAuthenticationIntent?.type==="profile")openedView="profile"; },
    openView: view => { openedView = view; },
  };
  const flow = runInNewContext(flowSource, runtime);
  return { flow, runtime, storage, layer, image, dots, nextButton, choices, authPage, mainApp, elements, listeners, classes, rootClasses, bodyClasses, preloadedImageUrls, runTimers(){const pending=[...timers.values()];timers.clear();pending.forEach(timer=>timer.callback());}, pendingTimerDelays(){return [...timers.values()].map(timer=>timer.delay);}, get authScreen(){return authScreen;}, get authMode(){return authMode;}, get openedShop(){return openedShop;}, get openedView(){return openedView;}, get openedOnboarding(){return openedOnboarding;}, get openMainOptions(){return openMainOptions;}, get renderCount(){return renderCount;} };
}

const guestFlow = createFlow();
guestFlow.storage.setItem('shivan_shop_web_onboarding_completed', '1');
assert.equal(guestFlow.flow.view(), 'onboarding', 'every page launch starts onboarding even if an old persistent completion flag exists');
guestFlow.flow.showIfNeeded();
assert.equal(guestFlow.rootClasses.has("shop-promo-onboarding-open"), true, "startup should lock the document root against scrolling");
assert.equal(guestFlow.bodyClasses.has("shop-promo-onboarding-open"), true, "startup should lock the body against scrolling");
guestFlow.flow.render();
assert.deepEqual(guestFlow.preloadedImageUrls, ["https://fallback.example.test/1.jpg", "https://fallback.example.test/2.jpg", "https://fallback.example.test/3.jpg"], "the existing images should be warmed once to reduce blank frames during slide changes");
assert.equal(guestFlow.layer.hidden, false, 'the first slide should show at startup');
assert.equal(guestFlow.image.src, 'https://fallback.example.test/1.jpg', 'slide one should show the first shared image');
assert.equal(guestFlow.layer.dataset.direction, 'forward', 'entering a slide should use a horizontal forward transition');
assert.equal((guestFlow.dots.innerHTML.match(/active/g)||[]).length, 1, 'slide one should have one active progress indicator');
assert.equal(guestFlow.nextButton.hidden, false, 'slide one should show Next');
assert.equal(guestFlow.choices.hidden, true, 'account and shop choices should wait until slide three');
guestFlow.flow.advance();
assert.equal(guestFlow.flow.index(), 1, "the first Next should advance only one slide");
assert.equal(guestFlow.image.src, 'https://fallback.example.test/2.jpg', 'slide two should show the second shared image');
assert.equal((guestFlow.dots.innerHTML.match(/active/g)||[]).length, 2, 'slide two should have two active progress indicators');
assert.equal(guestFlow.nextButton.hidden, false, 'slide two should show Next');
assert.equal(guestFlow.flow.locked(), true, "slide input should be locked while the transition runs");
assert.deepEqual(guestFlow.pendingTimerDelays(), [340], "normal motion should hold the double-tap guard through the 300ms transition");
assert.equal(guestFlow.classes.has('is-transitioning'), true, "the active slide change should apply its transition class");
guestFlow.flow.advance();
assert.equal(guestFlow.flow.index(), 1, "a rapid second tap must not skip slide two");
assert.equal((guestFlow.dots.innerHTML.match(/active/g)||[]).length, 2, "the active dot should update immediately for slide two");
guestFlow.runTimers();
assert.equal(guestFlow.flow.locked(), false, "slide input should unlock after the transition interval");
assert.equal(guestFlow.classes.has('is-transitioning'), false, "the transition class should clear when the motion completes");
guestFlow.flow.advance();
assert.equal(guestFlow.flow.index(), 2, 'navigation should reach the third slide');
assert.equal(guestFlow.image.src, 'https://fallback.example.test/3.jpg', 'slide three should show the third shared image');
assert.equal((guestFlow.dots.innerHTML.match(/active/g)||[]).length, 3, 'slide three should show all progress indicators');
assert.equal(guestFlow.nextButton.hidden, true, 'slide three should not show Next');
assert.equal(guestFlow.choices.hidden, false, 'slide three should show Create Account and Explore Models');
guestFlow.flow.advance();
assert.equal(guestFlow.layer.hidden, false, 'advancing on slide three should not bypass its two explicit choices');
assert.equal(guestFlow.storage.getItem('shivan_shop_web_onboarding_completed'), '1', 'an old marker is ignored and left untouched');

const exploreFlow = createFlow({pendingAuthenticationIntent:{type:'profile'},activeView:'profile'});
exploreFlow.flow.showIfNeeded();
exploreFlow.flow.advance();
exploreFlow.runTimers();
exploreFlow.flow.advance();
assert.equal(exploreFlow.flow.finish(), true, 'Explore Models should start the existing shop handoff');
assert.equal(exploreFlow.layer.hidden, false, 'the onboarding overlay should remain visible until its exit transition completes');
assert.equal(exploreFlow.classes.has('is-handoff-exiting'), true, 'Explore Models should use the handoff exit animation');
assert.equal(exploreFlow.layer.inert, true, 'the outgoing onboarding controls should be inert during the handoff');
assert.equal(exploreFlow.flow.handoffLocked(), true, 'the destination handoff should lock repeated button taps');
assert.deepEqual(exploreFlow.pendingTimerDelays(), [260], 'the page-opening transition should last 260ms');
assert.equal(exploreFlow.flow.finish(), false, 'a repeated Explore Models tap during handoff should be ignored');
assert.equal(exploreFlow.rootClasses.has("shop-promo-onboarding-open"), true, 'scroll should remain locked until the visual handoff is complete');
exploreFlow.runTimers();
assert.equal(exploreFlow.layer.hidden, true, 'Explore Models should dismiss the slides after the transition');
assert.equal(exploreFlow.layer.inert, false, 'the hidden onboarding layer should be reset for the next app entry');
assert.equal(exploreFlow.rootClasses.has("shop-promo-onboarding-open"), false, "Explore Models should restore root scrolling");
assert.equal(exploreFlow.bodyClasses.has("shop-promo-onboarding-open"), false, "Explore Models should restore body scrolling");
assert.equal(exploreFlow.openedShop, true, 'Explore Models should open the existing shop');
assert.equal(exploreFlow.openedView, 'home', 'Explore Models should land on model selection');
assert.equal(exploreFlow.openMainOptions.resumeIntent, false, 'onboarding must not resume stale authentication redirects');
assert.equal(exploreFlow.runtime.pendingAuthenticationIntent.type, 'profile', 'onboarding does not erase pending account data');

const accountFlow = createFlow({currentUser:{id:'saved-customer'},pendingAuthenticationIntent:{type:'profile'}});
const preservedSession=JSON.stringify({accountId:'saved-customer'});
const preservedCart=JSON.stringify([{productId:'p2',qty:1}]);
accountFlow.storage.setItem('test-session',preservedSession);
accountFlow.storage.setItem('test-cart',preservedCart);
accountFlow.flow.show();
accountFlow.flow.advance();
accountFlow.runTimers();
accountFlow.flow.advance();
accountFlow.runTimers();
assert.equal(accountFlow.flow.signup(),true,'Create Account should start the existing registration handoff');
assert.equal(accountFlow.layer.hidden,false,'the overlay should remain visible through the registration transition');
assert.equal(accountFlow.classes.has('is-handoff-exiting'),true,'Create Account should use the shared handoff animation');
assert.equal(accountFlow.flow.signup(),false,'a second Create Account tap during handoff should be ignored');
assert.equal(accountFlow.authScreen,'signup','the existing registration form should be prepared behind the overlay');
accountFlow.runTimers();
assert.equal(accountFlow.layer.hidden,true,'the registration transition should finish by dismissing onboarding');
assert.equal(accountFlow.rootClasses.has("shop-promo-onboarding-open"), false, "Create Account should restore root scrolling");
assert.equal(accountFlow.bodyClasses.has("shop-promo-onboarding-open"), false, "Create Account should restore body scrolling");
assert.equal(accountFlow.authMode,true,'Create Account should open the existing full-screen account flow');
assert.equal(accountFlow.authScreen,'signup','Create Account should select the existing registration form');
assert.equal(accountFlow.mainApp.style.display,'none','registration should replace the shop behind onboarding');
assert.equal(accountFlow.authPage.style.display,'','the existing authentication area should be displayed');
assert.equal(accountFlow.runtime.currentUser.id,'saved-customer','opening registration should not discard the current session');
assert.equal(accountFlow.storage.getItem('test-session'),preservedSession,'registration navigation should preserve the saved session');
assert.equal(accountFlow.storage.getItem('test-cart'),preservedCart,'registration navigation should preserve the cart');

const reducedExploreFlow=createFlow({reducedMotion:true});
reducedExploreFlow.flow.show();
reducedExploreFlow.flow.advance();
reducedExploreFlow.runTimers();
reducedExploreFlow.flow.advance();
assert.equal(reducedExploreFlow.flow.finish(),true,'reduced-motion Explore Models should still open the existing shop');
assert.equal(reducedExploreFlow.layer.hidden,true,'reduced-motion handoffs should complete immediately');
assert.deepEqual(reducedExploreFlow.pendingTimerDelays(),[],'reduced-motion Explore Models should not wait on an animation timer');
assert.equal(reducedExploreFlow.rootClasses.has('shop-promo-onboarding-open'),false,'immediate Explore Models should restore page scrolling');

const reducedAccountFlow=createFlow({reducedMotion:true});
reducedAccountFlow.flow.show();
reducedAccountFlow.flow.advance();
reducedAccountFlow.runTimers();
reducedAccountFlow.flow.advance();
reducedAccountFlow.flow.signup();
assert.equal(reducedAccountFlow.layer.hidden,true,'reduced-motion Create Account should complete immediately');
assert.equal(reducedAccountFlow.authScreen,'signup','reduced-motion Create Account should keep the existing registration destination');
assert.deepEqual(reducedAccountFlow.pendingTimerDelays(),[],'reduced-motion Create Account should not wait on an animation timer');

const missingLayerFlow=createFlow();
missingLayerFlow.flow.show();
missingLayerFlow.elements.delete("shopPromoOnboarding");
missingLayerFlow.flow.hide();
assert.equal(missingLayerFlow.rootClasses.has("shop-promo-onboarding-open"),false,"closing onboarding should unlock document scrolling even if the overlay element was removed");
assert.equal(missingLayerFlow.bodyClasses.has("shop-promo-onboarding-open"),false,"closing onboarding should unlock body scrolling even if the overlay element was removed");

const savedCustomer = { id:'saved-customer', name:'Existing Customer', role:'customer' };
const savedSession = JSON.stringify({ accountId:savedCustomer.id });
const signedInFlow = createFlow({currentUser:savedCustomer,activeView:'profile'});
signedInFlow.storage.setItem('test-account-session', savedSession);
signedInFlow.storage.setItem('test-cart', JSON.stringify([{productId:'p1',qty:2}]));
signedInFlow.flow.showIfNeeded();
assert.equal(signedInFlow.layer.hidden, false, 'signed-in customers also see onboarding on a new app entry');
assert.equal(signedInFlow.runtime.currentUser, savedCustomer, 'the existing signed-in account remains active behind onboarding');
assert.equal(signedInFlow.storage.getItem('test-account-session'), savedSession, 'onboarding preserves the saved account session');
assert.equal(signedInFlow.storage.getItem('test-cart'), JSON.stringify([{productId:'p1',qty:2}]), 'onboarding preserves the cart');
signedInFlow.flow.advance();
signedInFlow.runTimers();
signedInFlow.flow.advance();
signedInFlow.runTimers();
signedInFlow.flow.advance();
assert.equal(signedInFlow.layer.hidden, false, 'the last Next should reveal the final action choices, not dismiss onboarding');
signedInFlow.flow.finish();
signedInFlow.runTimers();
assert.equal(signedInFlow.layer.hidden, true, 'Explore Models dismisses onboarding');
assert.equal(signedInFlow.openedView, 'home', 'completion opens model selection');
assert.equal(signedInFlow.runtime.currentUser, savedCustomer, 'completion preserves the signed-in account');
assert.equal(signedInFlow.storage.getItem('test-account-session'), savedSession, 'completion does not rewrite account storage');
assert.equal(signedInFlow.storage.getItem('test-cart'), JSON.stringify([{productId:'p1',qty:2}]), 'completion preserves the cart');

const swipeFlow = createFlow();
swipeFlow.flow.show();
swipeFlow.flow.setup(swipeFlow.layer);
const pointer = (x,y,pointerId=1,target={closest:()=>null})=>({clientX:x,clientY:y,pointerId,isPrimary:true,target});
swipeFlow.listeners.get('pointerdown')(pointer(300,100));
swipeFlow.listeners.get('pointerup')(pointer(220,105));
assert.equal(swipeFlow.flow.index(), 1, 'a left swipe advances from slide one to slide two');
swipeFlow.listeners.get('pointerdown')(pointer(300,100));
swipeFlow.listeners.get('pointerup')(pointer(220,105));
assert.equal(swipeFlow.flow.index(), 1, "a repeated swipe during the transition must not skip a slide");
swipeFlow.runTimers();
swipeFlow.listeners.get('pointerdown')(pointer(300,100));
swipeFlow.listeners.get('pointerup')(pointer(220,100));
assert.equal(swipeFlow.flow.index(), 2, 'a left swipe advances from slide two to slide three');
swipeFlow.runTimers();
swipeFlow.listeners.get('pointerdown')(pointer(220,100));
swipeFlow.listeners.get('pointerup')(pointer(300,100));
assert.equal(swipeFlow.flow.index(), 1, 'a right swipe returns to the previous slide');
assert.equal(swipeFlow.layer.dataset.direction, 'backward', 'right swipes should use a reverse horizontal transition');
swipeFlow.runTimers();
swipeFlow.listeners.get('pointerdown')(pointer(300,100));
swipeFlow.listeners.get('pointerup')(pointer(290,180));
assert.equal(swipeFlow.flow.index(), 1, 'vertical scrolling is not mistaken for a swipe');
swipeFlow.listeners.get('pointerdown')(pointer(300,100,1,{closest:()=>({})}));
swipeFlow.listeners.get('pointerup')(pointer(220,100));
assert.equal(swipeFlow.flow.index(), 1, 'swiping from a button does not trigger slide navigation');
swipeFlow.flow.advance();
swipeFlow.runTimers();
swipeFlow.listeners.get('pointerdown')(pointer(300,100));
swipeFlow.listeners.get('pointerup')(pointer(220,100));
assert.equal(swipeFlow.layer.hidden, false, 'the final slide should remain until the user selects one of its two actions');
assert.equal(swipeFlow.flow.index(),2,'a left swipe beyond slide three stays on the final slide');
assert.equal(swipeFlow.flow.swipeTarget(2,300,100,220,100), 2, 'the last-slide swipe target stays clamped');
assert.equal(swipeFlow.flow.swipeTarget(0,220,100,300,100), 0, 'swiping before the first slide stays on slide one');

const reducedMotionFlow=createFlow({reducedMotion:true});
reducedMotionFlow.flow.show();
reducedMotionFlow.flow.advance();
assert.equal(reducedMotionFlow.flow.index(),1,"Next should remain functional when reduced motion is enabled");
assert.equal(reducedMotionFlow.classes.has('is-transitioning'),false,"reduced-motion users should not receive the slide animation");
assert.deepEqual(reducedMotionFlow.pendingTimerDelays(),[120],"reduced motion should retain only a short duplicate-input guard");
reducedMotionFlow.flow.advance();
assert.equal(reducedMotionFlow.flow.index(),1,"rapid input remains guarded for reduced-motion users too");
reducedMotionFlow.runTimers();
reducedMotionFlow.flow.advance();
assert.equal(reducedMotionFlow.flow.index(),2,"the next slide remains reachable after the short reduced-motion guard");

const lifecycleFlow = createFlow();
lifecycleFlow.flow.show();
lifecycleFlow.flow.advance();
assert.equal(lifecycleFlow.flow.handleVisibility(false), false, 'ordinary page navigation does not replay onboarding');
lifecycleFlow.flow.advance();
lifecycleFlow.flow.handleVisibility(true);
assert.equal(lifecycleFlow.flow.handleVisibility(false), true, 'returning from a hidden app replays onboarding');
assert.equal(lifecycleFlow.flow.index(), 0, 're-entry restarts at slide one');
lifecycleFlow.runtime.openView('search');
assert.equal(lifecycleFlow.flow.handleVisibility(false), false, 'navigation inside the active session does not replay the slides');
const hiddenDuringStartup=lifecycleFlow.flow.visibility(true,false,true);
assert.equal(hiddenDuringStartup.wasHidden,true);
assert.equal(hiddenDuringStartup.show,false);
const returnedDuringStartup=lifecycleFlow.flow.visibility(false,true,false);
assert.equal(returnedDuringStartup.wasHidden,false);
assert.equal(returnedDuringStartup.show,false,'a hidden interval during startup does not replace the initial splash handoff');

const resumeFlow=createFlow({activeView:"search"});
resumeFlow.runtime.window.scrollY=468;
resumeFlow.elements.get("searchView").scrollTop=27;
resumeFlow.flow.handleVisibility(true);
assert.equal(resumeFlow.flow.handleVisibility(false),true,"foreground return should replay onboarding");
assert.equal(resumeFlow.flow.resumeState().view,"search","foreground onboarding should remember the exact current section");
assert.equal(resumeFlow.flow.resumeState().position.windowY,468,"foreground onboarding should remember the page scroll position");
resumeFlow.flow.finish();
assert.equal(resumeFlow.layer.hidden,false,"foreground onboarding stays in place while restoring the previous browsing context");
resumeFlow.runTimers();
assert.equal(resumeFlow.openedShop,false,"finishing foreground onboarding must not reinitialize the shop");
assert.equal(resumeFlow.openedView,"search","finishing foreground onboarding should remain on Search");
assert.equal(resumeFlow.runtime.window.scrollY,468,"finishing foreground onboarding should restore the prior page position");
assert.equal(resumeFlow.elements.get("searchView").scrollTop,27,"finishing foreground onboarding should restore the prior section scroll");
assert.equal(resumeFlow.rootClasses.has("shop-promo-onboarding-open"),false,"foreground onboarding completion should unlock document scrolling");

const authResumeFlow=createFlow({activeView:"profile"});
authResumeFlow.mainApp.style.display="none";
authResumeFlow.authPage.style.display="";
authResumeFlow.runtime.document.querySelector(".app").classList.add("auth-mode");
authResumeFlow.runtime.window.scrollY=116;
authResumeFlow.authPage.scrollTop=72;
authResumeFlow.flow.handleVisibility(true);
authResumeFlow.flow.handleVisibility(false);
authResumeFlow.flow.finish();
authResumeFlow.runTimers();
assert.equal(authResumeFlow.openedShop,false,"foreground onboarding must not replace an active Login / Sign Up screen with Shop");
assert.equal(authResumeFlow.mainApp.style.display,"none","the auth screen remains visible after foreground onboarding");
assert.equal(authResumeFlow.authPage.style.display,"","the auth screen remains visible after foreground onboarding");
assert.equal(authResumeFlow.authPage.scrollTop,72,"the auth screen scroll position is restored");

// Exercise the production route function with a small DOM stub. The overlay is
// dismissed before the route sequence, and every destination must retain the
// normal root/body scrolling state.
const navClasses=new Map();
const navNode=id=>({id,hidden:false,inert:false,style:{display:""},classList:{
  add(name){const current=navClasses.get(id)||new Set();current.add(name);navClasses.set(id,current);},
  remove(name){const current=navClasses.get(id)||new Set();current.delete(name);navClasses.set(id,current);},
  toggle(name,enabled){const current=navClasses.get(id)||new Set();enabled?current.add(name):current.delete(name);navClasses.set(id,current);},
  contains(name){return (navClasses.get(id)||new Set()).has(name);},
},setAttribute(){}});
const navIds=["shopPromoOnboarding","homeView","searchView","cartView","ordersView","profileView","detailView","ownerView","navHome","navSearch","navCart","navOrders","navProfile","ownerPanelButton","navAnalytics","authenticatedProfileCard","profileGuestAccess"];
const navElements=new Map(navIds.map(id=>[id,navNode(id)]));
navElements.get("shopPromoOnboarding").hidden=true;
navClasses.set("homeView",new Set(["active"]));
const navRootClasses=new Set(["shop-promo-onboarding-open"]);
const navBodyClasses=new Set(["shop-promo-onboarding-open"]);
const navPageList=target=>({
  add(name){target.add(name);},remove(name){target.delete(name);},contains(name){return target.has(name);},
  toggle(name,enabled){enabled?target.add(name):target.delete(name);},
});
const navDocument={
  addEventListener(){},
  documentElement:{style:{scrollBehavior:"smooth"},scrollTop:0,classList:navPageList(navRootClasses)},body:{scrollTop:0,classList:navPageList(navBodyClasses)},
  getElementById:id=>navElements.get(id)||null,
  querySelectorAll:selector=>selector===".nav-item"?[navElements.get("navHome"),navElements.get("navSearch"),navElements.get("navCart"),navElements.get("navOrders"),navElements.get("navProfile"),navElements.get("ownerPanelButton"),navElements.get("navAnalytics")]:[],
  querySelector:selector=>selector===".app"?navNode("app"):null,
};
let routeRuntime;
routeRuntime={
  document:navDocument,window:{scrollY:0,history:{state:null,pushState(state){this.state=state;},replaceState(state){this.state=state;}},addEventListener(){},scrollTo(_x,y){this.scrollY=Number(y)||0;}},productDetailClosing:false,shopOnboardingActive:true,shopViewScrollPositions:new Map(),ownerPanelRefreshPending:false,
  SHOP_HISTORY_VIEWS:new Set(["home","search","cart","orders","profile","owner"]),shopViewNavigationPopHandler:null,shopViewNavigationScrollHandler:null,
  currentUser:{id:"offline-customer"},cloudAccount:null,pendingAuthenticationIntent:null,ownerPanel:"products",
  getActiveShopView(){return ["home","search","cart","orders","profile","detail","owner"].find(view=>navClasses.get(`${view}View`)?.has("active"))||"home";},
  readShopViewPosition(){return {windowY:0,viewTop:0,authTop:0};},ownerPanelHasPendingWork:()=>false,
  hideShopOnboarding(){routeRuntime.shopOnboardingActive=false;navRootClasses.delete("shop-promo-onboarding-open");navBodyClasses.delete("shop-promo-onboarding-open");navElements.get("shopPromoOnboarding").hidden=true;},
  restoreProfileAuthCard(){},closeDetailImageFullscreen(){},isOwner:()=>true,showToast(){},renderCart(){},renderOrders(){},renderOwnerPanel(){},updateProfile(){},showGuestProfileChoices(){},requestAnimationFrame(callback){callback();},syncDetailPhotoTracks(){},
};
const routeHelpers=["shopViewHistoryState","writeShopViewHistory","installShopViewNavigation"].map(extractFunction).join("\n");
const routeFunction=runInNewContext(`${routeHelpers}\n${extractFunction("openView")}\nopenView`,routeRuntime);
for(const view of ["home","search","orders","profile","owner"]){
  routeFunction(view);
  assert.ok(navClasses.get(`${view}View`)?.has("active"),`${view} navigation should activate its expected view`);
  assert.equal(navRootClasses.has("shop-promo-onboarding-open"),false,`${view} should not inherit the onboarding root scroll lock`);
  assert.equal(navBodyClasses.has("shop-promo-onboarding-open"),false,`${view} should not inherit the onboarding body scroll lock`);
}

const imageFlow = createFlow();
const savedSlideImages = ['https://cdn.example.test/first.webp', 'https://cdn.example.test/second.webp', 'https://cdn.example.test/third.webp'];
imageFlow.storage.setItem(sharedImageKey, JSON.stringify(savedSlideImages));
assert.deepEqual(Array.from(imageFlow.flow.readImages()), savedSlideImages, 'a refresh should retain the existing three shared image URLs');
imageFlow.flow.show();
assert.deepEqual(imageFlow.preloadedImageUrls, savedSlideImages, 'only the currently configured shared slides should be warmed');
const storage=imageFlow.storage;

const apiUrl = `data:text/javascript;base64,${Buffer.from(apiSource).toString("base64")}`;
const { onRequest } = await import(apiUrl);

class OfflineD1 {
  shop = new Map();
  accounts = new Map();
  sessions = new Map();
  prepare(sql) {
    const statement = {
      sql, values: [],
      bind: (...values) => { statement.values = values; return statement; },
      first: async () => this.first(statement.sql, statement.values),
      all: async () => this.all(statement.sql, statement.values),
      run: async () => this.run(statement.sql, statement.values),
    };
    return statement;
  }
  async first(sql, values) {
    if (sql.includes("FROM sessions s JOIN accounts a")) {
      const session = this.sessions.get(values[0]);
      if (!session || session.expiresAt <= values[1]) return null;
      const account = this.accounts.get(session.accountId);
      return account ? { id: account.id, identifier: account.identifier, name: account.name, role: account.role } : null;
    }
    if (sql.includes("FROM shop_state WHERE key=?")) {
      const value = this.shop.get(values[0]);
      return value === undefined ? null : { value };
    }
    return null;
  }
  async all(sql) {
    if (sql.includes("FROM shop_state")) {
      return { results: [...this.shop.entries()].filter(([key]) => !key.startsWith("media:")).map(([key, value]) => ({ key, value })) };
    }
    return { results: [] };
  }
  async run(sql, values) {
    if (sql.includes("INSERT INTO shop_state")) {
      const [key, value] = values;
      if (sql.includes("DO NOTHING") && this.shop.has(key)) return { success: true };
      this.shop.set(key, value);
    }
    return { success: true };
  }
}

const DB = new OfflineD1();
const MEDIA = {
  objects: new Map(),
  async put(key, bytes, options = {}) {
    this.objects.set(key, { bytes: new Uint8Array(bytes), contentType: options.httpMetadata?.contentType || "" });
    return { key, size: bytes.byteLength };
  },
  async get(key) {
    const object = this.objects.get(key);
    if (!object) return null;
    return { body: new Uint8Array(object.bytes), writeHttpMetadata(headers) { if (object.contentType) headers.set("Content-Type", object.contentType); } };
  },
};
const ownerToken = "offline-onboarding-owner-session";
const customerToken = "offline-onboarding-customer-session";
const tokenHash = async token => Buffer.from(await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(token))).toString("base64url");
const expiresAt = Math.floor(Date.now() / 1000) + 3600;
DB.accounts.set("offline-owner", { id: "offline-owner", identifier: "07502342153", name: "Offline Owner", role: "owner" });
DB.accounts.set("offline-customer", { id: "offline-customer", identifier: "customer@example.test", name: "Offline Customer", role: "customer" });
DB.sessions.set(await tokenHash(ownerToken), { accountId: "offline-owner", expiresAt });
DB.sessions.set(await tokenHash(customerToken), { accountId: "offline-customer", expiresAt });
const env = { DB, MEDIA };
const api = request => onRequest({ request, env });
const ownerCookie = `shivan_session=${ownerToken}`;
const customerCookie = `shivan_session=${customerToken}`;
const uploadedUrls = [];

for (let index = 0; index < 3; index++) {
  const imageBytes = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 4, 0, 0, index, 0x57, 0x45, 0x42, 0x50, index + 1]);
  const response = await api(new Request("https://shop.test/api/media/upload", {
    method: "POST",
    headers: { Origin: "https://shop.test", "Content-Type": "image/webp", Cookie: ownerCookie },
    body: imageBytes,
  }));
  assert.equal(response.status, 201, `Owner slide image ${index + 1} should be uploaded into offline R2`);
  const image = await response.json();
  assert.equal(image.persisted, true, "the API should confirm R2 persistence for every slide image");
  const objectKey = image.url.replace(/^\/api\/media\//, "");
  assert.equal(MEDIA.objects.has(objectKey), true, "each promotional image's bytes should be stored in shared R2");
  uploadedUrls.push(image.url);
}
storage.setItem(sharedImageKey, JSON.stringify(uploadedUrls));
assert.deepEqual(Array.from(imageFlow.flow.readImages()), uploadedUrls, "a refreshed browser should reload the shared slide image URLs from its local cache");

const savedImages = JSON.stringify(uploadedUrls);
const write = request => api(new Request("https://shop.test/api/sync", {
  method: "PUT",
  headers: { "Content-Type": "application/json", ...(request.cookie ? { Cookie: request.cookie } : {}) },
  body: JSON.stringify({ key: sharedImageKey, value: request.value ?? savedImages }),
}));
const ownerSave = await write({ cookie: ownerCookie });
assert.equal(ownerSave.status, 200, "the authorized Owner should save all three shared slide image URLs");
assert.equal((await ownerSave.json()).persisted, true, "the shared settings row should be confirmed by D1");
assert.equal(DB.shop.get(sharedImageKey), savedImages, "the slide URL list should be stored in the shared D1 shop state");

const visitorRead = await api(new Request("https://shop.test/api/sync"));
assert.equal(visitorRead.status, 200, "a logged-out visitor should be able to read public onboarding settings");
assert.equal((await visitorRead.json()).shop[sharedImageKey], savedImages, "a second device should receive the same slide image URLs");
for (const imageUrl of uploadedUrls) {
  const imageRead = await api(new Request(`https://shop.test${imageUrl}`));
  assert.equal(imageRead.status, 200, "uploaded slide images should remain readable after refresh from another device");
  assert.equal(imageRead.headers.get("Content-Type"), "image/webp");
  assert.ok((await imageRead.arrayBuffer()).byteLength > 0, "the shared image URL should return the original R2 object bytes");
}

const customerWrite = await write({ cookie: customerCookie });
assert.equal(customerWrite.status, 403, "a customer must not replace Owner promotional slides");
const anonymousWrite = await write({ cookie: "" });
assert.equal(anonymousWrite.status, 401, "an anonymous visitor must not replace Owner promotional slides");
const invalidWrite = await write({ cookie: ownerCookie, value: JSON.stringify([uploadedUrls[0], "http://insecure.example.test/image.jpg", uploadedUrls[2]]) });
assert.equal(invalidWrite.status, 400, "the API should reject insecure or malformed slide image URLs");
assert.equal(DB.shop.get(sharedImageKey), savedImages, "rejected writes must not alter the previously saved slides");

console.log("Offline website onboarding checks passed: three shared image slides, Next and final account/shop choices, directional swipes and transitions, launch and foreground replay, no persistent completion state, signed-in account/cart preservation, R2-backed slide images with D1 URL persistence, cross-device reads, and server-enforced Owner-only writes.");
