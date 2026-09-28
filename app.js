// ==========================================
// الإعدادات الرئيسية (Daftra & Firebase)
// ==========================================
const DAFTRA_BASE_URL = "https://your-domain.daftra.com"; // ضع رابط دفترة هنا
const DAFTRA_API_TOKEN = "YOUR_DAFTRA_API_TOKEN_HERE"; // ضع توكن دفترة هنا

// إعدادات Firebase (استبدلها ببيانات مشروعك لاحقاً إذا أردت النبذات الطويلة)
const firebaseConfig = {
  apiKey: "AIzaSyDummyKeyReplaceThis",
  authDomain: "dar-alnasher.firebaseapp.com",
  projectId: "dar-alnasher",
  storageBucket: "dar-alnasher.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};

// تهيئة Firebase
let db = null;
try {
  firebase.initializeApp(firebaseConfig);
  db = firebase.firestore();
} catch (e) {
  console.warn("Firebase Init Error (Using fallback data):", e);
}

const CURRENCY = " ج.م";

// ==========================================
// المتغيرات وحالة التطبيق
// ==========================================
let productCatalog = []; // كل المنتجات
let heroBooks = []; // أحدث 5 منتجات للسلايدر
let currentSlide = 0; // السلايدر النشط
let cart = [];

// DOM Elements
const els = {
  productsLoading: document.getElementById("products-loading"),
  productsGrid: document.getElementById("products-grid"),
  cartToggleBtn: document.getElementById("cart-toggle"),
  cartCount: document.getElementById("cart-count"),
  cartOverlay: document.getElementById("cart-overlay"),
  cartPanel: document.getElementById("cart-panel"),
  cartCloseBtn: document.getElementById("cart-close"),
  cartItemsContainer: document.getElementById("cart-items"),
  cartTotal: document.getElementById("cart-total"),
  checkoutOpenBtn: document.getElementById("checkout-open"),
  checkoutOverlay: document.getElementById("checkout-overlay"),
  checkoutModal: document.getElementById("checkout-modal"),
  checkoutCloseBtn: document.getElementById("checkout-close"),
  checkoutForm: document.getElementById("checkout-form"),
  checkoutSubmitBtn: document.getElementById("checkout-submit"),
  checkoutStatus: document.getElementById("checkout-status"),
  toast: document.getElementById("toast"),
  filterBtns: document.querySelectorAll(".filter-btn")
};

// ==========================================
// التهيئة (Initialization)
// ==========================================
function init() {
  loadCartFromStorage();
  updateCartUI();
  bindEvents();
  fetchProducts();
}

function bindEvents() {
  els.cartToggleBtn?.addEventListener("click", () => toggleCart(true));
  els.cartCloseBtn?.addEventListener("click", () => toggleCart(false));
  els.cartOverlay?.addEventListener("click", () => toggleCart(false));

  els.checkoutOpenBtn?.addEventListener("click", () => {
    if (cart.length === 0) return showToast("السلة فارغة!");
    toggleCart(false);
    toggleCheckout(true);
  });
  els.checkoutCloseBtn?.addEventListener("click", () => toggleCheckout(false));
  els.checkoutOverlay?.addEventListener("click", () => toggleCheckout(false));

  els.checkoutForm?.addEventListener("submit", handleCheckout);

  els.cartItemsContainer?.addEventListener("click", (e) => {
    const itemEl = e.target.closest(".cart-item");
    if (!itemEl) return;
    const id = itemEl.getAttribute("data-cart-item");
    
    if (e.target.closest("[data-qty-increase]")) updateQuantity(id, 1);
    else if (e.target.closest("[data-qty-decrease]")) updateQuantity(id, -1);
    else if (e.target.closest("[data-remove-item]")) removeFromCart(id);
  });

  els.filterBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      els.filterBtns.forEach(b => b.classList.remove("active-filter"));
      btn.classList.add("active-filter");
      filterProducts(btn.getAttribute("data-category"));
      // التمرير الناعم لقسم المنتجات عند الضغط على تصنيف
      document.getElementById("latest-releases").scrollIntoView({ behavior: "smooth" });
    });
  });

  // أزرار السلايدر
  document.getElementById("slider-prev")?.addEventListener("click", () => changeSlide(-1));
  document.getElementById("slider-next")?.addEventListener("click", () => changeSlide(1));
}

// ==========================================
// جلب وعرض المنتجات (Daftra + Firebase)
// ==========================================
async function fetchProducts() {
  showProductsState("loading");
  try {
    const headers = {
      "APIKEY": DAFTRA_API_TOKEN,
      "Content-Type": "application/json",
      "Accept": "application/json"
    };

    // 1. جلب المنتجات من دفترة
    const daftraRes = await fetch(`${DAFTRA_BASE_URL}/api/v2/products`, { headers });
    if (!daftraRes.ok) throw new Error("Daftra API Error");
    const daftraData = await daftraRes.json();
    const daftraItems = daftraData.data || [];

    // 2. محاولة جلب الميتا داتا من Firebase
    let firebaseMeta = {};
    if (db) {
      try {
        const snapshot = await db.collection("products_metadata").get();
        snapshot.forEach(doc => { firebaseMeta[doc.id] = doc.data(); });
      } catch (e) {
        console.warn("Could not fetch Firebase metadata", e);
      }
    }

    // 3. دمج البيانات
    const products = daftraItems.map(item => {
      const fbData = firebaseMeta[item.id] || {};
      return {
        id: String(item.id),
        title: item.name || "كتاب بدون عنوان",
        price: parseFloat(item.price1) || 0,
        category: item.category?.name || fbData.category || "عام",
        image: fbData.image || "https://placehold.co/400x600/E0F2FE/12213F?text=غلاف+الكتاب",
        author: fbData.author || "مؤلف غير معروف",
        description: fbData.description || "كتاب رائع متوفر الآن في متجر دار النشر."
      };
    });

    productCatalog = products;

    if (products.length === 0) {
      showProductsState("empty");
    } else {
      renderProducts(products);
      showProductsState("grid");
      
      // تهيئة السلايدر العلوي بأحدث 5 كتب
      heroBooks = products.slice(0, 5);
      renderHeroSlider();
    }
  } catch (error) {
    console.error("Fetch Products Error:", error);
    showProductsState("error");
  }
}

function showProductsState(state) {
  els.productsLoading.style.display = state === "loading" ? "grid" : "none";
  els.productsGrid.style.display = state === "grid" ? "grid" : "none";
  if (state === "error" || state === "empty") {
    els.productsGrid.style.display = "block";
    els.productsGrid.innerHTML = `<div class="text-center py-10 col-span-full font-bold text-navy-700">${state === "error" ? "حدث خطأ في تحميل الكتب." : "لا توجد كتب متاحة حالياً."}</div>`;
  }
}

// ==========================================
// منطق السلايدر التفاعلي
// ==========================================
function renderHeroSlider() {
  const container = document.getElementById("hero-slider-container");
  if (!container || heroBooks.length === 0) return;

  container.innerHTML = heroBooks.map((book, index) => {
    return `
      <div class="hero-slide ${index === 0 ? 'active' : ''} flex-col md:flex-row items-center gap-8 md:gap-12 w-full absolute top-0 left-0" data-slide="${index}">
        <div class="flex-1 text-center md:text-right z-10 w-full">
          <span class="inline-block bg-white text-navy-800 border border-sky-200 px-4 py-1.5 rounded-full text-sm font-black mb-4 shadow-sm">إصدار مميز 🚀</span>
          <h1 class="font-display text-4xl md:text-5xl lg:text-6xl font-black leading-[1.2] text-navy-900 mb-4 line-clamp-2">
            ${book.title}
          </h1>
          <p class="text-xl text-orange-500 font-black mb-4">${book.author}</p>
          <p class="text-lg text-navy-700/80 mb-8 max-w-md mx-auto md:mx-0 font-medium line-clamp-3">
            ${book.description}
          </p>
          <div class="flex items-center justify-center md:justify-start gap-6">
            <span class="font-black text-3xl text-navy-900">${book.price}${CURRENCY}</span>
            <button data-add-to-cart="${book.id}" class="bg-orange-500 hover:bg-orange-600 text-white font-black px-8 py-3.5 rounded-xl transition-all shadow-lg shadow-orange-500/30">
              أضف للسلة
            </button>
          </div>
        </div>
        <div class="flex-1 relative flex justify-center mt-12 md:mt-0 w-full">
          <div class="relative w-[220px] h-[330px] md:w-[320px] md:h-[460px] animate-float perspective-1000">
            <img src="${book.image}" class="w-full h-full object-cover rounded-r-3xl rounded-l-md shadow-[20px_20px_40px_rgba(0,0,0,0.2)] transform rotate-[-5deg] rotate-y-12 border-l-8 border-sky-200" alt="${book.title}">
          </div>
        </div>
      </div>
    `;
  }).join("");

  container.querySelectorAll("[data-add-to-cart]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-add-to-cart");
      const product = productCatalog.find((p) => p.id === id);
      if (product) addToCart(product);
    });
  });
}

function changeSlide(direction) {
  const slides = document.querySelectorAll(".hero-slide");
  if (slides.length === 0) return;
  slides[currentSlide].classList.remove("active");
  currentSlide = (currentSlide + direction + slides.length) % slides.length;
  slides[currentSlide].classList.add("active");
}

// ==========================================
// شبكة المنتجات (المتجر)
// ==========================================
function renderProducts(products) {
  els.productsGrid.innerHTML = products.map((book, index) => bookCardHTML(book, index)).join("");
  els.productsGrid.querySelectorAll("[data-add-to-cart]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-add-to-cart");
      const product = productCatalog.find((p) => p.id === id);
      if (product) addToCart(product);
    });
  });
}

function filterProducts(category) {
  if (category === "الكل") {
    renderProducts(productCatalog);
  } else {
    const filtered = productCatalog.filter(p => p.category.includes(category));
    if (filtered.length === 0) {
      els.productsGrid.innerHTML = `<div class="col-span-full text-center py-10 font-bold text-navy-700">لا توجد كتب في قسم "${category}" حالياً.</div>`;
    } else {
      renderProducts(filtered);
    }
  }
}

function bookCardHTML(book, index) {
  const staggerClass = index % 2 !== 0 ? "md:translate-y-8" : "";
  const badge = book.price > 100 
    ? `<span class="absolute top-4 right-4 bg-orange-500 text-white text-[11px] font-black px-3 py-1.5 rounded-full z-10 shadow-md">🔥 الأكثر مبيعاً</span>` 
    : `<span class="absolute top-4 right-4 bg-purple-500 text-white text-[11px] font-black px-3 py-1.5 rounded-full z-10 shadow-md">✨ جديد</span>`;

  return `
    <article class="book-card relative flex flex-col ${staggerClass}">
      ${badge}
      <div class="aspect-[3/4] overflow-hidden relative bg-sky-100">
        <div class="absolute inset-0 bg-gradient-to-t from-navy-900/40 to-transparent z-0"></div>
        <img src="${book.image}" alt="${book.title}" loading="lazy" class="w-full h-full object-cover relative z-[-1]" />
      </div>
      <div class="p-5 flex flex-col gap-2 relative bg-white z-10 -mt-4 rounded-t-3xl h-full">
        <h3 class="font-black text-navy-800 text-lg line-clamp-1">${book.title}</h3>
        <p class="text-sm text-sky-600 font-bold">${book.author}</p>
        <p class="text-xs text-navy-700/60 mt-1 line-clamp-2 leading-relaxed font-medium" title="${book.description}">${book.description}</p>
        
        <div class="mt-auto pt-4 flex items-center justify-between">
          <span class="font-black text-orange-500 text-xl">${book.price}${CURRENCY}</span>
          <button data-add-to-cart="${book.id}" class="bg-navy-800 text-white w-10 h-10 rounded-full hover:bg-orange-500 transition-colors flex items-center justify-center font-bold text-xl shadow-md border-2 border-transparent hover:border-orange-200" aria-label="أضف للسلة">
            +
          </button>
        </div>
      </div>
    </article>
  `;
}

// ==========================================
// منطق السلة (Cart Logic)
// ==========================================
function addToCart(product) {
  const existing = cart.find(item => item.id === product.id);
  if (existing) {
    existing.quantity += 1;
  } else {
    cart.push({ ...product, quantity: 1 });
  }
  saveCart();
  updateCartUI();
  showToast(`تمت إضافة "${product.title}" للسلة`);
}

function updateQuantity(id, delta) {
  const item = cart.find(i => i.id === id);
  if (!item) return;
  item.quantity += delta;
  if (item.quantity <= 0) {
    removeFromCart(id);
  } else {
    saveCart();
    updateCartUI();
  }
}

function removeFromCart(id) {
  cart = cart.filter(i => i.id !== id);
  saveCart();
  updateCartUI();
}

function saveCart() {
  try {
    localStorage.setItem("dar_nasher_cart", JSON.stringify(cart));
  } catch (e) {
    console.warn("Could not save cart to localStorage");
  }
}

function loadCartFromStorage() {
  try {
    const saved = localStorage.getItem("dar_nasher_cart");
    if (saved) cart = JSON.parse(saved);
  } catch (e) {
    cart = [];
  }
}

function updateCartUI() {
  const totalCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const totalPrice = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  els.cartCount.textContent = totalCount;
  els.cartTotal.textContent = `${totalPrice.toFixed(2)}${CURRENCY}`;

  if (cart.length === 0) {
    els.cartItemsContainer.innerHTML = `<div class="text-center py-10 text-navy-700/60 font-bold">السلة فارغة حالياً</div>`;
  } else {
    els.cartItemsContainer.innerHTML = cart.map(cartItemHTML).join("");
  }
}

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

// ==========================================
// إتمام الطلب والفاتورة (Checkout)
// ==========================================
async function handleCheckout(e) {
  e.preventDefault();
  if (cart.length === 0) return;

  const name = document.getElementById("customer-name").value.trim();
  const phone = document.getElementById("customer-phone").value.trim();
  const address = document.getElementById("customer-address").value.trim();

  els.checkoutSubmitBtn.disabled = true;
  els.checkoutSubmitBtn.textContent = "جاري تأكيد الطلب...";
  els.checkoutStatus.classList.remove("hidden", "text-red-500", "text-green-500");
  els.checkoutStatus.textContent = "";

  try {
    await createDaftraInvoice(name, phone, address, cart);
    
    // نجاح
    els.checkoutStatus.textContent = "تم إرسال طلبك بنجاح! سنتواصل معك قريباً.";
    els.checkoutStatus.classList.add("text-green-500");
    
    // تفريغ السلة
    cart = [];
    saveCart();
    updateCartUI();
    els.checkoutForm.reset();
    
    setTimeout(() => {
      toggleCheckout(false);
      els.checkoutSubmitBtn.disabled = false;
      els.checkoutSubmitBtn.textContent = "تأكيد وإرسال الطلب";
      els.checkoutStatus.classList.add("hidden");
    }, 2500);

  } catch (error) {
    console.error("Checkout Error:", error);
    els.checkoutStatus.textContent = "حدث خطأ أثناء إرسال الطلب، يرجى المحاولة لاحقاً.";
    els.checkoutStatus.classList.add("text-red-500");
    els.checkoutSubmitBtn.disabled = false;
    els.checkoutSubmitBtn.textContent = "إعادة المحاولة";
  }
}

async function createDaftraInvoice(name, phone, address, cartItems) {
  const invoiceData = {
    Invoice: {
      client_id: "", // سيتم تسجيله كعميل نقدي أو يمكنك إنشاء عميل أولاً في دفترة
      client_business_name: name,
      notes: `رقم الهاتف: ${phone} | العنوان: ${address}`,
      draft: 0 // لكي تكون الفاتورة معتمدة وتخصم من المخزون
    },
    InvoiceItem: cartItems.map(item => ({
      product_id: item.id,
      quantity: item.quantity,
      price: item.price
    }))
  };

  const response = await fetch(`${DAFTRA_BASE_URL}/api/v2/invoices`, {
    method: "POST",
    headers: {
      "APIKEY": DAFTRA_API_TOKEN,
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify(invoiceData)
  });

  if (!response.ok) {
    const errData = await response.json();
    throw new Error(errData.message || "Failed to create Daftra Invoice");
  }
  return await response.json();
}

// ==========================================
// وظائف المساعدة (Helpers)
// ==========================================
function toggleCart(show) {
  els.cartOverlay.hidden = !show;
  els.cartPanel.hidden = !show;
  // Trigger reflow for transition
  void els.cartPanel.offsetWidth;
  if (show) {
    els.cartOverlay.classList.add("is-visible");
    els.cartPanel.classList.add("is-open");
    document.body.style.overflow = "hidden";
  } else {
    els.cartOverlay.classList.remove("is-visible");
    els.cartPanel.classList.remove("is-open");
    setTimeout(() => {
      if (!els.checkoutPanel?.classList.contains("is-open")) document.body.style.overflow = "";
    }, 300);
  }
}

function toggleCheckout(show) {
  els.checkoutOverlay.hidden = !show;
  els.checkoutModal.hidden = !show;
  void els.checkoutModal.offsetWidth;
  if (show) {
    els.checkoutOverlay.classList.add("is-visible");
    els.checkoutModal.classList.add("is-open");
    document.body.style.overflow = "hidden";
  } else {
    els.checkoutOverlay.classList.remove("is-visible");
    els.checkoutModal.classList.remove("is-open");
    setTimeout(() => { document.body.style.overflow = ""; }, 300);
  }
}

let toastTimeout;
function showToast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  void els.toast.offsetWidth;
  els.toast.classList.add("is-visible");

  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    els.toast.classList.remove("is-visible");
    setTimeout(() => { els.toast.hidden = true; }, 300);
  }, 2500);
}

// تشغيل التطبيق
document.addEventListener("DOMContentLoaded", init);
