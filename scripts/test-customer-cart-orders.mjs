import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const html=await readFile(new URL("../index.html",import.meta.url),"utf8");
const functionSource=name=>html.match(new RegExp("function "+name+"\\([^]*?\\n\\}"))?.[0]||"";
const renderCartSource=functionSource("renderCart");
const renderOrdersSource=functionSource("renderOrders");
const orderFilterSource=functionSource("customerOrderFilterKey");
const setOrderFilterSource=functionSource("setCustomerOrdersFilter");
assert.ok(renderCartSource&&renderOrdersSource&&orderFilterSource&&setOrderFilterSource,"Cart and Orders functions are present");
assert.match(html,/id="cartView" class="view page shop-cart-view"/);
assert.match(html,/id="ordersView" class="view page shop-orders-view"/);
assert.match(html,/id="customerOrderFilters" class="customer-order-filters"/);
assert.match(html,/function getCheckoutDeliverySelection\(\)[\s\S]*?document\.getElementById\("cartDeliveryZone"\)/,"Cart uses the existing configured delivery zones");
assert.match(html,/function handleCartDeliveryZoneChange[\s\S]*?checkoutSelect\.value=selected[\s\S]*?renderCart\(\)/,"Cart delivery choice stays synchronized with Checkout");
assert.match(html,/\.customer-order-filters\{[^}]*overflow-x:auto/,"status filters scroll within the page on narrow screens");
assert.match(html,/\.shop-cart-view \.cart-item\{[^}]*grid-template-columns:72px minmax\(0,1fr\) auto/,"cart rows use a compact responsive item layout");
const cartOrdersCss=html.match(/\/\* Customer Cart & Orders \*\/([\s\S]*?)\.profile-card\{/ )?.[1]||"";
assert.ok(cartOrdersCss,"Cart and Orders styles stay in their scoped section");
assert.doesNotMatch(cartOrdersCss,/#ff9cae|#f3cf7b|#87d5f2|#87e1ad|#ff9bac/i,"new Cart and Orders components do not add alternate accent colors");
assert.match(cartOrdersCss,/\.customer-order-status\.is-processing\{border-color:#6c5526;background:#2b2415;color:#ffdc8a\}/,"processing badge reuses the existing Owner status palette");
assert.match(cartOrdersCss,/\.customer-order-status\.is-delivered\{border-color:#245849;background:#10291f;color:#83e4b2\}/,"delivered badge reuses the existing Owner status palette");
assert.match(cartOrdersCss,/\.customer-order-status\.is-cancelled\{border-color:#6b3442;background:#2d171e;color:#ff9aa6\}/,"cancelled badge reuses the existing Owner status palette");

const esc=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const orderNodes={ordersList:{innerHTML:""},customerOrderFilters:{innerHTML:"",attributes:{},setAttribute(key,value){this.attributes[key]=value;}},customerOrdersCount:{textContent:""}};
const orders=[
  {id:"order-new",userId:"customer-7",status:"لە چاوەڕوانی",date:"2026-11-20",total:24000,deliveryFee:1000,deliveryZoneName:"Central",items:[{name:"Real dress",image:"/dress.jpg",size:"M",color:"#112233",qty:2,price:12000}]},
  {id:"order-processing",userId:"customer-7",status:"پێچرا",date:"2026-11-19",total:18000,items:[{name:"Real top",image:"/top.jpg",size:"S",color:"#223344",qty:1,price:18000}]},
  {id:"order-shipped",userId:"customer-7",status:"هاتە ناردن",date:"2026-11-18",total:9000,items:[]},
  {id:"order-delivered",userId:"customer-7",status:"گەهشت",date:"2026-11-17",total:12000,items:[]},
  {id:"order-cancelled",userId:"customer-7",status:"ڕەتکراوە",date:"2026-11-16",total:0,items:[]},
  {id:"other-customer-order",userId:"customer-8",status:"پێچرا",total:999999,items:[]}
];
const ordersContext={
  currentUser:{id:"customer-7"},
  getOrders:()=>orders,
  document:{getElementById:id=>orderNodes[id]||null},
  updateHomeHeaderCountBadges(){},
  customerUiText:english=>english,
  escapeHtml:esc,
  translateText:value=>String(value||""),
  safeImageUrl:value=>String(value||""),
  getCartItemName:item=>String(item?.name||"Item"),
  renderOrderItemPrice:item=>String(item?.price||0)+" IQD",
  paymentMethodLabel:value=>String(value),
  formatPrice:value=>Number(value).toLocaleString("en-US")+" IQD",
  console
};
runInNewContext('let customerOrdersFilter="all";\n'+orderFilterSource+"\n"+setOrderFilterSource+"\n"+renderOrdersSource+"\nglobalThis.orderApi={customerOrderFilterKey,setCustomerOrdersFilter,renderOrders};",ordersContext);
ordersContext.orderApi.renderOrders();
assert.match(orderNodes.customerOrderFilters.innerHTML,/All/);
assert.match(orderNodes.customerOrderFilters.innerHTML,/data-status="processing"/);
assert.match(orderNodes.customerOrderFilters.innerHTML,/data-status="delivered"/);
assert.match(orderNodes.ordersList.innerHTML,/order-new/);
assert.match(orderNodes.ordersList.innerHTML,/order-processing/);
assert.doesNotMatch(orderNodes.ordersList.innerHTML,/other-customer-order/,"Orders never render another customer's records");
assert.match(orderNodes.ordersList.innerHTML,/<details class="order-items customer-order-details">/,"each order exposes expandable details");
assert.match(orderNodes.ordersList.innerHTML,/dress\.jpg/,"orders render saved product thumbnails");
assert.match(orderNodes.ordersList.innerHTML,/24,000 IQD/);
assert.match(orderNodes.ordersList.innerHTML,/Not available/,"legacy orders keep missing delivery fees unspecified");
assert.equal(ordersContext.orderApi.customerOrderFilterKey(orders[0]),"new");
assert.equal(ordersContext.orderApi.customerOrderFilterKey(orders[1]),"processing");
assert.equal(ordersContext.orderApi.customerOrderFilterKey(orders[2]),"shipped");
assert.equal(ordersContext.orderApi.customerOrderFilterKey(orders[3]),"delivered");
assert.equal(ordersContext.orderApi.customerOrderFilterKey(orders[4]),"cancelled");
assert.equal(ordersContext.orderApi.setCustomerOrdersFilter("processing"),true);
assert.match(orderNodes.ordersList.innerHTML,/order-processing/);
assert.doesNotMatch(orderNodes.ordersList.innerHTML,/order-new/,"status filters show only matching customer orders");
assert.equal(ordersContext.orderApi.setCustomerOrdersFilter("unknown"),false,"unsupported filters are rejected");
assert.equal(ordersContext.orderApi.setCustomerOrdersFilter("delivered"),true);
assert.match(orderNodes.ordersList.innerHTML,/order-delivered/);
assert.doesNotMatch(orderNodes.ordersList.innerHTML,/order-processing/);
ordersContext.currentUser=null;
ordersContext.orderApi.renderOrders();
assert.match(orderNodes.ordersList.innerHTML,/Sign in to view your orders/);

const cartNodes={cartList:{innerHTML:""},cartTotal:{innerHTML:""},cartItemCount:{textContent:""},cartPageTitle:{textContent:""},cartPageSubtitle:{textContent:""}};
let cartItems=[{id:3,productId:3,name:"Real dress",image:"/dress.jpg",size:"M",color:"#112233",colorName:"Navy",qty:2,price:12000}];
let selectedDelivery={id:"zone-1",name:"Configured area",fee:1500};
const ownerAppearance={deliveryChargingEnabled:true,deliveryZones:[{id:"zone-1",name:"Configured area",fee:1500}]};
const cartContext={
  document:{getElementById:id=>cartNodes[id]||null},
  renderOrders(){},
  getCart:()=>cartItems,
  customerUiText:english=>english,
  escapeHtml:esc,
  safeImageUrl:value=>String(value||""),
  getCartItemName:item=>String(item?.name||"Item"),
  normalizeHexColor:value=>String(value||""),
  renderCartItemPrice:item=>(Number(item.price)*Number(item.qty)).toLocaleString("en-US")+" IQD",
  cartItemPricing:item=>({finalPrice:Number(item.price)}),
  normalizeOwnerAppearance:value=>value,
  ownerAppearance,
  getCheckoutDeliverySelection:()=>selectedDelivery,
  formatPrice:value=>Number(value).toLocaleString("en-US")+" IQD",
  currentUser:{id:"customer-7"}
};
runInNewContext(renderCartSource+"\nglobalThis.cartApi={renderCart};",cartContext);
cartContext.cartApi.renderCart();
assert.match(cartNodes.cartList.innerHTML,/Real dress/);
assert.match(cartNodes.cartList.innerHTML,/dress\.jpg/);
assert.match(cartNodes.cartList.innerHTML,/Size/);
assert.match(cartNodes.cartList.innerHTML,/Navy/);
assert.match(cartNodes.cartList.innerHTML,/changeCartQty\(3,1\)/);
assert.match(cartNodes.cartList.innerHTML,/removeCartItem\(3\)/);
assert.match(cartNodes.cartTotal.innerHTML,/24,000 IQD/,"cart rows and subtotal use the effective item price and quantity");
assert.match(cartNodes.cartTotal.innerHTML,/1,500 IQD/,"the configured delivery fee is displayed");
assert.match(cartNodes.cartTotal.innerHTML,/25,500 IQD/,"the total includes the configured delivery fee");
assert.match(cartNodes.cartTotal.innerHTML,/id="cartDeliveryZone"/);
assert.equal(cartNodes.cartItemCount.textContent,"2 items");

selectedDelivery=null;
cartContext.cartApi.renderCart();
assert.match(cartNodes.cartTotal.innerHTML,/Choose your delivery area/);
assert.match(cartNodes.cartTotal.innerHTML,/Choose an area above/,"the app does not claim a final total until a required delivery area is selected");

cartItems=[];
cartContext.cartApi.renderCart();
assert.match(cartNodes.cartList.innerHTML,/Your bag is empty/);
assert.match(cartNodes.cartList.innerHTML,/Explore Collection/);
assert.equal(cartNodes.cartTotal.innerHTML,"","empty carts do not show a stale total");
console.log("Customer Cart and Orders checks passed: real cart item data, quantity/remove controls, configured delivery fee and total, empty state, owner-isolated order history, status filters, thumbnails, and expandable order details.");
