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
const completionKey = html.match(/const SHOP_ONBOARDING_COMPLETED_KEY = "([^"]+)";/)?.[1];
const sharedImageKey = html.match(/const SHOP_ONBOARDING_IMAGES_KEY = "([^"]+)";/)?.[1];
assert.equal(sharedImageKey, "shivan_shop_ios_onboarding_images", "website and iOS app must share the same Owner-managed slide image key");
assert.ok(completionKey, "the web onboarding completion state should have its own saved key");

assert.match(html, /id="shopPromoOnboarding"[^>]*role="dialog"[^>]*aria-modal="true"/);
const onboardingMarkup=html.match(/<section id="shopPromoOnboarding"[\s\S]*?<\/section>/)?.[0]||"";
assert.equal((onboardingMarkup.match(/<img\b/g)||[]).length, 1, "the onboarding overlay should contain a single reusable fashion image element");
assert.match(html, /onclick="skipShopOnboarding\(\)" aria-label="Skip to welcome choices"/);
assert.equal((html.match(/class="shop-promo-onboarding-choice/g) || []).length, 2, "the welcome screen should offer exactly Create Account and Explore Models");
assert.match(html, /onclick="completeShopOnboardingChoice\('signup'\)"[^>]*hidden>Create Account/);
assert.match(html, /onclick="completeShopOnboardingChoice\('explore'\)"[^>]*hidden>Explore Models/);
assert.match(html, /shop-promo-onboarding-choice primary/);
assert.match(html, /Women’s fashion in a clothing boutique/);
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
assert.match(extractFunction("completeShopOnboardingChoice"), /route==="shop"\)\{\s*openMain\(\{resumeIntent:false\}\);\s*openView\("home"\);\s*\}/, "Explore Models must enter Shop without replaying an intent or keeping a prior active view");
assert.match(extractFunction("openMain"), /if\(options\.resumeIntent!==false\)resumeAuthenticationIntent\(\)/, "other app entry points must keep their existing authentication-intent behavior");
assert.match(extractFunction("logout"), /resetShopOnboardingCompletion\(\)[\s\S]*showShopOnboarding\(\)/, "logout must clear completion and show the slides again");
assert.match(html, /if\(!cloudMode\)await restoreSession\(\);\s*showShopOnboardingIfNeeded\(\)/, "startup must check restored authentication before deciding to show onboarding");

const flowNames = [
  "getShopOnboardingStartupView", "getNextShopOnboardingStep", "getShopOnboardingSwipeTarget",
  "getShopOnboardingChoiceRoute", "isShopOnboardingCompleted", "markShopOnboardingCompleted",
  "resetShopOnboardingCompletion", "renderShopOnboardingSlide", "advanceShopOnboarding", "skipShopOnboarding",
  "completeShopOnboardingChoice", "setupShopOnboardingGestures", "showShopOnboardingIfNeeded",
];
const flowSource = [
  `const SHOP_ONBOARDING_IMAGES_KEY = "${sharedImageKey}";`,
  `const SHOP_ONBOARDING_COMPLETED_KEY = "${completionKey}";`,
  "const SHOP_ONBOARDING_SLIDE_COUNT = 3;",
  'const SHOP_ONBOARDING_DEFAULT_IMAGES = Object.freeze(["https://fallback.example.test/1.jpg", "https://fallback.example.test/2.jpg", "https://fallback.example.test/3.jpg"]);',
  "let shopOnboardingSlideIndex=0;",
  "let shopOnboardingImages=[...SHOP_ONBOARDING_DEFAULT_IMAGES];",
  ...[...flowNames, "readShopOnboardingImages"].map(extractFunction),
  "({advance:advanceShopOnboarding,skip:skipShopOnboarding,choose:completeShopOnboardingChoice,setup:setupShopOnboardingGestures,render:renderShopOnboardingSlide,index:()=>shopOnboardingSlideIndex,completed:isShopOnboardingCompleted,mark:markShopOnboardingCompleted,reset:resetShopOnboardingCompletion,view:getShopOnboardingStartupView,showIfNeeded:showShopOnboardingIfNeeded,swipeTarget:getShopOnboardingSwipeTarget,choiceRoute:getShopOnboardingChoiceRoute,readImages:readShopOnboardingImages})",
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
    ["shopPromoOnboardingSkip",{hidden:false,setAttribute(){}}],
    ["shopPromoOnboardingWelcome",{hidden:true}],
    ["shopPromoOnboardingCreateAccount",{hidden:true,focus(){}}],
    ["shopPromoOnboardingExplore",{hidden:true}],
  ]);
  let authScreen = "";
  let openedShop = false;
  const runtime = {
    localStorage: storage,
    safeImageUrl: value => /^(https:\/\/|\/api\/media\/shop\/)/i.test(String(value || "")) ? String(value) : "",
    currentUser,
    cloudAccount,
    pendingAuthenticationIntent,
    document: { getElementById: id => elements.get(id)||null },
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

const signupFlow = createFlow();
assert.equal(signupFlow.flow.view(false, signupFlow.flow.completed()), "onboarding", "a fresh logged-out visit should start the slideshow");
signupFlow.flow.render();
assert.equal(signupFlow.image.hidden, false, "screen one should show the fashion image");
assert.equal(signupFlow.image.src, "https://fallback.example.test/1.jpg", "screen one should use the first saved/default image");
assert.equal((signupFlow.dots.innerHTML.match(/active/g)||[]).length, 1, "screen one should show one active progress indicator");
assert.equal(signupFlow.elements.get("shopPromoOnboardingSkip").hidden, false, "Skip should remain visible on screen one");
signupFlow.flow.skip();
assert.equal(signupFlow.flow.index(), 2, "Skip should go directly to the welcome screen");
assert.equal(signupFlow.layer.hidden, false, "Skip should leave the two welcome choices visible");
assert.equal(signupFlow.image.hidden, true, "the welcome screen should not display a promotional image");
assert.equal(signupFlow.elements.get("shopPromoOnboardingWelcome").hidden, false, "the welcome message should be visible on screen three");
assert.equal(signupFlow.elements.get("shopPromoOnboardingSkip").hidden, true, "Skip should be replaced by the two choices on screen three");
assert.equal(signupFlow.elements.get("shopPromoOnboardingCreateAccount").hidden, false);
assert.equal(signupFlow.elements.get("shopPromoOnboardingExplore").hidden, false);
assert.equal((signupFlow.dots.innerHTML.match(/active/g)||[]).length, 3, "screen three should show all three progress indicators active");
assert.equal(signupFlow.flow.completed(), false, "arriving at the welcome screen is not completion until a choice is selected");
assert.equal(signupFlow.flow.choose("signup"), true, "Create Account should be accepted on the welcome screen");
assert.equal(signupFlow.storage.getItem(completionKey), "1", "choosing Create Account should persist completion");
assert.equal(signupFlow.layer.hidden, true, "Create Account should close the slideshow");
assert.equal(signupFlow.authScreen, "signup", "Create Account should open the existing signup screen");
assert.equal(signupFlow.flow.view(false, signupFlow.flow.completed()), "auth", "an ordinary refresh after completion should skip the slides");
assert.equal(signupFlow.flow.view(true, false), "main", "authenticated users should bypass onboarding");
signupFlow.flow.reset();
assert.equal(signupFlow.flow.view(false, signupFlow.flow.completed()), "onboarding", "logout should make the slides appear again");

const exploreFlow = createFlow({pendingAuthenticationIntent:{type:"profile"},activeView:"profile"});
exploreFlow.flow.advance();
assert.equal(exploreFlow.flow.index(), 1, "left navigation should reveal screen two");
assert.equal(exploreFlow.image.src, "https://fallback.example.test/2.jpg", "screen two should show its single fashion image");
assert.equal((exploreFlow.dots.innerHTML.match(/active/g)||[]).length, 2, "screen two should show two progress indicators active");
assert.equal(exploreFlow.image.hidden, false, "screen two should display its fashion image");
exploreFlow.flow.advance();
assert.equal(exploreFlow.flow.index(), 2, "left navigation should reveal the welcome screen");
assert.equal(exploreFlow.flow.completed(), false, "swiping to welcome should not force a choice");
assert.equal(exploreFlow.flow.choose("explore"), true, "Explore Models should be accepted on the welcome screen");
assert.equal(exploreFlow.flow.completed(), true, "Explore Models should persist onboarding completion");
assert.equal(exploreFlow.openedShop, true, "Explore Models should open the existing shop view without registration");
assert.equal(exploreFlow.openMainOptions.resumeIntent, false, "Explore Models must bypass pending authentication redirects");
assert.equal(exploreFlow.openedView, "home", "Explore Models must remain on Shop even if a stale Profile intent exists");
assert.equal(exploreFlow.runtime.pendingAuthenticationIntent.type, "profile", "Explore Models does not erase a pending intent or customer data");
assert.equal(exploreFlow.authScreen, "", "Explore Models must not open Login or Sign Up");
assert.equal(exploreFlow.flow.choiceRoute("invalid"), "", "unknown actions must not route or complete onboarding");

const savedCustomer = { id: "saved-customer", name: "Existing Customer", role: "customer" };
const savedSession = JSON.stringify({ accountId: savedCustomer.id });
const signedInFlow = createFlow({currentUser:savedCustomer});
signedInFlow.storage.setItem("test-account-session", savedSession);
signedInFlow.layer.hidden = true;
signedInFlow.flow.showIfNeeded();
assert.equal(signedInFlow.layer.hidden, true, "an existing signed-in customer bypasses onboarding");
assert.equal(signedInFlow.openedOnboarding, false, "a saved session does not show the guest onboarding choices");
assert.equal(signedInFlow.runtime.currentUser, savedCustomer, "the restored account remains the same signed-in account");
assert.equal(signedInFlow.storage.getItem("test-account-session"), savedSession, "onboarding does not overwrite or remove the saved session");
assert.equal(signedInFlow.flow.choose("explore"), false, "an authenticated user cannot be redirected by a guest onboarding choice");
assert.equal(signedInFlow.runtime.currentUser, savedCustomer, "an ignored Explore action preserves the authenticated user");
assert.equal(signedInFlow.storage.getItem("test-account-session"), savedSession, "an ignored Explore action preserves the saved session");

const swipeFlow = createFlow();
swipeFlow.flow.setup(swipeFlow.layer);
const pointer = (x,y,pointerId=1,target={closest:()=>null})=>({clientX:x,clientY:y,pointerId,isPrimary:true,target});
swipeFlow.listeners.get("pointerdown")(pointer(300,100));
swipeFlow.listeners.get("pointerup")(pointer(220,105));
assert.equal(swipeFlow.flow.index(), 1, "a left swipe should advance from screen one to screen two");
swipeFlow.listeners.get("pointerdown")(pointer(300,100));
swipeFlow.listeners.get("pointerup")(pointer(220,100));
assert.equal(swipeFlow.flow.index(), 2, "a left swipe should advance from screen two to welcome");
swipeFlow.listeners.get("pointerdown")(pointer(220,100));
swipeFlow.listeners.get("pointerup")(pointer(300,100));
assert.equal(swipeFlow.flow.index(), 1, "a right swipe should return to the previous screen");
swipeFlow.listeners.get("pointerdown")(pointer(300,100));
swipeFlow.listeners.get("pointerup")(pointer(290,180));
assert.equal(swipeFlow.flow.index(), 1, "vertical scrolling should not be mistaken for a swipe");
swipeFlow.listeners.get("pointerdown")(pointer(300,100,1,{closest:()=>({})}));
swipeFlow.listeners.get("pointerup")(pointer(220,100));
assert.equal(swipeFlow.flow.index(), 1, "swiping from a button must not activate gesture navigation");
assert.equal(swipeFlow.flow.swipeTarget(2,300,100,220,100), 2, "swiping beyond the last screen should stay on the welcome screen");
assert.equal(swipeFlow.flow.swipeTarget(0,220,100,300,100), 0, "swiping before the first screen should stay on screen one");

const imageFlow = createFlow();
const savedSlideImages = ["https://cdn.example.test/first.webp", "https://cdn.example.test/second.webp", "https://cdn.example.test/third.webp"];
imageFlow.storage.setItem(sharedImageKey, JSON.stringify(savedSlideImages));
assert.deepEqual(Array.from(imageFlow.flow.readImages()), savedSlideImages, "a refresh should retain the existing three shared image URLs");
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

console.log("Offline onboarding checks passed: single-image slides and progress, direct Skip to the two-choice welcome screen, swipe bounds and button guards, signup/explore routing, completion and logout behavior, authenticated-user bypass, shared image URLs, offline D1 image persistence, cross-device reads, and server-enforced Owner-only writes.");
