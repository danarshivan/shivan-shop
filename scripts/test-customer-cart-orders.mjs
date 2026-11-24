import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const html=await readFile(new URL("../index.html",import.meta.url),"utf8");
const functionSource=name=>html.match(new RegExp("function "+name+"\\([^]*?\\n\\}"))?.[0]||"";
const renderCartSource=functionSource("renderCart");
const cartPricingSource=functionSource("cartItemPricing");
const renderCartItemPriceSource=functionSource("renderCartItemPrice");
const renderPriceBreakdownSource=functionSource("renderPriceBreakdown");
const renderOrdersSource=functionSource("renderOrders");
const cartBackSource=functionSource("goBackFromCart");
const orderFilterSource=functionSource("customerOrderFilterKey");
const setOrderFilterSource=functionSource("setCustomerOrdersFilter");
assert.ok(renderCartSource&&cartPricingSource&&renderCartItemPriceSource&&renderPriceBreakdownSource&&renderOrdersSource&&cartBackSource&&orderFilterSource&&setOrderFilterSource,"Cart and Orders functions are present");
assert.match(html,/id="cartView" class="view page shop-cart-view"/);
const cartMarkup=html.match(/<div id="cartView" class="view page shop-cart-view">[\s\S]*?(?=<div id="ordersView")/)?.[0]||"";
assert.match(cartMarkup,/<header class="shop-collection-header search-page-header">[\s\S]*?<div class="search-page-brand" aria-label="Shivan Shop">Shivan Shop<\/div>/,"Cart reuses the Search header and centered wordmark");
assert.match(cartMarkup,/id="cartBackButton"[^>]*onclick="goBackFromCart\(\)"/,"Cart Back control follows the Search header pattern and has Cart history handling");
assert.doesNotMatch(cartMarkup,/SHIVAN SHOP · YOUR SELECTION|Fashion and lovely finds/,"the obsolete Cart heading copy is removed");
assert.match(cartMarkup,/id="cartItemsHeading" class="cart-items-heading">Your Items/);
assert.match(html,/id="ordersView" class="view page shop-orders-view"/);
assert.ok(html.includes('onclick="goBackFromOrders()"')&&html.includes("function goBackFromOrders()"),"Orders Back uses a history-aware navigation handler");
assert.match(html,/id="customerOrderFilters" class="customer-order-filters"/);
assert.match(html,/body\.cart-page-open #mainApp>\.topbar\{display:none!important\}/,"Cart hides the old app topbar in favor of the Search header");
assert.match(html,/classList\.toggle\("cart-page-open",view==="cart"\)/,"Cart header state is scoped to Cart navigation");
assert.match(html,/\.shop-cart-view\{[^}]*padding:12px 0 calc\(96px \+ env\(safe-area-inset-bottom\)\)/,"Cart uses Search page spacing and reserves the mobile safe area");
assert.match(html,/function getCheckoutDeliverySelection\(\)[\s\S]*?document\.getElementById\("cartDeliveryZone"\)/,"Cart uses the existing configured delivery zones");
assert.match(html,/function handleCartDeliveryZoneChange[\s\S]*?checkoutSelect\.value=selected[\s\S]*?renderCart\(\)/,"Cart delivery choice stays synchronized with Checkout");
assert.match(html,/\.customer-order-filters\{[^}]*overflow-x:auto/,"status filters scroll within the page on narrow screens");
assert.match(html,/\.shop-cart-view \.cart-item\{[^}]*grid-template-columns:72px minmax\(0,1fr\) auto/,"cart rows use a compact responsive item layout");
assert.match(html,/\.search-page-header\{[^}]*grid-template-columns:42px minmax\(0,1fr\) 42px/,"Cart and Search share the same header sizing and centered layout");
const cartOrdersCss=html.match(/\/\* Customer Cart & Orders \*\/([\s\S]*?)\.profile-card\{/ )?.[1]||"";
assert.ok(cartOrdersCss,"Cart and Orders styles stay in their scoped section");
assert.doesNotMatch(cartOrdersCss,/#ff9cae|#f3cf7b|#87d5f2|#87e1ad|#ff9bac/i,"new Cart and Orders components do not add alternate accent colors");
assert.match(cartOrdersCss,/\.shop-cart-view \.discount-pill\{background:#7145ff\}/,"Cart discount badges use the existing purple accent");
assert.match(cartOrdersCss,/\.customer-order-status\.is-processing\{border-color:#6c5526;background:#2b2415;color:#ffdc8a\}/,"processing badge reuses the existing Owner status palette");
assert.match(cartOrdersCss,/\.customer-order-status\.is-delivered\{border-color:#245849;background:#10291f;color:#83e4b2\}/,"delivered badge reuses the existing Owner status palette");
assert.match(cartOrdersCss,/\.customer-order-status\.is-cancelled\{border-color:#6b3442;background:#2d171e;color:#ff9aa6\}/,"cancelled badge reuses the existing Owner status palette");

const backHistory={state:{__shivanShopView:"cart"},length:2,backCount:0,back(){this.backCount++;}};
const cartBackContext={window:{history:backHistory},shopViewScrollPositions:new Map(),writeShopViewHistory(){throw new Error("history back should be used");},openView(){throw new Error("history back should be used");}};
runInNewContext(cartBackSource+"\nglobalThis.goBack=goBackFromCart;",cartBackContext);
assert.equal(cartBackContext.goBack(),true);
assert.equal(backHistory.backCount,1,"Cart Back uses browser history when the user has a prior screen");
const fallbackCalls=[];
const cartFallbackContext={window:{history:{state:{},length:1}},shopViewScrollPositions:new Map([["home",{windowY:125,viewTop:0,authTop:0}]]),writeShopViewHistory:(view,options)=>fallbackCalls.push([view,options]),openView:(view,options)=>fallbackCalls.push([view,options])};
runInNewContext(cartBackSource+"\nglobalThis.goBack=goBackFromCart;",cartFallbackContext);
assert.equal(cartFallbackContext.goBack(),true);
assert.deepEqual(fallbackCalls.map(([view])=>view),["home","home"],"Cart Back falls back to Home when no history entry exists");

const esc=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
assert.match(html,/id="orderDetailsView" class="view page customer-order-details-view"/);
assert.ok(html.includes('id="orderDetailsBackButton" class="shop-collection-back" type="button" onclick="goBackFromCustomerOrderDetails()"'));
assert.ok(html.includes("class=\"search-page-brand\" aria-label=\"Shivan Shop\">Shivan Shop</div>")&&html.includes("id=\"customerOrderDetailsContent\""));
assert.match(html,/"orderDetails"/,"Order Details is registered in app navigation history");
assert.match(html,/customer-orders-page-open #mainApp>.topbar/);
assert.match(html,/view==="orders"||view==="orderDetails"/);
assert.ok(html.includes('if((view==="cart"||view==="orders"||view==="orderDetails"||view==="profile")'),"Order Details follows the existing customer authentication gate");
const orderFunctionNames=["customerOrderFilterKey","customerOrderStatusLabel","customerOrderDateLabel","customerOrderSortNewest","customerOrderCardMarkup","setCustomerOrdersFilter","renderOrders","customerOrderLookupForCurrentUser","openCustomerOrderDetails","goBackFromCustomerOrderDetails","customerOrderStageTime","customerOrderTimeText","customerOrderTimelineMarkup","customerOrderDetailMarkup","renderCustomerOrderDetails","openCustomerOrderHelp","orderAgainFromHistory"];
const orderSources=Object.fromEntries(orderFunctionNames.map(name=>[name,functionSource(name)]));
assert.ok(Object.values(orderSources).every(Boolean),"Orders and Order Details functions are present");
const orderNodes={ordersList:{innerHTML:""},customerOrderFilters:{innerHTML:"",attributes:{},setAttribute(key,value){this.attributes[key]=value;}},customerOrdersCount:{textContent:""},ordersPageCount:{textContent:""},customerOrderDetailsContent:{innerHTML:""}};
const placedAt="2026-11-20T14:00:00.000Z";
const orders=[
  {id:"order-new",userId:"customer-7",status:"New",createdAt:placedAt,total:25000,subtotal:24000,deliveryFee:1000,deliveryZoneName:"Central delivery",address:"Erbil, Ankawa",name:"Customer Seven",phone:"07501234567",items:[{productId:1,name:"Real dress",image:"/dress.jpg",size:"M",color:"#112233",colorName:"Navy",qty:2,price:12000,originalPrice:16000,discount:25}]},
  {id:"order-processing",userId:"customer-7",status:"Processing",createdAt:"2026-11-21T14:00:00.000Z",total:18000,items:[{name:"Real top",image:"/top.jpg",size:"S",color:"#223344",qty:1,price:18000}]},
  {id:"order-shipped",userId:"customer-7",status:"Shipped",createdAt:"2026-11-19T14:00:00.000Z",total:9000,items:[]},
  {id:"order-delivered",userId:"customer-7",status:"Delivered",createdAt:"2026-11-17T14:00:00.000Z",total:12000,items:[]},
  {id:"order-cancelled",userId:"customer-7",status:"Cancelled",createdAt:"2026-11-16T14:00:00.000Z",total:0,items:[]},
  {id:"other-customer-order",userId:"customer-8",status:"Processing",total:999999,items:[]}
];
const ordersContext={currentUser:{id:"customer-7"},cloudAccount:null,activeLanguage:"en",customerOrdersFilter:"all",customerOrderDetailsId:"order-new",getOrders:()=>orders,document:{getElementById:id=>orderNodes[id]||null},updateHomeHeaderCountBadges(){},showToast(){},openView(){},customerUiText:english=>english,escapeHtml:esc,translateText:value=>String(value||""),safeImageUrl:value=>String(value||""),getCartItemName:item=>String(item?.name||"Item"),renderPriceBreakdown:(original,final,percent)=>'<del>'+original.toLocaleString()+" IQD</del><strong>"+final.toLocaleString()+" IQD</strong><b>-"+percent+"%</b>",formatPrice:value=>Number(value).toLocaleString("en-US")+" IQD",paymentMethodLabel:value=>String(value),console,Date,Intl};
runInNewContext('let customerOrdersFilter="all";let customerOrderDetailsId="order-new";\n'+orderSources.customerOrderFilterKey+"\n"+orderSources.customerOrderStatusLabel+"\n"+orderSources.customerOrderDateLabel+"\n"+orderSources.customerOrderSortNewest+"\n"+orderSources.customerOrderCardMarkup+"\n"+orderSources.setCustomerOrdersFilter+"\n"+orderSources.renderOrders+"\n"+orderSources.customerOrderLookupForCurrentUser+"\n"+orderSources.openCustomerOrderDetails+"\n"+orderSources.customerOrderStageTime+"\n"+orderSources.customerOrderTimeText+"\n"+orderSources.customerOrderTimelineMarkup+"\n"+orderSources.customerOrderDetailMarkup+"\n"+orderSources.renderCustomerOrderDetails+"\nglobalThis.orderApi={customerOrderFilterKey,setCustomerOrdersFilter,renderOrders,customerOrderLookupForCurrentUser,openCustomerOrderDetails,customerOrderTimelineMarkup,customerOrderDetailMarkup,renderCustomerOrderDetails};",ordersContext);
ordersContext.orderApi.renderOrders();
assert.match(orderNodes.customerOrderFilters.innerHTML,/All/);assert.match(orderNodes.customerOrderFilters.innerHTML,/data-status="processing"/);assert.match(orderNodes.customerOrderFilters.innerHTML,/data-status="shipped"/);
assert.ok(orderNodes.ordersList.innerHTML.indexOf("order-processing")<orderNodes.ordersList.innerHTML.indexOf("order-new"),"active orders are sorted newest first");
assert.ok(orderNodes.ordersList.innerHTML.indexOf("customer-order-history-section")<orderNodes.ordersList.innerHTML.indexOf("order-delivered"),"completed orders render in a separate history section");
assert.ok(orderNodes.ordersList.innerHTML.indexOf("order-delivered")<orderNodes.ordersList.innerHTML.indexOf("order-cancelled"),"history is sorted newest first");
assert.doesNotMatch(orderNodes.ordersList.innerHTML,/other-customer-order/,"Orders never render another customer's records");
assert.doesNotMatch(orderNodes.ordersList.innerHTML,/<details|<summary/,"order cards navigate to a dedicated details page instead of expanding");
assert.match(orderNodes.ordersList.innerHTML,/dress\.jpg/);assert.match(orderNodes.ordersList.innerHTML,/25,000 IQD/);assert.match(orderNodes.ordersList.innerHTML,/Order History/);assert.match(orderNodes.ordersList.innerHTML,/data-order-id="order-new"/);
assert.equal(ordersContext.orderApi.customerOrderFilterKey(orders[0]),"new");assert.equal(ordersContext.orderApi.customerOrderFilterKey(orders[1]),"processing");assert.equal(ordersContext.orderApi.customerOrderFilterKey(orders[2]),"shipped");assert.equal(ordersContext.orderApi.customerOrderFilterKey(orders[3]),"delivered");assert.equal(ordersContext.orderApi.customerOrderFilterKey(orders[4]),"cancelled");
assert.equal(ordersContext.orderApi.setCustomerOrdersFilter("processing"),true);assert.match(orderNodes.ordersList.innerHTML,/order-processing/);assert.doesNotMatch(orderNodes.ordersList.innerHTML,/order-new/);assert.match(orderNodes.ordersList.innerHTML,/order-delivered/,"history remains visible while filtering active orders");
assert.equal(ordersContext.orderApi.setCustomerOrdersFilter("delivered"),false,"history statuses are not active-order filters");assert.equal(ordersContext.orderApi.setCustomerOrdersFilter("unknown"),false);
assert.equal(ordersContext.orderApi.customerOrderLookupForCurrentUser("other-customer-order"),null,"detail lookup rejects another customer's order");assert.ok(ordersContext.orderApi.customerOrderLookupForCurrentUser("order-new"));assert.equal(ordersContext.orderApi.openCustomerOrderDetails("other-customer-order"),false,"cannot navigate to another customer's order detail");
assert.equal(ordersContext.orderApi.openCustomerOrderDetails("order-new"),true);
const detailOrder=orders[0];const detail=ordersContext.orderApi.customerOrderDetailMarkup(detailOrder);
assert.match(detail,/Order Items/);assert.match(detail,/Real dress/);assert.match(detail,/Size: <span data-i18n-preserve>M<\/span> · Color: <span data-i18n-preserve>Navy<\/span>/);assert.match(detail,/32,000 IQD/,"saved original line total multiplies original unit price by quantity");assert.match(detail,/24,000 IQD/);assert.match(detail,/-25%/);assert.match(detail,/Customer Seven/);assert.match(detail,/07501234567/);assert.match(detail,/Erbil, Ankawa/);assert.match(detail,/Central delivery/);assert.match(detail,/1,000 IQD/);assert.match(detail,/8,000 IQD/);assert.match(detail,/25,000 IQD/);assert.match(detail,/Need Help?/);assert.match(detail,/Order Again/);
assert.ok((detail.match(/Not recorded/g)||[]).length>=2,"tracking stages without saved event timestamps are marked unrecorded");
const cancelledTimeline=ordersContext.orderApi.customerOrderTimelineMarkup(orders[4]);assert.match(cancelledTimeline,/Cancelled/);assert.doesNotMatch(cancelledTimeline,/Shipped|Delivered/,"cancelled orders do not show delivery milestones");
ordersContext.orderApi.renderCustomerOrderDetails();assert.match(orderNodes.customerOrderDetailsContent.innerHTML,/Real dress/);
let supportOpened=false;const supportNode={classList:{add(){supportOpened=true;}}},supportMessageNode={value:""};const supportContext={currentUser:{id:"customer-7"},cloudAccount:null,customerOrderDetailsId:"order-new",getOrders:()=>orders,document:{getElementById:id=>id==="supportModal"?supportNode:id==="supportMessage"?supportMessageNode:null},customerUiText:english=>english,openSupport(){supportOpened=true;},showToast(){}};runInNewContext(orderSources.customerOrderLookupForCurrentUser+"\n"+orderSources.openCustomerOrderHelp+"\nglobalThis.help=openCustomerOrderHelp;",supportContext);assert.equal(supportContext.help(),true);assert.match(supportMessageNode.value,/order-new/);assert.equal(supportOpened,true,"Need Help opens the existing support flow with the order reference");
let reorderedCart=[],savedReorder=null,reorderDestination="";const reorderContext={currentUser:{id:"customer-7"},cloudAccount:null,customerOrderDetailsId:"order-new",getOrders:()=>orders,getCart:()=>reorderedCart,products:[{id:1,price:13000,images:["/current-dress.jpg"]}],canAddToCart:()=>true,normalizeHexColor:value=>String(value||"").toLowerCase(),cartPriceSnapshot:()=>({price:13000}),getProductName:()=>"Real dress",getProductColorLabel:()=>"Navy",saveCart:cart=>{savedReorder=cart;reorderedCart=cart;},openView:view=>{reorderDestination=view;},showToast(){},customerUiText:english=>english,Date,Math};runInNewContext(orderSources.customerOrderLookupForCurrentUser+"\n"+orderSources.orderAgainFromHistory+"\nglobalThis.reorder=orderAgainFromHistory;",reorderContext);assert.equal(reorderContext.reorder(),true);assert.equal(savedReorder[0].qty,2);assert.equal(savedReorder[0].price,13000,"Order Again uses the current catalog price");assert.equal(reorderDestination,"cart");
let blockedSave=false;reorderContext.canAddToCart=()=>false;reorderContext.saveCart=()=>{blockedSave=true;};reorderContext.reorderedCart=[];reorderContext.getCart=()=>[];assert.equal(reorderContext.reorder(),false);assert.equal(blockedSave,false,"unavailable variants are not silently added");

orders.splice(0,3);ordersContext.orderApi.renderOrders();assert.match(orderNodes.ordersList.innerHTML,/No new orders/);assert.match(orderNodes.ordersList.innerHTML,/Order History/,"history stays visible when there are no active orders");
ordersContext.currentUser=null;ordersContext.orderApi.renderOrders();assert.match(orderNodes.ordersList.innerHTML,/Sign in to view your orders/);
const orderBackSource=functionSource("goBackFromCustomerOrderDetails"),orderBackHistory={state:{__shivanShopView:"orderDetails"},length:3,backCount:0,back(){this.backCount++;}},backContext={window:{history:orderBackHistory},shopViewScrollPositions:new Map(),writeShopViewHistory(){throw new Error("should restore prior list history");},openView(){throw new Error("should restore prior list history");}};runInNewContext(orderBackSource+"\nglobalThis.goBack=goBackFromCustomerOrderDetails;",backContext);assert.equal(backContext.goBack(),true);assert.equal(orderBackHistory.backCount,1,"Order Details Back restores the previous Orders history entry and scroll state");
const cartNodes={cartList:{innerHTML:""},cartTotal:{innerHTML:""},cartItemCount:{textContent:""},cartPageTitle:{textContent:""},cartPageSubtitle:{textContent:""},cartItemsHeading:{textContent:""}};
let cartItems=[{id:3,productId:3,name:"Real dress",image:"/dress.jpg",size:"M",color:"#112233",colorName:"Navy",qty:2,price:12000,originalPrice:16000,discount:25}];
let selectedDelivery={id:"zone-1",name:"Configured area",fee:1500};
const ownerAppearance={deliveryChargingEnabled:true,deliveryZones:[{id:"zone-1",name:"Configured area",fee:1500}]};
const cartContext={
  document:{getElementById:id=>cartNodes[id]||null},
  renderOrders(){},
  getCart:()=>cartItems,
  products:[],
  getProductPricing:()=>null,
  customerUiText:english=>english,
  escapeHtml:esc,
  safeImageUrl:value=>String(value||""),
  getCartItemName:item=>String(item?.name||"Item"),
  normalizeHexColor:value=>String(value||""),
  normalizeOwnerAppearance:value=>value,
  ownerAppearance,
  getCheckoutDeliverySelection:()=>selectedDelivery,
  formatPrice:value=>Number(value).toLocaleString("en-US")+" IQD",
  currentUser:{id:"customer-7"}
};
runInNewContext(cartPricingSource+"\n"+renderPriceBreakdownSource+"\n"+renderCartItemPriceSource+"\n"+renderCartSource+"\nglobalThis.cartApi={renderCart};",cartContext);
cartContext.cartApi.renderCart();
assert.equal(cartNodes.cartPageTitle.textContent,"My Cart");
assert.equal(cartNodes.cartItemsHeading.textContent,"Your Items");
assert.match(cartNodes.cartList.innerHTML,/Real dress/);
assert.match(cartNodes.cartList.innerHTML,/dress\.jpg/);
assert.match(cartNodes.cartList.innerHTML,/Size/);
assert.match(cartNodes.cartList.innerHTML,/Navy/);
assert.match(cartNodes.cartList.innerHTML,/changeCartQty\(3,1\)/);
assert.match(cartNodes.cartList.innerHTML,/removeCartItem\(3\)/);
assert.match(cartNodes.cartList.innerHTML,/32,000 IQD/,"cart pricing keeps the original total price visible");
assert.match(cartNodes.cartList.innerHTML,/24,000 IQD/,"cart pricing shows the discounted item total");
assert.match(cartNodes.cartList.innerHTML,/-25%/,"discount percentage remains visible in Cart");
assert.match(cartNodes.cartTotal.innerHTML,/24,000 IQD/,"cart rows and subtotal use the effective item price and quantity");
assert.match(cartNodes.cartTotal.innerHTML,/1,500 IQD/,"the configured delivery fee is displayed");
assert.match(cartNodes.cartTotal.innerHTML,/25,500 IQD/,"the total includes the configured delivery fee");
assert.match(cartNodes.cartTotal.innerHTML,/Order Summary/);
assert.match(cartNodes.cartTotal.innerHTML,/Continue to Checkout/);
assert.match(cartNodes.cartTotal.innerHTML,/id="cartDeliveryZone"/);
assert.equal(cartNodes.cartItemCount.textContent,"2 items");
cartItems[0].qty=1;
cartContext.cartApi.renderCart();
assert.equal(cartNodes.cartItemCount.textContent,"1 item","the item count uses correct singular copy");

selectedDelivery=null;
cartContext.cartApi.renderCart();
assert.match(cartNodes.cartTotal.innerHTML,/Choose your delivery area/);
assert.match(cartNodes.cartTotal.innerHTML,/Choose an area above/,"the app does not claim a final total until a required delivery area is selected");

cartItems=[];
cartContext.cartApi.renderCart();
assert.match(cartNodes.cartList.innerHTML,/Your bag is empty/);
assert.match(cartNodes.cartList.innerHTML,/Explore Collection/);
assert.equal(cartNodes.cartTotal.innerHTML,"","empty carts do not show a stale total");
console.log("Customer Cart and Orders checks passed: cart behavior, active/history sorting and filters, customer-isolated details, saved tracking times, support, and current-catalog reorder.");
