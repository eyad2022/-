/* ============================================================
   إعدادات دايناميكية: Daftra & Firebase
   ============================================================ */

// 1. إعدادات دفترة
const DAFTRA_BASE_URL = "https://YOUR_SUBDOMAIN.daftra.com";
const DAFTRA_API_TOKEN = "YOUR_DAFTRA_API_KEY_HERE";

function daftraHeaders(extra = {}) {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    APIKEY: DAFTRA_API_TOKEN,
    ...extra,
  };
}

// 2. إعدادات Firebase
const firebaseConfig = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// تهيئة قراءة Firebase للمتجر
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

const CURRENCY = " ج.م";

/* ============================================================
   إدارة الحالة والتخزين
   ============================================================ */
const CART_STORAGE_KEY = "publisher_cart";
let cart = loadCart();
let productCatalog = [];
let firestoreMetadata = {}; // لتخزين النبذات القادمة من Firebase

function loadCart() {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) { return []; }
}

function saveCart() {
  try { localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart)); } catch (err) {}
}

/* ============================================================
   جلب البيانات ودمجها (The Hybrid Fetch)
   ============================================================ */

async function fetchProducts() {
  showProductsState("loading");

  try {
    // الخطوة الأولى: سحب النبذات والمقاسات من Firebase
    const snapshot = await db.collection("books_meta").get();
    snapshot.forEach((doc) => {
      firestoreMetadata[doc.id] = doc.data(); // حفظ البيانات برقم الكتاب
    });

    // الخطوة الثانية: سحب الأسعار والمخزون من دفترة
    const response = await fetch(`${DAFTRA_BASE_URL}/api/v2/products`, {
      method: "GET",
      headers: daftraHeaders(),
    });

    if (!response.ok) throw new Error(`Daftra responded with status ${response.status}`);

    const payload = await response.json();
    const rawList = Array.isArray(payload) ? payload : payload.data || [];
    
    // الخطوة الثالثة: الدمج
    const products = rawList.map(normalizeProduct).filter(Boolean);

    productCatalog = products;

    if (products.length === 0) {
      showProductsState("empty");
    } else {
      renderProducts(products);
      showProductsState("grid");
    }
  } catch (err) {
    console.error("fetchProducts() failed:", err);
    showProductsState("error");
  }
}

function normalizeProduct(raw) {
  if (!raw) return null;
  const p = raw.Product || raw.product || raw;
  const id = String(p.id ?? p.product_id);
  if (!p.id && !p.product_id) return null;

  // استخراج النبذة الخاصة بهذا الكتاب المحددة من الفايربيز (لو مش موجودة نحط ديفولت)
  const meta = firestoreMetadata[id] || { 
    description: "تفاصيل ونبذة هذا الكتاب ستتوفر قريباً.", 
    size: "غير محدد" 
  };

  return {
    id: id,
    title: p.name || p.title || "بدون عنوان",
    author: p.author || p.brand || "دار النشر",
    category: p.category_name || (p.Category && p.Category.name) || "عام",
    price: parseFloat(p.price ?? p.unit_price ?? 0) || 0,
    image: p.image || p.product_image || p.picture_url || placeholderCoverFor(p),
    description: meta.description,
    size: meta.size,
    raw: p,
  };
}

function placeholderCoverFor(p) {
  const seed = encodeURIComponent(p.name || p.id || "كتاب");
  return `https://placehold.co/400x600/12213F/F7F3EA?text=${seed}`;
}

async function createDaftraInvoice(customer, items) {
  const body = {
    Invoice: {
      client_name: customer.name,
      client_phone_1: customer.phone,
      client_address_1: customer.address,
      draft: 0,
    },
    InvoiceItem: items.map((item) => ({
      product_id: item.id,
      item: item.title,
      unit_price: item.price,
      quantity: item.quantity,
    })),
  };

  const response = await fetch(`${DAFTRA_BASE_URL}/api/v2/invoices`, {
    method: "POST",
    headers: daftraHeaders(),
    body: JSON.stringify(body),
  });

  if (!response.ok) throw new Error("Invoice creation failed");
  return response.json();
}

/* ============================================================
   نظام الفلترة وعرض البطاقات
   ============================================================ */

function filterProducts(categoryName) {
  const grid = document.getElementById("products-grid");
  const sectionTitle = document.querySelector("#latest-releases h2");

  if (!categoryName || categoryName === "الكل") {
    renderProducts(productCatalog);
    sectionTitle.textContent = "جميع الإصدارات";
    return;
  }

  const filtered = productCatalog.filter((book) => 
    book.category && book.category.includes(categoryName)
  );

  renderProducts(filtered);
  sectionTitle.textContent = `قسم: ${categoryName}`;
  
  if(filtered.length === 0) {
    grid.innerHTML = `<div class="col-span-full text-center py-10 font-bold text-navy-800">لا توجد كتب متاحة في هذا القسم حالياً.</div>`;
  }
}

function showProductsState(state) {
  const loading = document.getElementById("products-loading");
  const error = document.getElementById("products-error");
  const empty = document.getElementById("products-empty");
  const grid = document.getElementById("products-grid");

  loading.classList.toggle("hidden", state !== "loading");
  error.classList.toggle("hidden", state !== "error");
  empty.classList.toggle("hidden", state !== "empty");
  grid.classList.toggle("hidden", state !== "grid");
}

function renderProducts(products) {
  const grid = document.getElementById("products-grid");
  // تمرير الـ index لتطبيق تأثير التباين الديناميكي
  grid.innerHTML = products.map((book, index) => bookCardHTML(book, index)).join("");

  grid.querySelectorAll("[data-add-to-cart]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-add-to-cart");
      const product = productCatalog.find((p) => p.id === id);
      if (product) addToCart(product);
    });
  });
}

function bookCardHTML(book, index) {
  // تصميم شبكي ديناميكي: رفع البطاقات الفردية قليلاً لتكوين شكل Masonry عصري
  const staggerClass = index % 2 !== 0 ? "md:translate-y-8" : "";
  
  // شارات ديناميكية (Badges) بناءً على السعر (أكثر مبيعاً أو جديد)
  const badge = book.price > 100 
    ? `<span class="absolute top-4 right-4 bg-orange-500 text-white text-[11px] font-black px-3 py-1.5 rounded-full z-10 shadow-md">🔥 الأكثر مبيعاً</span>` 
    : `<span class="absolute top-4 right-4 bg-purple-500 text-white text-[11px] font-black px-3 py-1.5 rounded-full z-10 shadow-md">✨ جديد</span>`;

  return `
    <article class="book-card relative flex flex-col ${staggerClass}">
      ${badge}
      <div class="book-cover-wrap aspect-[3/4] overflow-hidden relative bg-sky-100">
        <!-- تدرج لوني خفيف أسفل الغلاف -->
        <div class="absolute inset-0 bg-gradient-to-t from-navy-900/40 to-transparent z-0"></div>
        <img src="${book.image}" alt="${book.title}" loading="lazy" class="w-full h-full object-cover relative z-[-1]" />
      </div>
      <!-- معلومات الكتاب ترتفع قليلاً فوق الغلاف -->
      <div class="p-5 flex flex-col gap-2 relative bg-white z-10 -mt-4 rounded-t-3xl h-full">
        <h3 class="font-black text-navy-800 text-lg line-clamp-1">${book.title}</h3>
        <p class="text-sm text-sky-600 font-bold">${book.author}</p>
        <p class="text-xs text-navy-700/60 mt-1 line-clamp-2 leading-relaxed font-medium" title="${book.description}">${book.description}</p>
        
        <div class="mt-auto pt-4 flex items-center justify-between">
          <span class="font-black text-orange-500 text-xl">${book.price}${CURRENCY}</span>
          <button data-add-to-cart="${book.id}" class="bg-navy-800 text-white w-10 h-10 rounded-full hover:bg-orange-500 transition-colors flex items-center justify-center font-bold text-xl shadow-md border-2 border-transparent hover:border-orange-200">
            +
          </button>
        </div>
      </div>
    </article>
  `;
}

// دالة تحديث شكل العناصر في السلة (في app.js) لتناسب التصميم المدور الجديد
function cartItemHTML(item) {
  return `
    <div class="cart-item flex gap-4 bg-white p-3 rounded-2xl border border-sky-100 shadow-sm" data-cart-item="${item.id}">
      <img src="${item.image}" alt="" class="w-16 h-20 object-cover rounded-xl" />
      <div class="flex-1 min-w-0 flex flex-col justify-center">
        <h4 class="font-black text-navy-800 text-sm line-clamp-1">${item.title}</h4>
        <p class="text-orange-500 font-black text-sm mt-1">${item.price}${CURRENCY}</p>
        <div class="flex items-center justify-between mt-3">
          <div class="qty-stepper">
            <button type="button" data-qty-increase>+</button>
            <span>${item.quantity}</span>
            <button type="button" data-qty-decrease>&minus;</button>
          </div>
          <button type="button" class="text-red-400 bg-red-50 w-7 h-7 rounded-full flex items-center justify-center hover:bg-red-500 hover:text-white transition-colors" data-remove-item>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
      </div>
    </div>
  `;
}


/* ============================================================
   منطق السلة
   ============================================================ */

function addToCart(product, quantity = 1) {
  const existing = cart.find((item) => item.id === product.id);
  if (existing) {
    existing.quantity += quantity;
  } else {
    cart.push({ ...product, quantity });
  }
  saveCart();
  updateCartUI();
  showToast(`تمت إضافة "${product.title}" للسلة`);
}

function updateItemQuantity(id, delta) {
  const item = cart.find((i) => i.id === id);
  if (!item) return;
  item.quantity += delta;
  if (item.quantity <= 0) {
    cart = cart.filter((i) => i.id !== id);
  }
  saveCart();
  updateCartUI();
}

function removeFromCart(id) {
  cart = cart.filter((i) => i.id !== id);
  saveCart();
  updateCartUI();
}

function clearCart() {
  cart = [];
  saveCart();
  updateCartUI();
}

function cartTotal() {
  return cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

function cartItemCount() {
  return cart.reduce((sum, item) => sum + item.quantity, 0);
}

function updateCartUI() {
  document.getElementById("cart-count").textContent = cartItemCount();
  const itemsEl = document.getElementById("cart-items");
  if (cart.length === 0) {
    itemsEl.innerHTML = "<p class='text-center py-10 text-gray-500 font-bold'>السلة فارغة.</p>";
  } else {
    itemsEl.innerHTML = cart.map(cartItemHTML).join("");
    wireCartItemControls(itemsEl);
  }
  document.getElementById("cart-total").textContent = cartTotal() + CURRENCY;
}

function cartItemHTML(item) {
  return `
    <div class="cart-item flex gap-4 border-b border-navy-100 pb-4" data-cart-item="${item.id}">
      <img src="${item.image}" alt="" class="w-16 h-24 object-cover rounded-sm" />
      <div class="flex-1 min-w-0">
        <h4 class="font-bold text-navy-700 text-sm">${item.title}</h4>
        <p class="text-gold-600 font-bold text-sm mt-1">${item.price}${CURRENCY}</p>
        <div class="flex items-center gap-3 mt-2">
          <div class="flex items-center border border-navy-100 rounded-sm">
            <button type="button" class="w-7 h-7 flex items-center justify-center hover:bg-navy-50 font-bold" data-qty-increase>+</button>
            <span class="w-6 text-center text-sm font-bold">${item.quantity}</span>
            <button type="button" class="w-7 h-7 flex items-center justify-center hover:bg-navy-50 font-bold" data-qty-decrease>&minus;</button>
          </div>
          <button type="button" class="text-red-500 text-xs underline hover:text-red-700 font-bold" data-remove-item>حذف</button>
        </div>
      </div>
    </div>
  `;
}

function wireCartItemControls(container) {
  container.querySelectorAll("[data-cart-item]").forEach((row) => {
    const id = row.getAttribute("data-cart-item");
    row.querySelector("[data-qty-increase]").addEventListener("click", () => updateItemQuantity(id, 1));
    row.querySelector("[data-qty-decrease]").addEventListener("click", () => updateItemQuantity(id, -1));
    row.querySelector("[data-remove-item]").addEventListener("click", () => removeFromCart(id));
  });
}

/* ============================================================
   منطق الدفع
   ============================================================ */

async function submitOrder(event) {
  event.preventDefault();
  if (cart.length === 0) return;

  const form = event.target;
  const submitBtn = document.getElementById("checkout-submit");
  const statusEl = document.getElementById("checkout-status");

  const customer = {
    name: form.name.value.trim(),
    phone: form.phone.value.trim(),
    address: form.address.value.trim(),
  };

  submitBtn.disabled = true;
  submitBtn.textContent = "جاري إرسال الطلب...";
  
  try {
    await createDaftraInvoice(customer, cart);
    statusEl.textContent = "تم تسجيل طلبك بنجاح! سنتواصل معك قريباً.";
    statusEl.className = "text-green-600 block mt-2 font-bold text-center";
    
    clearCart();
    form.reset();

    setTimeout(() => {
      closeCheckout();
      closeCart();
      statusEl.classList.add("hidden");
    }, 2500);
  } catch (err) {
    console.error("submitOrder() failed:", err);
    statusEl.textContent = "حدث خطأ أثناء الطلب. يرجى المحاولة مرة أخرى.";
    statusEl.className = "text-red-600 block mt-2 font-bold text-center";
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "تأكيد وإرسال الطلب";
  }
}

/* ============================================================
   توصيل واجهة المستخدم
   ============================================================ */

function openCart() {
  document.getElementById("cart-overlay").hidden = false;
  document.getElementById("cart-panel").hidden = false;
  requestAnimationFrame(() => {
    document.getElementById("cart-overlay").classList.add("is-visible");
    document.getElementById("cart-panel").classList.add("is-open");
  });
}

function closeCart() {
  document.getElementById("cart-overlay").classList.remove("is-visible");
  document.getElementById("cart-panel").classList.remove("is-open");
  setTimeout(() => {
    document.getElementById("cart-overlay").hidden = true;
    document.getElementById("cart-panel").hidden = true;
  }, 300);
}

function openCheckout() {
  if (cart.length === 0) return;
  document.getElementById("checkout-overlay").hidden = false;
  document.getElementById("checkout-modal").hidden = false;
  requestAnimationFrame(() => {
    document.getElementById("checkout-overlay").classList.add("is-visible");
    document.getElementById("checkout-modal").classList.add("is-open");
  });
}

function closeCheckout() {
  document.getElementById("checkout-overlay").classList.remove("is-visible");
  document.getElementById("checkout-modal").classList.remove("is-open");
  setTimeout(() => {
    document.getElementById("checkout-overlay").hidden = true;
    document.getElementById("checkout-modal").hidden = true;
  }, 300);
}

let toastTimer = null;
function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.hidden = false;
  requestAnimationFrame(() => toast.classList.add("is-visible"));

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("is-visible");
    setTimeout(() => (toast.hidden = true), 200);
  }, 2200);
}

function wireStaticUI() {
  document.getElementById("cart-toggle").addEventListener("click", openCart);
  document.getElementById("cart-close").addEventListener("click", closeCart);
  document.getElementById("cart-overlay").addEventListener("click", closeCart);

  document.getElementById("checkout-open").addEventListener("click", openCheckout);
  document.getElementById("checkout-close").addEventListener("click", closeCheckout);
  document.getElementById("checkout-overlay").addEventListener("click", closeCheckout);
  document.getElementById("checkout-form").addEventListener("submit", submitOrder);

  document.getElementById("products-retry").addEventListener("click", fetchProducts);
  document.getElementById("refresh-btn").addEventListener("click", fetchProducts);

  document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      filterProducts(btn.getAttribute("data-category"));
      document.getElementById("latest-releases").scrollIntoView({ behavior: "smooth" });
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  wireStaticUI();
  updateCartUI(); 
  fetchProducts();
});
