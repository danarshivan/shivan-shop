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
const onboardingMarkup=html.match(/<section id="shopPromoOnboarding"[\s\S]*?<\/section>/)?.[0]||"";
assert.equal((onboardingMarkup.match(/<img\b/g)||[]).length, 1, "the onboarding overlay should contain a single reusable fashion image element");
const mediaMarkup=onboardingMarkup.match(/<div class="shop-promo-onboarding-media">[\s\S]*?<\/div>/)?.[0]||"";
assert.match(mediaMarkup, /<img id="shopPromoOnboardingImage"[\s\S]*?<\/div>/, "the existing fashion image should appear inside its framed media panel");
assert.match(mediaMarkup, /class="shop-promo-onboarding-shade"/, "the image panel should retain a subtle dark lower gradient");
assert.match(html, /\.shop-promo-onboarding-media\{[^}]*border:1px solid rgba\(183,137,255,/);
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
assert.match(html, /\.shop-promo-onboarding-brand span\{color:#fff/, "the brand wordmark should remain white");
assert.match(html, /linear-gradient\(0deg,rgba\(2,2,5,\.88\),rgba\(2,2,5,\.4\) 23%,transparent 50%\)/, "the lower black gradient should keep slide controls legible");
assert.match(onboardingMarkup, /id="shopPromoOnboardingNext"[^>]*onclick="advanceShopOnboarding\(\)"[^>]*>Next/, "slides one and two should provide a Next button");
assert.match(onboardingMarkup, /id="shopPromoOnboardingChoices"[^>]*hidden>[\s\S]*?onclick="startShopOnboardingSignup\(\)"[^>]*>Create Account[\s\S]*?onclick="finishShopOnboarding\(\)"[^>]*>Explore Models/, "the last slide should show the two requested choices");
assert.doesNotMatch(onboardingMarkup, /\bSkip\b|shopPromoOnboardingSkip/);
assert.ok(onboardingMarkup.indexOf('class="shop-promo-onboarding-actions"')<onboardingMarkup.indexOf('id="shopPromoOnboardingDots"'), "pagination dots should sit beneath the action buttons");
assert.match(html, /\.shop-promo-onboarding\{[^}]*#030306/);
assert.match(html, /linear-gradient\(180deg,#07050d 0%,#030306 62%,#020205 100%\)/);
assert.match(html, /\.shop-promo-onboarding-choices\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/, "the final choices should sit side by side on phones");
assert.match(html, /shopMotionOnboardingForward 300ms/);
assert.match(html, /shopMotionOnboardingBackward 300ms/);
assert.match(html, /prefers-reduced-motion:reduce\)[\s\S]*?\.shop-promo-onboarding-content/);
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
assert.match(html, /data-owner-tab="onboarding"/);
assert.match(html, /uploadOwnerImage\(input,`shopPromoImageData\$\{index\}`,`shopPromoImagePreview\$\{index\}`,"ad"\)/);
assert.match(extractFunction("renderShopOnboardingOwnerEditor"), /if\(!isOwner\(\)\)/, "the Owner editor must check the current role");
assert.match(extractFunction("saveShopOnboardingImages"), /cloudAccount\?\.role!=="owner"/, "the client editor must require the shared Owner account");
assert.match(extractFunction("saveShopOnboardingImages"), /SHOP_ONBOARDING_IMAGES_KEY/);
assert.match(extractFunction("saveShopOnboardingImages"), /originalStorageSetItem\.call\(localStorage,SHOP_ONBOARDING_IMAGES_KEY,value\)/, "a confirmed save should update the local mirror used by the existing sync flow");
assert.match(extractFunction("renderOwnerPanel"), /section==="onboarding"\) renderShopOnboardingOwnerEditor/);
assert.match(extractFunction("showShopOnboardingIfNeeded"), /getShopOnboardingStartupView/);
assert.match(extractFunction("finishShopOnboarding"), /openMain\(\{resumeIntent:false\}\);\s*openView\("home"\)/, "Explore Models must enter Shop without replaying a pending intent");
assert.match(extractFunction("startShopOnboardingSignup"), /showAuth\("signup"\)/, "Create Account should use the existing sign-up screen");
assert.match(extractFunction("startShopOnboardingSignup"), /hideShopOnboarding\(\)[\s\S]*?mainApp\.style\.display="none"[\s\S]*?authPage\.style\.display=""/, "registration should replace onboarding without recreating account state");
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
  "getShopOnboardingVisibilityAction", "prefersReducedShopOnboardingMotion", "warmShopOnboardingImages", "renderShopOnboardingSlide", "moveShopOnboardingTo",
  "advanceShopOnboarding", "startShopOnboardingSignup",
  "finishShopOnboarding", "setupShopOnboardingGestures", "showShopOnboardingIfNeeded", "showShopOnboarding",
  "handleShopOnboardingVisibilityChange",
];
const flowSource = [
  `const SHOP_ONBOARDING_IMAGES_KEY = "${sharedImageKey}";`,
  "const SHOP_ONBOARDING_SLIDE_COUNT = 3;",
  "const SHOP_ONBOARDING_TRANSITION_MS = 300;",
  "const SHOP_ONBOARDING_REDUCED_MOTION_GUARD_MS = 120;",
  "const shopOnboardingImagePreloads=new Map();",
  'const SHOP_ONBOARDING_DEFAULT_IMAGES = Object.freeze(["https://fallback.example.test/1.jpg", "https://fallback.example.test/2.jpg", "https://fallback.example.test/3.jpg"]);',
  "let shopOnboardingSlideIndex=0;",
  "let shopOnboardingLastRenderedIndex=-1;",
  "let shopOnboardingTransitionTimer=0;",
  "let shopOnboardingTransitionLocked=false;",
  "let shopOnboardingImages=[...SHOP_ONBOARDING_DEFAULT_IMAGES];",
  "let shopOnboardingActive=false;",
  "let shopAppWasHidden=false;",
  "let shopStartupCompleted=true;",
  ...[...flowNames, "readShopOnboardingImages"].map(extractFunction),
  "({advance:advanceShopOnboarding,move:moveShopOnboardingTo,signup:startShopOnboardingSignup,setup:setupShopOnboardingGestures,render:renderShopOnboardingSlide,index:()=>shopOnboardingSlideIndex,locked:()=>shopOnboardingTransitionLocked,view:getShopOnboardingStartupView,showIfNeeded:showShopOnboardingIfNeeded,show:showShopOnboarding,finish:finishShopOnboarding,visibility:getShopOnboardingVisibilityAction,handleVisibility:handleShopOnboardingVisibilityChange,swipeTarget:getShopOnboardingSwipeTarget,readImages:readShopOnboardingImages,active:()=>shopOnboardingActive})",
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
  const app={classList:{add(name){if(name==="auth-mode")authMode=true;},remove(name){if(name==="auth-mode")authMode=false;}}};
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
  ]);
  let authScreen = "";
  let openedShop = false;
  const runtime = {
    localStorage: storage,
    safeImageUrl: value => /^(https:\/\/|\/api\/media\/shop\/)/i.test(String(value || "")) ? String(value) : "",
    currentUser,
    cloudAccount,
    pendingAuthenticationIntent,
    window: {matchMedia:()=>({matches:reducedMotion})},
    Image: WarmImage,
    setTimeout: (callback,delay) => { const id=++timerSequence; timers.set(id,{callback,delay}); return id; },
    clearTimeout: id => timers.delete(id),
    document: { getElementById: id => elements.get(id)||null, querySelector: selector => selector===".app"?app:null, body:{classList:{add(){},remove(){}}} },
    requestAnimationFrame: callback => callback(),
    hideShopOnboarding: () => { layer.hidden = true; },
    showShopOnboarding: () => { layer.hidden = false; openedOnboarding = true; },
    showAuth: type => { authScreen = type; },
    openMain: options => { openedShop = true; openMainOptions = options; if(options?.resumeIntent!==false&&runtime.pendingAuthenticationIntent?.type==="profile")openedView="profile"; },
    openView: view => { openedView = view; },
  };
  const flow = runInNewContext(flowSource, runtime);
  return { flow, runtime, storage, layer, image, dots, nextButton, choices, authPage, mainApp, elements, listeners, classes, preloadedImageUrls, runTimers(){const pending=[...timers.values()];timers.clear();pending.forEach(timer=>timer.callback());}, pendingTimerDelays(){return [...timers.values()].map(timer=>timer.delay);}, get authScreen(){return authScreen;}, get authMode(){return authMode;}, get openedShop(){return openedShop;}, get openedView(){return openedView;}, get openedOnboarding(){return openedOnboarding;}, get openMainOptions(){return openMainOptions;}, get renderCount(){return renderCount;} };
}

const guestFlow = createFlow();
guestFlow.storage.setItem('shivan_shop_web_onboarding_completed', '1');
assert.equal(guestFlow.flow.view(), 'onboarding', 'every page launch starts onboarding even if an old persistent completion flag exists');
guestFlow.flow.showIfNeeded();
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
exploreFlow.flow.finish();
assert.equal(exploreFlow.layer.hidden, true, 'Explore Models should dismiss the promotional slides');
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
accountFlow.flow.signup();
assert.equal(accountFlow.layer.hidden,true,'Create Account should close the slide overlay');
assert.equal(accountFlow.authMode,true,'Create Account should open the existing full-screen account flow');
assert.equal(accountFlow.authScreen,'signup','Create Account should select the existing registration form');
assert.equal(accountFlow.mainApp.style.display,'none','registration should replace the shop behind onboarding');
assert.equal(accountFlow.authPage.style.display,'','the existing authentication area should be displayed');
assert.equal(accountFlow.runtime.currentUser.id,'saved-customer','opening registration should not discard the current session');
assert.equal(accountFlow.storage.getItem('test-session'),preservedSession,'registration navigation should preserve the saved session');
assert.equal(accountFlow.storage.getItem('test-cart'),preservedCart,'registration navigation should preserve the cart');

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
const ownerToken = "offline-onboarding-owner-session";
const customerToken = "offline-onboarding-customer-session";
const tokenHash = async token => Buffer.from(await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(token))).toString("base64url");
const expiresAt = Math.floor(Date.now() / 1000) + 3600;
DB.accounts.set("offline-owner", { id: "offline-owner", identifier: "owner@example.test", name: "Offline Owner", role: "owner" });
DB.accounts.set("offline-customer", { id: "offline-customer", identifier: "customer@example.test", name: "Offline Customer", role: "customer" });
DB.sessions.set(await tokenHash(ownerToken), { accountId: "offline-owner", expiresAt });
DB.sessions.set(await tokenHash(customerToken), { accountId: "offline-customer", expiresAt });
const env = { DB };
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
  assert.equal(response.status, 201, `Owner slide image ${index + 1} should be uploaded into offline D1`);
  const image = await response.json();
  assert.equal(image.persisted, true, "the API should confirm D1 persistence for every slide image");
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
}

const customerWrite = await write({ cookie: customerCookie });
assert.equal(customerWrite.status, 403, "a customer must not replace Owner promotional slides");
const anonymousWrite = await write({ cookie: "" });
assert.equal(anonymousWrite.status, 401, "an anonymous visitor must not replace Owner promotional slides");
const invalidWrite = await write({ cookie: ownerCookie, value: JSON.stringify([uploadedUrls[0], "http://insecure.example.test/image.jpg", uploadedUrls[2]]) });
assert.equal(invalidWrite.status, 400, "the API should reject insecure or malformed slide image URLs");
assert.equal(DB.shop.get(sharedImageKey), savedImages, "rejected writes must not alter the previously saved slides");

console.log("Offline website onboarding checks passed: three shared image slides, Next and final account/shop choices, directional swipes and transitions, launch and foreground replay, no persistent completion state, signed-in account/cart preservation, shared image URLs, offline D1 persistence, cross-device reads, and server-enforced Owner-only writes.");
