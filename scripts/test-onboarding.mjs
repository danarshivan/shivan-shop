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
assert.match(html, /onclick="skipShopOnboarding\(\)" aria-label="Skip onboarding and browse models"/);
assert.doesNotMatch(onboardingMarkup, /shopPromoOnboardingWelcome|Create Account|Explore Models/);
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
assert.match(extractFunction("finishShopOnboarding"), /openMain\(\{resumeIntent:false\}\);\s*openView\("home"\)/, "finishing or skipping must enter Shop without replaying a pending intent");
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
  "getShopOnboardingVisibilityAction", "renderShopOnboardingSlide", "advanceShopOnboarding", "skipShopOnboarding",
  "finishShopOnboarding", "setupShopOnboardingGestures", "showShopOnboardingIfNeeded", "showShopOnboarding",
  "handleShopOnboardingVisibilityChange",
];
const flowSource = [
  `const SHOP_ONBOARDING_IMAGES_KEY = "${sharedImageKey}";`,
  "const SHOP_ONBOARDING_SLIDE_COUNT = 3;",
  'const SHOP_ONBOARDING_DEFAULT_IMAGES = Object.freeze(["https://fallback.example.test/1.jpg", "https://fallback.example.test/2.jpg", "https://fallback.example.test/3.jpg"]);',
  "let shopOnboardingSlideIndex=0;",
  "let shopOnboardingImages=[...SHOP_ONBOARDING_DEFAULT_IMAGES];",
  "let shopOnboardingActive=false;",
  "let shopAppWasHidden=false;",
  "let shopStartupCompleted=true;",
  ...[...flowNames, "readShopOnboardingImages"].map(extractFunction),
  "({advance:advanceShopOnboarding,skip:skipShopOnboarding,setup:setupShopOnboardingGestures,render:renderShopOnboardingSlide,index:()=>shopOnboardingSlideIndex,view:getShopOnboardingStartupView,showIfNeeded:showShopOnboardingIfNeeded,show:showShopOnboarding,finish:finishShopOnboarding,visibility:getShopOnboardingVisibilityAction,handleVisibility:handleShopOnboardingVisibilityChange,swipeTarget:getShopOnboardingSwipeTarget,readImages:readShopOnboardingImages,active:()=>shopOnboardingActive})",
].join("\n");
function createFlow({currentUser=null,cloudAccount=null,pendingAuthenticationIntent=null,activeView="home"}={}){
  const values = new Map();
  const storage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(String(key), String(value)),
    removeItem: key => values.delete(String(key)),
  };
  const listeners = new Map();
  let renderedDots="";
  let renderCount=0;
  let openedView=activeView;
  let openedOnboarding=false;
  let openMainOptions=null;
  const layer = {
    hidden: false,
    dataset: {},
    setAttribute(){},
    addEventListener(name, callback){listeners.set(name, callback);},
    classList: {add(){},remove(){}},
  };
  const image={hidden:false,alt:"",src:"",getAttribute(name){return name==="src"?this.src:null;}};
  const dots={setAttribute(){},set innerHTML(value){renderedDots=value;renderCount++;},get innerHTML(){return renderedDots;}};
  const elements=new Map([
    ["shopPromoOnboarding",layer],
    ["shopPromoOnboardingImage",image],
    ["shopPromoOnboardingStep",{textContent:""}],
    ["shopPromoOnboardingDots",dots],
    ["shopPromoOnboardingSkip",{hidden:false,setAttribute(){},focus(){}}],
    ["authPage",{inert:false}],
    ["mainApp",{inert:false}],
  ]);
  let authScreen = "";
  let openedShop = false;
  const runtime = {
    localStorage: storage,
    safeImageUrl: value => /^(https:\/\/|\/api\/media\/shop\/)/i.test(String(value || "")) ? String(value) : "",
    currentUser,
    cloudAccount,
    pendingAuthenticationIntent,
    document: { getElementById: id => elements.get(id)||null, body:{classList:{add(){},remove(){}}} },
    requestAnimationFrame: callback => callback(),
    hideShopOnboarding: () => { layer.hidden = true; },
    showShopOnboarding: () => { layer.hidden = false; openedOnboarding = true; },
    showAuth: type => { authScreen = type; },
    openMain: options => { openedShop = true; openMainOptions = options; if(options?.resumeIntent!==false&&runtime.pendingAuthenticationIntent?.type==="profile")openedView="profile"; },
    openView: view => { openedView = view; },
  };
  const flow = runInNewContext(flowSource, runtime);
  return { flow, runtime, storage, layer, image, dots, elements, listeners, get authScreen(){return authScreen;}, get openedShop(){return openedShop;}, get openedView(){return openedView;}, get openedOnboarding(){return openedOnboarding;}, get openMainOptions(){return openMainOptions;}, get renderCount(){return renderCount;} };
}

const guestFlow = createFlow();
guestFlow.storage.setItem('shivan_shop_web_onboarding_completed', '1');
assert.equal(guestFlow.flow.view(), 'onboarding', 'every page launch starts onboarding even if an old persistent completion flag exists');
guestFlow.flow.showIfNeeded();
guestFlow.flow.render();
assert.equal(guestFlow.layer.hidden, false, 'the first slide should show at startup');
assert.equal(guestFlow.image.src, 'https://fallback.example.test/1.jpg', 'slide one should show the first shared image');
assert.equal((guestFlow.dots.innerHTML.match(/active/g)||[]).length, 1, 'slide one should have one active progress indicator');
assert.equal(guestFlow.elements.get('shopPromoOnboardingSkip').hidden, false, 'Skip should stay available on every slide');
guestFlow.flow.advance();
assert.equal(guestFlow.image.src, 'https://fallback.example.test/2.jpg', 'slide two should show the second shared image');
assert.equal((guestFlow.dots.innerHTML.match(/active/g)||[]).length, 2, 'slide two should have two active progress indicators');
guestFlow.flow.advance();
assert.equal(guestFlow.flow.index(), 2, 'navigation should reach the third slide');
assert.equal(guestFlow.image.src, 'https://fallback.example.test/3.jpg', 'slide three should show the third shared image');
assert.equal((guestFlow.dots.innerHTML.match(/active/g)||[]).length, 3, 'slide three should show all progress indicators');
assert.equal(guestFlow.storage.getItem('shivan_shop_web_onboarding_completed'), '1', 'an old marker is ignored and left untouched');

const skipFlow = createFlow({pendingAuthenticationIntent:{type:'profile'},activeView:'profile'});
skipFlow.flow.showIfNeeded();
skipFlow.flow.skip();
assert.equal(skipFlow.layer.hidden, true, 'Skip should dismiss the promotional slides');
assert.equal(skipFlow.openedShop, true, 'Skip should open the model selection shop');
assert.equal(skipFlow.openedView, 'home', 'Skip should land on model selection');
assert.equal(skipFlow.openMainOptions.resumeIntent, false, 'onboarding must not resume stale authentication redirects');
assert.equal(skipFlow.runtime.pendingAuthenticationIntent.type, 'profile', 'onboarding does not erase pending account data');

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
signedInFlow.flow.advance();
signedInFlow.flow.advance();
assert.equal(signedInFlow.layer.hidden, true, 'completing all slides dismisses onboarding');
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
swipeFlow.listeners.get('pointerup')(pointer(220,100));
assert.equal(swipeFlow.flow.index(), 2, 'a left swipe advances from slide two to slide three');
swipeFlow.listeners.get('pointerdown')(pointer(220,100));
swipeFlow.listeners.get('pointerup')(pointer(300,100));
assert.equal(swipeFlow.flow.index(), 1, 'a right swipe returns to the previous slide');
swipeFlow.listeners.get('pointerdown')(pointer(300,100));
swipeFlow.listeners.get('pointerup')(pointer(290,180));
assert.equal(swipeFlow.flow.index(), 1, 'vertical scrolling is not mistaken for a swipe');
swipeFlow.listeners.get('pointerdown')(pointer(300,100,1,{closest:()=>({})}));
swipeFlow.listeners.get('pointerup')(pointer(220,100));
assert.equal(swipeFlow.flow.index(), 1, 'swiping from a button does not trigger slide navigation');
swipeFlow.flow.advance();
swipeFlow.listeners.get('pointerdown')(pointer(300,100));
swipeFlow.listeners.get('pointerup')(pointer(220,100));
assert.equal(swipeFlow.layer.hidden, true, 'a left swipe after slide three completes onboarding');
assert.equal(swipeFlow.openedView, 'home', 'the completion swipe opens model selection');
assert.equal(swipeFlow.flow.swipeTarget(2,300,100,220,100), 2, 'the last-slide swipe target stays clamped while the handler completes the flow');
assert.equal(swipeFlow.flow.swipeTarget(0,220,100,300,100), 0, 'swiping before the first slide stays on slide one');

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

console.log("Offline website onboarding checks passed: three shared image slides, Skip and completion to Models, swipe bounds and button guards, launch and foreground replay, no persistent completion state, signed-in account/cart preservation, shared image URLs, offline D1 persistence, cross-device reads, and server-enforced Owner-only writes.");
