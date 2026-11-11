import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
function source(name) {
  const match = html.match(new RegExp(`function ${name}\\([^\\n]*\\)\\{[\\s\\S]*?\\n\\}`, "m"));
  assert.ok(match, `Expected ${name} implementation.`);
  return match[0];
}

const homeSliderBlock = html.match(/HOME HERO SLIDER([\s\S]*?)START/);
assert.ok(homeSliderBlock, "the Home advertisement controller is present");
assert.doesNotMatch(homeSliderBlock[1], /setInterval|setTimeout/, "the Home banner has no automatic slideshow timer");
assert.match(source("renderHomeAdvertisements"), /bindHomeAdvertisementNavigation\(hero\)/, "Home ads bind manual navigation");
assert.match(source("renderHomeAdvertisements"), /renderHomeAdvertisementDots\(count\)/, "pagination dots are rendered separately from banner images");
assert.match(source("renderHomeAdvertisements"), /slideCycles=count>1\?\[0,1,2\]:\[1\]/, "neighboring banner copies are available on both sides of the active slide");
assert.match(source("renderHomeAdvertisements"), /safeImageUrl\(ad\.image\)/, "Home ads use the existing uploaded banner images");
assert.doesNotMatch(source("renderHomeAdvertisements"), /hero-copy|hero-overlay|Shop Now|openProduct\(|scrollProducts\(|onclick=/, "the Home carousel is image-only with no text overlays or navigation buttons");
assert.match(html, /#homeView \.hero-dots\{position:static/, "pagination indicators sit below the image viewport");
assert.match(html, /#homeView \.hero-slide img\{[^}]*object-fit:cover/, "banner photos retain their proportions without stretching");
assert.match(html, /#homeView \.hero-slide\{[^}]*border:0/, "banner cards do not add an internal outline");
assert.match(html, /#homeView \.hero-dots button span.active\{[^}]*#8966ff/, "the active pagination indicator stays purple");

class ClassList {
  constructor(...initial) { this.values = new Set(initial); }
  add(...names) { names.forEach(name => this.values.add(name)); }
  remove(...names) { names.forEach(name => this.values.delete(name)); }
  contains(name) { return this.values.has(name); }
  toggle(name, force) {
    if (force === undefined) force = !this.values.has(name);
    if (force) this.values.add(name); else this.values.delete(name);
    return force;
  }
}

const slides = Array.from({length:9},(_,position)=>({
  dataset:{homeAdIndex:String(position%3),homeAdCycle:String(Math.floor(position/3))},
  classList:new ClassList(),style:{},attributes:{},
  setAttribute(name,value){this.attributes[name]=value;},
}));
const dots = Array.from({length:3},(_,index)=>{
  const indicator={classList:new ClassList()};
  return {dataset:{homeAdIndex:String(index)},attributes:{},indicator,setAttribute(name,value){this.attributes[name]=value;},querySelector(){return indicator;}};
});
const track={clientWidth:320,offsetWidth:320};
const heroListeners=new Map();
const windowListeners=new Map();
const hero={
  dataset:{homeAdCount:"3"},clientWidth:320,offsetWidth:320,
  querySelector(selector){return selector===".hero-track"?track:null;},
  querySelectorAll(selector){return selector===".hero-slide"?slides:selector===".hero-dot"?dots:[];},
  addEventListener(type,handler){heroListeners.set(type,handler);},
  dispatch(type,event){heroListeners.get(type)?.(event);},
};
const fakeWindow={
  innerWidth:320,
  addEventListener(type,handler){windowListeners.set(type,handler);},
  removeEventListener(type,handler){if(windowListeners.get(type)===handler)windowListeners.delete(type);},
  dispatch(type,event){windowListeners.get(type)?.(event);},
  requestAnimationFrame(callback){callback();},
};
const context = vm.createContext({
  document: { querySelector(selector) { return selector === "#homeView .hero" ? hero : null; } },
  window: fakeWindow,
  products: [],
  advertisementsFromCatalog: false,
  advertisements: [{ image: "/banner-one.jpg" }, { image: "/banner-two.jpg" }, { image: "/banner-three.jpg" }],
  safeImageUrl: value => value,
  customerUiText: english => english,
  escapeHtml: value => String(value),
});
vm.runInContext(`let heroSlide=0;let heroAdPosition=3;\n${source("renderHomeAdvertisementDots")}\n${source("positionHomeAdvertisementSlides")}\n${source("setHomeAdvertisementSlide")}\n${source("bindHomeAdvertisementNavigation")}\n${source("renderHomeAdvertisements")}\nthis.homeSlide=()=>heroSlide;this.heroPosition=()=>heroAdPosition;this.positionAds=positionHomeAdvertisementSlides;this.renderHomeAds=renderHomeAdvertisements;this.renderDots=renderHomeAdvertisementDots;this.setHomeSlide=setHomeAdvertisementSlide;this.bindHomeAds=bindHomeAdvertisementNavigation;`, context);

context.bindHomeAds(hero);
context.bindHomeAds(hero);
assert.equal(heroListeners.size, 3, "the persistent hero receives one pointer, click, and transition handler");
context.renderHomeAds();
assert.equal(hero.dataset.homeAdCount, "3", "configured banners keep their real count");
assert.equal((hero.innerHTML.match(/class="hero-slide"/g) || []).length, 9, "three real banners render with neighboring preview copies");
assert.match(hero.innerHTML, /<div class="hero-track"[\s\S]*<\/div><div class="hero-dots"/, "pagination dots are outside the image track");
assert.match(hero.innerHTML, /\/banner-one\.jpg[\s\S]*\/banner-two\.jpg[\s\S]*\/banner-three\.jpg/, "the carousel uses the existing banner images");
assert.doesNotMatch(hero.innerHTML, /<h\d|<p|Shop Now|hero-copy|hero-overlay/, "rendered banner slides have no copy or action buttons");
assert.equal(context.positionAds(hero,{animate:false}),true);
assert.equal(slides.filter(slide=>slide.classList.contains("before")).length,1,"a neighboring banner is visible at the left edge");
assert.equal(slides.filter(slide=>slide.classList.contains("after")).length,1,"a neighboring banner is visible at the right edge");
assert.equal(slides[3].style.width,"264px","the centered banner leaves side previews at 320px");
assert.equal((context.renderDots(3).match(/class="hero-dot"/g) || []).length, 3, "three active ads produce three pagination buttons");
assert.match(context.renderDots(3), /aria-current="true"/);

const dotEvent = {
  detail: 1,
  target: { closest(selector) { return selector === ".hero-dot" ? dots[2] : null; } },
  defaultPrevented: false,
  propagationStopped: false,
  preventDefault() { this.defaultPrevented = true; },
  stopPropagation() { this.propagationStopped = true; },
};
hero.dispatch("click", dotEvent);
assert.equal(context.homeSlide(), 2, "tapping a pagination dot selects its advertisement");
assert.equal(dots[2].attributes["aria-current"], "true");
assert.equal(dots[2].indicator.classList.contains("active"), true);
assert.equal(dotEvent.defaultPrevented, true);

function swipe(pointerType, startX, endX, startY = 80, endY = 80) {
  const pointerId = pointerType === "touch" ? 2 : 3;
  hero.dispatch("pointerdown", {
    pointerId, pointerType, isPrimary: true, button: 0, clientX: startX, clientY: startY,
    target: { closest() { return null; } },
  });
  let prevented = false;
  fakeWindow.dispatch("pointerup", {
    pointerId, pointerType, clientX: endX, clientY: endY,
    preventDefault() { prevented = true; },
  });
  return prevented;
}

assert.equal(swipe("touch", 210, 120), true, "a left touch swipe advances one advertisement");
assert.equal(context.homeSlide(), 0, "left swipes wrap to the first ad after the last");
let suppressedClick = { detail: 1, target: { closest() { return null; } }, defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
hero.dispatch("click", suppressedClick);
assert.equal(suppressedClick.defaultPrevented, true, "a swipe suppresses the resulting click");
assert.equal(suppressedClick.stopped, true, "a swipe cannot trigger the banner Shop Now link");

assert.equal(swipe("mouse", 100, 190), true, "a right mouse drag moves to the previous advertisement");
assert.equal(context.homeSlide(), 2);
assert.equal(swipe("touch", 100, 120, 60, 150), false, "vertical scrolling does not change advertisements");
assert.equal(context.homeSlide(), 2, "a vertical gesture leaves the current advertisement visible");
assert.equal([...windowListeners.keys()].filter(type=>type==="pointerup"||type==="pointercancel").length,0,"pointer listeners are removed after each completed gesture");
for(const width of [320,375,390,1024]){track.clientWidth=width;fakeWindow.innerWidth=width;fakeWindow.dispatch("resize",{});const active=slides.find(slide=>slide.classList.contains("active"));const expected=Math.min(width-(width>=700?180:56),760);assert.equal(active.style.width,expected+"px",`the centered banner fits the ${width}px viewport`);assert.equal(slides.filter(slide=>slide.classList.contains("before")).length,1);assert.equal(slides.filter(slide=>slide.classList.contains("after")).length,1);}

assert.equal(swipe("mouse", 90, 95), false, "a fresh pointer action clears one-shot swipe click suppression");
const ordinaryTap = { detail: 1, target: { closest() { return null; } }, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { throw new Error("ordinary banner taps must propagate"); } };
hero.dispatch("click", ordinaryTap);
assert.equal(ordinaryTap.defaultPrevented, false, "a normal banner tap remains available to its existing action");

console.log("PASS Home advertisements: manual dots, touch and mouse swipes, wraparound, click suppression, responsive gesture intent, and no Home slideshow timer.");
