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
const sharedImageKey=html.match(/const SHOP_ONBOARDING_IMAGES_KEY = "([^"]+)";/)?.[1];
assert.equal(sharedImageKey,"shivan_shop_ios_onboarding_images","Owner-managed slide storage key remains shared");
assert.equal(html.match(/const SHOP_ONBOARDING_COMPLETED_KEY = "([^"]+)";/)?.[1],"shivan_shop_startup_choice_completed","a selected welcome destination is persisted");
assert.match(html,/SHOP_BRANDED_SPLASH_MS=shopStartupPrefersReducedMotion\?300:2000/);
assert.match(html,/SHOP_BRANDED_SPLASH_EXIT_MS=shopStartupPrefersReducedMotion\?0:500/);
const splashMarkup=html.match(/<section id="shopStartupSplash"[\s\S]*?<\/section>/)?.[0]||"";
assert.match(splashMarkup,/shivan-shop-neon-brand\.png/);
assert.equal((splashMarkup.match(/<img\b/g)||[]).length,1);
const splashCss=html.match(/\.shop-startup-splash\{[^}]*\}/)?.[0]||"";
const welcomeLayerCss=html.match(/html \.shop-promo-onboarding\{[^}]*\}/)?.[0]||"";
assert.ok(Number(splashCss.match(/z-index:(\d+)/)?.[1]||0)>Number(welcomeLayerCss.match(/z-index:(\d+)/)?.[1]||0),"the same Splash logo remains above Welcome until a destination is selected");
assert.match(html,/\.shop-startup-splash\.is-onboarding-brand \.shop-startup-brand\{top:calc\(env\(safe-area-inset-top\)/,"the logo transitions from center to a responsive Welcome position");
assert.match(html,/function replayShopStartupFlow\(\)[\s\S]*?finishShopStartupSplash\(\)/);
const onboardingMarkup=html.match(/<section id="shopPromoOnboarding"[\s\S]*?<\/section>/)?.[0]||"";
assert.match(onboardingMarkup,/id="welcomeLanguageSelect"[^>]*aria-label="Language"/);
assert.equal((onboardingMarkup.match(/<img\b/g)||[]).length,0,"Welcome does not render a duplicate logo image");
assert.equal((html.match(/<img class="shop-startup-brand" src="\/assets\/branding\/shivan-shop-neon-brand\.png"/g)||[]).length,1,"Splash and Welcome use the same single logo node");
assert.match(onboardingMarkup,/class="shop-promo-onboarding-brand-art-wrap" aria-hidden="true"><\/div>/,"the Welcome layout reserves space while the Splash logo overlays it");
assert.doesNotMatch(onboardingMarkup,/shop-promo-onboarding-brand-art[^>]*shivan-shop-neon-brand\.png/);
assert.match(onboardingMarkup,/id="shopPromoOnboardingWelcomeHeading"[^>]*>WELCOME<\/h1>/);
assert.doesNotMatch(onboardingMarkup,/shopPromoOnboardingImage|shop-promo-onboarding-media/);
assert.equal((onboardingMarkup.match(/<button\b/g)||[]).length,2);
assert.match(onboardingMarkup,/id="shopPromoOnboardingCreateAccount"[^>]*onclick="startShopOnboardingSignup\(\)"[\s\S]*?id="shopPromoOnboardingExploreModels"[^>]*onclick="finishShopOnboarding\(\)"/);
assert.match(html,/html \.shop-promo-onboarding\{[^}]*#03020a/);
assert.match(html,/--onboarding-violet:#a84bff/);
const welcomeCssPosition=html.indexOf("html .shop-promo-onboarding{--onboarding-violet:#a84bff;");
assert.ok(welcomeCssPosition>=0&&welcomeCssPosition<html.indexOf("</head>"),"Welcome CSS must be in the page head stylesheet, not generated utility output");
assert.match(html,/linear-gradient\(110deg,#8b20ff,#c22cff 58%,#7f16eb\)/);
assert.match(html,/font:500 clamp\(32px,9vw,50px\)\/1\.08 Didot/);
assert.match(html,/background-image:linear-gradient\(110deg,#fff 0%,#f3e5ff 48%,#c68aff 100%\)!important/);
assert.match(html,/shopWelcomeHeadingIn 500ms[^}]*790ms/);
assert.match(html,/@keyframes shopWelcomeChoiceIn\{0%\{visibility:hidden;opacity:0;[^}]*\}1%\{visibility:visible;opacity:0;/,"staggered actions fade smoothly once they become visible and tappable");
assert.match(html,/shopPromoOnboardingCreateAccount\{animation:shopWelcomeChoiceIn 500ms[^}]*1290ms/);
assert.match(html,/shopPromoOnboardingExploreModels\{animation:shopWelcomeChoiceIn 500ms[^}]*1430ms/);
assert.match(html,/minmax\(0,clamp\(160px,30dvh,280px\)\)/);
assert.match(html,/@media\(max-width:360px\)\{\.shop-promo-onboarding-content\{padding-left:18px;padding-right:18px/);
const welcomeWidths=[320,375,390,430];
for(const width of welcomeWidths){
  const logoWidth=Math.min(width*.78,366)*.68;
  const horizontalPadding=width<=360?18:Math.min(width*.07,42);
  const actionsWidth=Math.min(480,width-horizontalPadding*2);
  assert.ok(logoWidth>0&&logoWidth<width,"the centered logo fits at "+width+"px");
  assert.ok(actionsWidth>0&&actionsWidth<=width-horizontalPadding*2,"Welcome actions fit at "+width+"px");
}
assert.match(html,/width:min\(78vw,366px\)/,"the splash logo scales to the requested phone widths");
assert.match(html,/shop-promo-onboarding-content\{[^}]*height:100%[^}]*safe-area-inset-top[^}]*safe-area-inset-bottom/);
assert.match(html,/@media\(min-width:700px\)\{html \.shop-promo-onboarding\{inset:50% auto auto 50%;width:min\(430px/);
assert.match(html,/@media\(prefers-reduced-motion:reduce\)\{\.shop-startup-brand/);
assert.match(extractFunction("warmShopOnboardingImages"),/new Set\(shopOnboardingImages\)/);
const defaultImages=html.match(/const SHOP_ONBOARDING_DEFAULT_IMAGES = Object\.freeze\(\[([\s\S]*?)\]\);/)?.[1]||"";
assert.equal((defaultImages.match(/https:\/\/images\.unsplash\.com\//g)||[]).length,3,"Owner promo images remain available");
assert.match(extractFunction("saveShopOnboardingImages"),/cloudAccount\?\.role!=="owner"/);
assert.match(extractFunction("finishShopOnboarding"),/saveShopOnboardingCompletion\(\)[\s\S]*?openMain\(\{resumeIntent:false\}\);\s*openView\("home"\)/);
assert.match(extractFunction("startShopOnboardingSignup"),/saveShopOnboardingCompletion\(\)[\s\S]*?showAuth\("signup"\)/);
assert.match(extractFunction("finishShopReturningWelcome"),/hideShopOnboarding\(\)[\s\S]*?openView\("home"/);
const logoutSource=html.match(/async function logout\(\)\{[\s\S]*?\n\}/)?.[0]||"";
assert.match(logoutSource,/SHOP_ONBOARDING_COMPLETED_KEY[\s\S]*?replayShopStartupFlow\(\)/);
assert.match(extractFunction("finishShopStartupSplash"),/shopStartupCompleted=true;[\s\S]*?showShopOnboardingIfNeeded\(\{startupReveal:true\}\)[\s\S]*?classList.add\("is-onboarding-brand"\)/,"startup hands the persistent logo to Welcome without fading it");
assert.equal(Number(html.match(/const SHOP_RETURNING_WELCOME_MS=(\d+);/)?.[1]),1700,"returning users see the completed Welcome reveal before automatic navigation");
const flowNames = [
  "isShopOnboardingCompleted", "saveShopOnboardingCompletion", "finishShopReturningWelcome",
  "getShopOnboardingStartupView", "getShopOnboardingVisibilityAction", "getActiveShopView", "readShopViewPosition",
  "captureShopOnboardingResumeState", "restoreShopOnboardingResumeState", "prefersReducedShopOnboardingMotion",
  "warmShopOnboardingImages", "renderShopOnboardingSlide", "beginShopOnboardingPageHandoff", "startShopOnboardingSignup",
  "finishShopOnboarding", "releaseShopStartupBrand", "hideShopOnboarding", "showShopOnboardingIfNeeded", "showShopOnboarding", "handleShopOnboardingVisibilityChange",
];
const flowSource = [
  'const SHOP_ONBOARDING_IMAGES_KEY = "shivan_shop_ios_onboarding_images";',
  'const SHOP_ONBOARDING_COMPLETED_KEY = "shivan_shop_startup_choice_completed";',
  "const SHOP_ONBOARDING_SLIDE_COUNT = 3;",
  "const SHOP_ONBOARDING_HANDOFF_MS = 260;",
  "const SHOP_RETURNING_WELCOME_MS = 1700;",
  "const SHOP_BRANDED_SPLASH_EXIT_MS = 500;",
  "let shopStartupSplashHideTimer=null;",
  'const shopStartupPrefersReducedMotion=window.matchMedia("(prefers-reduced-motion: reduce)").matches===true;',
  "const shopOnboardingImagePreloads=new Map();",
  'const SHOP_ONBOARDING_DEFAULT_IMAGES = Object.freeze(["https://fallback.example.test/1.jpg", "https://fallback.example.test/2.jpg", "https://fallback.example.test/3.jpg"]);',
  "let shopOnboardingHandoffTimer=0;",
  "let shopOnboardingWelcomeTimer=0;",
  "let shopOnboardingHandoffLocked=false;",
  "let shopOnboardingImages=[...SHOP_ONBOARDING_DEFAULT_IMAGES];",
  "let shopOnboardingActive=false;",
  "let shopAppWasHidden=false;",
  "let shopOnboardingResumeState=null;",
  'let currentCategory="هەموو";',
  "let currentProduct=null;",
  'let selectedSize="";',
  'let selectedColor="";',
  "let currentQty=1;",
  "let currentGalleryIndex=0;",
  'let ownerPanel="products";',
  "let shopStartupCompleted=true;",
  ...[...flowNames, "readShopOnboardingImages"].map(extractFunction),
  "({signup:startShopOnboardingSignup,render:renderShopOnboardingSlide,handoffLocked:()=>shopOnboardingHandoffLocked,view:getShopOnboardingStartupView,showIfNeeded:showShopOnboardingIfNeeded,show:showShopOnboarding,finish:finishShopOnboarding,hide:hideShopOnboarding,visibility:getShopOnboardingVisibilityAction,handleVisibility:handleShopOnboardingVisibilityChange,readImages:readShopOnboardingImages,active:()=>shopOnboardingActive,resumeState:()=>shopOnboardingResumeState})",
].join("\n");

function createFlow({currentUser=null,cloudAccount=null,pendingAuthenticationIntent=null,activeView="home",reducedMotion=false}={}){
  const values = new Map();
  const storage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(String(key), String(value)),
    removeItem: key => values.delete(String(key)),
  };
  const timers=new Map();
  const classes=new Set();
  const startupSplashClasses=new Set();
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
  let openedView=activeView;
  let openedOnboarding=false;
  let openMainOptions=null;
  let authMode=false;
  const layer = {
    hidden: false,
    inert: false,
    dataset: {},
    setAttribute(){},
    classList: {add(name){classes.add(name);},remove(name){classes.delete(name);},contains(name){return classes.has(name);}},
  };
  const image={hidden:false,alt:"",src:"",getAttribute(name){return name==="src"?this.src:null;}};
  const choices={hidden:false};
  const authPage={inert:false,style:{display:"none"}};
  const mainApp={inert:false,style:{display:"block"}};
  const app={classList:{add(name){if(name==="auth-mode")authMode=true;},remove(name){if(name==="auth-mode")authMode=false;},contains(name){return name==="auth-mode"&&authMode;},toggle(name,force){if(name==="auth-mode")authMode=force;}}};
  const pageView=(id,active)=>{const viewTokens=new Set(active?["active"]:[]);return {scrollTop:0,classList:{add(name){viewTokens.add(name);},remove(name){viewTokens.delete(name);},contains(name){return viewTokens.has(name);},toggle(name,force){force?viewTokens.add(name):viewTokens.delete(name);}}};};
  const viewElements=new Map(["home","search","cart","profile","detail","owner"].map(view=>[`${view}View`,pageView(`${view}View`,activeView===view)]));
  const searchInput={value:""};
  const startupSplashNode={hidden:true,classList:{add(name){startupSplashClasses.add(name);},remove(name){startupSplashClasses.delete(name);},contains(name){return startupSplashClasses.has(name);}}};
  const elements=new Map([
    ["shopPromoOnboarding",layer],
    ["shopStartupSplash",startupSplashNode],
    ["shopPromoOnboardingWelcomeHeading",{focus(){}}],
    ["shopPromoOnboardingChoices",choices],
    ["shopPromoOnboardingCreateAccount",{focus(){}}],
    ["shopPromoOnboardingExploreModels",{focus(){}}],
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
    customerUiText: english => english,
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
  return { flow, runtime, storage, layer, image, choices, authPage, mainApp, elements, classes, rootClasses, bodyClasses, preloadedImageUrls, startupSplashNode, startupSplashClasses, runTimers(){const pending=[...timers.values()];timers.clear();pending.forEach(timer=>timer.callback());}, pendingTimerDelays(){return [...timers.values()].map(timer=>timer.delay);}, get authScreen(){return authScreen;}, get authMode(){return authMode;}, get openedShop(){return openedShop;}, get openedView(){return openedView;}, get openedOnboarding(){return openedOnboarding;}, get openMainOptions(){return openMainOptions;} };
}

const customSlidesFlow=createFlow();
customSlidesFlow.storage.setItem(sharedImageKey,JSON.stringify(["https://cdn.example.test/model-one.jpg","https://cdn.example.test/model-two.jpg","https://cdn.example.test/model-three.jpg"]));
customSlidesFlow.flow.show();
customSlidesFlow.flow.render();
assert.equal(customSlidesFlow.image.src,"","Owner-managed promotional images are not displayed on Welcome");
assert.deepEqual(Array.from(customSlidesFlow.flow.readImages()),["https://cdn.example.test/model-one.jpg","https://cdn.example.test/model-two.jpg","https://cdn.example.test/model-three.jpg"],"showing one image preserves the full Owner-managed slide set");
assert.equal(customSlidesFlow.storage.getItem(sharedImageKey),JSON.stringify(["https://cdn.example.test/model-one.jpg","https://cdn.example.test/model-two.jpg","https://cdn.example.test/model-three.jpg"]),"Welcome rendering does not rewrite saved Owner image data");

const guestFlow = createFlow();
guestFlow.storage.setItem('shivan_shop_web_onboarding_completed', '1');
assert.equal(guestFlow.flow.view(), 'choices', 'a first visit starts with the two explicit destination choices');
guestFlow.flow.showIfNeeded({startupReveal:true});
assert.equal(guestFlow.classes.has("is-startup-reveal"),true,"the startup Welcome sequence is explicitly enabled");
guestFlow.flow.showIfNeeded();
assert.equal(guestFlow.classes.has("is-startup-reveal"),true,"reopening the already visible Welcome screen does not restart its entrance");
assert.equal(guestFlow.rootClasses.has("shop-promo-onboarding-open"), true, "startup should lock the document root against scrolling");
assert.equal(guestFlow.bodyClasses.has("shop-promo-onboarding-open"), true, "startup should lock the body against scrolling");
guestFlow.flow.render();
assert.deepEqual(guestFlow.preloadedImageUrls,[],"the redesigned Welcome does not load or display the Owner-managed promo slides");
assert.equal(guestFlow.layer.hidden,false,"Welcome is visible at startup");
assert.equal(guestFlow.image.src,"","Welcome leaves the Owner-managed image element absent");
assert.equal(guestFlow.choices.hidden,false,"both direct actions are visible immediately");
assert.equal(guestFlow.storage.getItem('shivan_shop_startup_choice_completed'),null,'a first visit is not marked complete until a choice is made');

const returningFlow=createFlow();
returningFlow.storage.setItem("shivan_shop_startup_choice_completed","1");
assert.equal(returningFlow.flow.view(),"returning","a previously chosen destination marks the next launch as returning");
returningFlow.flow.showIfNeeded();
assert.equal(returningFlow.layer.hidden,false,"returning Welcome is shown after splash");
assert.equal(returningFlow.choices.hidden,true,"returning Welcome hides both first-time choices");
assert.deepEqual(returningFlow.pendingTimerDelays(),[1700],"returning Welcome allows the complete logo and heading reveal to finish");
returningFlow.runTimers();
assert.equal(returningFlow.layer.hidden,true,"returning Welcome closes after its reveal");
assert.equal(returningFlow.openedView,"home","returning users land on the Shop");
assert.equal(returningFlow.storage.getItem("shivan_shop_startup_choice_completed"),"1","returning flow preserves the chosen-destination marker");
const exploreFlow = createFlow({pendingAuthenticationIntent:{type:'profile'},activeView:'profile'});
exploreFlow.startupSplashNode.hidden=false;
exploreFlow.startupSplashClasses.add("is-onboarding-brand");
exploreFlow.flow.showIfNeeded();
assert.equal(exploreFlow.choices.hidden,false, 'Explore Models is immediately available on welcome');
assert.equal(exploreFlow.flow.finish(), true, 'Explore Models should start the existing shop handoff');
assert.equal(exploreFlow.storage.getItem('shivan_shop_startup_choice_completed'),'1','choosing Explore Models persists onboarding completion');
assert.equal(exploreFlow.layer.hidden, false, 'the onboarding overlay should remain visible until its exit transition completes');
assert.equal(exploreFlow.classes.has('is-handoff-exiting'), true, 'Explore Models should use the handoff exit animation');
assert.equal(exploreFlow.layer.inert, true, 'the outgoing onboarding controls should be inert during the handoff');
assert.equal(exploreFlow.flow.handoffLocked(), true, 'the destination handoff should lock repeated button taps');
assert.deepEqual(exploreFlow.pendingTimerDelays(), [260], 'the page-opening transition should last 260ms');
assert.equal(exploreFlow.flow.finish(), false, 'a repeated Explore Models tap during handoff should be ignored');
assert.equal(exploreFlow.rootClasses.has("shop-promo-onboarding-open"), true, 'scroll should remain locked until the visual handoff is complete');
exploreFlow.runTimers();
assert.equal(exploreFlow.layer.hidden, true, 'Explore Models should dismiss Welcome after the transition');
assert.equal(exploreFlow.layer.inert, false, 'the hidden onboarding layer should be reset for the next app entry');
assert.equal(exploreFlow.startupSplashNode.hidden,false,"the same startup logo remains visible during the screen handoff");
assert.equal(exploreFlow.startupSplashClasses.has("is-exiting"),true,"the original logo exits only after a Welcome choice");
assert.deepEqual(exploreFlow.pendingTimerDelays(),[500],"the original logo stays mounted through the final handoff animation");
exploreFlow.runTimers();
assert.equal(exploreFlow.startupSplashNode.hidden,true,"the Splash layer closes after its destination transition completes");
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
assert.equal(accountFlow.choices.hidden,false, 'Create Account is immediately available on welcome');
assert.equal(accountFlow.flow.signup(),true,'Create Account should start the existing registration handoff');
assert.equal(accountFlow.storage.getItem('shivan_shop_startup_choice_completed'),'1','choosing Create Account persists onboarding completion');
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
reducedExploreFlow.startupSplashNode.hidden=false;
reducedExploreFlow.startupSplashClasses.add("is-onboarding-brand");
reducedExploreFlow.flow.show();
assert.equal(reducedExploreFlow.flow.finish(),true,'reduced-motion Explore Models should still open the existing shop');
assert.equal(reducedExploreFlow.layer.hidden,true,'reduced-motion handoffs should complete immediately');
assert.deepEqual(reducedExploreFlow.pendingTimerDelays(),[],'reduced-motion Explore Models should not wait on an animation timer');
assert.equal(reducedExploreFlow.startupSplashNode.hidden,true,"reduced-motion handoff releases the logo immediately after the choice");
assert.equal(reducedExploreFlow.rootClasses.has('shop-promo-onboarding-open'),false,'immediate Explore Models should restore page scrolling');

const reducedAccountFlow=createFlow({reducedMotion:true});
reducedAccountFlow.flow.show();
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
assert.equal(signedInFlow.choices.hidden,false, 'signed-in customers immediately see both destinations');
assert.equal(signedInFlow.runtime.currentUser, savedCustomer, 'the existing signed-in account remains active behind onboarding');
assert.equal(signedInFlow.storage.getItem('test-account-session'), savedSession, 'onboarding preserves the saved account session');
assert.equal(signedInFlow.storage.getItem('test-cart'), JSON.stringify([{productId:'p1',qty:2}]), 'onboarding preserves the cart');
assert.equal(signedInFlow.image.src,"","signed-in Welcome does not display stored Owner slide images");
assert.equal(signedInFlow.choices.hidden,false,"both Welcome actions remain visible for signed-in customers");
signedInFlow.flow.finish();
signedInFlow.runTimers();
assert.equal(signedInFlow.layer.hidden, true, 'Explore Models dismisses onboarding');
assert.equal(signedInFlow.openedView, 'home', 'completion opens model selection');
assert.equal(signedInFlow.runtime.currentUser, savedCustomer, 'completion preserves the signed-in account');
assert.equal(signedInFlow.storage.getItem('test-account-session'), savedSession, 'completion does not rewrite account storage');
assert.equal(signedInFlow.storage.getItem('test-cart'), JSON.stringify([{productId:'p1',qty:2}]), 'completion preserves the cart');

const lifecycleFlow = createFlow();
lifecycleFlow.flow.show();
assert.equal(lifecycleFlow.flow.handleVisibility(false), false, 'ordinary page navigation does not replay onboarding');
lifecycleFlow.flow.handleVisibility(true);
assert.equal(lifecycleFlow.flow.handleVisibility(false), true, 'returning from a hidden app replays onboarding');
assert.equal(lifecycleFlow.choices.hidden,false,"foreground replay returns to the explicit choice screen");
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
const navIds=["shopPromoOnboarding","homeView","storeView","newModelView","discountView","favoritesView","searchView","cartView","ordersView","profileView","detailView","ownerView","navHome","navSearch","navCart","navOrders","navProfile","ownerPanelButton","navAnalytics","authenticatedProfileCard","profileGuestAccess"];
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
  SHOP_HISTORY_VIEWS:new Set(["home","search","cart","orders","profile","store","newModel","discount","favorites","owner"]),shopViewNavigationPopHandler:null,shopViewNavigationScrollHandler:null,
  currentUser:{id:"offline-customer"},cloudAccount:null,pendingAuthenticationIntent:null,ownerPanel:"products",
  getActiveShopView(){return ["home","store","search","cart","orders","profile","detail","newModel","discount","favorites","owner"].find(view=>navClasses.get(`${view}View`)?.has("active"))||"home";},
  readShopViewPosition(){return {windowY:0,viewTop:0,authTop:0};},ownerPanelHasPendingWork:()=>false,
  hideShopOnboarding(){routeRuntime.shopOnboardingActive=false;navRootClasses.delete("shop-promo-onboarding-open");navBodyClasses.delete("shop-promo-onboarding-open");navElements.get("shopPromoOnboarding").hidden=true;},
  restoreProfileAuthCard(){},closeDetailImageFullscreen(){},isOwner:()=>true,showToast(){},renderCart(){},renderOrders(){},renderOwnerPanel(){},updateProfile(){},showGuestProfileChoices(){},requestAnimationFrame(callback){callback();},syncDetailPhotoTracks(){},
};
const routeHelpers=["shopViewHistoryState","writeShopViewHistory","installShopViewNavigation"].map(extractFunction).join("\n");
const routeFunction=runInNewContext(`${routeHelpers}\n${extractFunction("openView")}\nopenView`,routeRuntime);
for(const view of ["home","store","search","orders","profile","newModel","discount","favorites","owner"]){
  routeFunction(view);
  assert.ok(navClasses.get(`${view}View`)?.has("active"),`${view} navigation should activate its expected view`);
  assert.equal(routeRuntime.getActiveShopView(),view,`${view} should be recognized as the active route`);
  if(view==="store"||view==="newModel"||view==="discount"||view==="favorites")assert.ok(navClasses.get("navHome")?.has("active"),`${view} should keep the Shop navigation tab active`);
  assert.equal(navRootClasses.has("shop-promo-onboarding-open"),false,`${view} should not inherit the onboarding root scroll lock`);
  assert.equal(navBodyClasses.has("shop-promo-onboarding-open"),false,`${view} should not inherit the onboarding body scroll lock`);
}

const imageFlow = createFlow();
const savedSlideImages = ['https://cdn.example.test/first.webp', 'https://cdn.example.test/second.webp', 'https://cdn.example.test/third.webp'];
imageFlow.storage.setItem(sharedImageKey, JSON.stringify(savedSlideImages));
assert.deepEqual(Array.from(imageFlow.flow.readImages()), savedSlideImages, 'a refresh should retain the existing three shared image URLs');
imageFlow.flow.show();
assert.deepEqual(imageFlow.preloadedImageUrls, [], "stored Owner slide images are preserved without being displayed on Welcome");
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

console.log("Offline website onboarding checks passed: purple splash/Welcome choices, persistent first-time selection, returning-user handoff, preserved account/cart, and Owner slide management.");
