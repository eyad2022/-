/* ============================================================
   Marginalia Bookstore — app.js
   Vanilla JS. No build step, no framework.

   Sections:
     1. Configuration        <-- PASTE YOUR DAFTRA API KEY HERE
     2. State & localStorage
     3. Daftra API calls
     4. Product rendering
     5. Cart logic
     6. Checkout logic
     7. UI wiring (modals, nav, toast)
     8. Init
   ============================================================ */


/* ============================================================
   1. CONFIGURATION
   ============================================================ */

// >>> PASTE YOUR DAFTRA API BASE URL HERE <<<
// This is your Daftra site's API root, e.g. "https://yoursite.daftra.com"
const DAFTRA_BASE_URL = "https://YOUR_SUBDOMAIN.daftra.com";

// >>> PASTE YOUR DAFTRA API KEY / TOKEN HERE <<<
// Found in Daftra under: Settings -> API -> API Key
const DAFTRA_API_TOKEN = "YOUR_DAFTRA_API_KEY_HERE";

// Daftra sends the key as a custom header, not a Bearer token.
// (Some Daftra accounts instead expect it as an "APIKEY" query
// param — check your account's API docs if requests 401.)
function daftraHeaders(extra = {}) {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    APIKEY: DAFTRA_API_TOKEN,
    ...extra,
  };
}

// Currency symbol used for display only (Daftra stores raw numbers)
const CURRENCY = "$";


/* ============================================================
   2. STATE & LOCALSTORAGE
   ============================================================ */

const CART_STORAGE_KEY = "marginalia_cart";

// Cart shape: [{ id, title, author, price, image, quantity }, ...]
let cart = loadCart();

function loadCart() {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error("Failed to read cart from localStorage:", err);
    return [];
  }
}

function saveCart() {
  try {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
  } catch (err) {
    console.error("Failed to save cart to localStorage:", err);
  }
}

// Keep the fetched product catalog in memory so cart / cards can
// look up full details (cover image, author) by id.
let productCatalog = [];


/* ============================================================
   3. DAFTRA API CALLS
   ============================================================ */

/**
 * Fetch books (products) from Daftra.
 * GET /api/v2/products
 */
async function fetchProducts() {
  showProductsState("loading");

  try {
    const response = await fetch(`${DAFTRA_BASE_URL}/api/v2/products`, {
      method: "GET",
      headers: daftraHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Daftra responded with status ${response.status}`);
    }

    const payload = await response.json();

    // Daftra typically wraps list results as { data: [...] } or
    // { data: [{ Product: {...} }] } depending on account/version.
    // normalizeProduct() below absorbs the common shapes — adjust
    // it if your account's response looks different.
    const rawList = Array.isArray(payload) ? payload : payload.data || [];
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
    document.getElementById("products-error-detail").textContent =
      "Couldn't reach the Daftra API. Check DAFTRA_BASE_URL / DAFTRA_API_TOKEN in app.js.";
    showProductsState("error");
  }
}

/**
 * Normalize a raw Daftra product record into the flat shape
 * the UI uses. Daftra product fields commonly include:
 * id, name, description, price, image / product_image, etc.
 * Wrapped records (e.g. { Product: {...} }) are unwrapped first.
 */
function normalizeProduct(raw) {
  if (!raw) return null;
  const p = raw.Product || raw.product || raw;

  const id = p.id ?? p.product_id;
  if (id === undefined) return null;

  return {
    id: String(id),
    title: p.name || p.title || "Untitled",
    // Daftra doesn't have a built-in "author" field — many stores
    // keep it in a custom field or in the description. Adjust the
    // key below (e.g. p.custom_fields?.author) to match your setup.
    author: p.author || p.brand || "Unknown Author",
    price: parseFloat(p.price ?? p.unit_price ?? 0) || 0,
    image:
      p.image || p.product_image || p.picture_url || placeholderCoverFor(p),
    raw: p, // keep the original record around, e.g. for stock checks
  };
}

// Simple deterministic placeholder cover so the grid never shows
// broken images while a real `image` field isn't set in Daftra.
function placeholderCoverFor(p) {
  const seed = encodeURIComponent(p.name || p.id || "book");
  return `https://placehold.co/400x600/12213F/F7F3EA?text=${seed}`;
}

/**
 * Create a sales invoice/order in Daftra upon checkout.
 * POST /api/v2/invoices
 *
 * customer: { name, phone, address }
 * items: current cart array
 */
async function createDaftraInvoice(customer, items) {
  // Daftra's invoice payload nests client info and line items.
  // Field names below follow Daftra's documented Invoice resource;
  // check /api/v2/invoices in your account's API docs if any of
  // this needs renaming (e.g. store_id, treasury_id may be required
  // for some accounts).
  const body = {
    Invoice: {
      client_name: customer.name,
      client_phone_1: customer.phone,
      client_address_1: customer.address,
      draft: 0, // 0 = final invoice, 1 = draft
      currency_code: "USD", // adjust to your store's currency
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

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Daftra invoice creation failed (${response.status}): ${detail}`
    );
  }

  return response.json();
}


/* ============================================================
   4. PRODUCT RENDERING
   ============================================================ */

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
  grid.innerHTML = products.map(bookCardHTML).join("");

  // Wire up "Add to Cart" buttons
  grid.querySelectorAll("[data-add-to-cart]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-add-to-cart");
      const product = productCatalog.find((p) => p.id === id);
      if (product) addToCart(product);
    });
  });
}

function bookCardHTML(book) {
  return `
    <article class="book-card">
      <div class="book-cover-wrap">
        <img src="${escapeHTML(book.image)}" alt="Cover of ${escapeHTML(book.title)}" loading="lazy" />
      </div>
      <div class="book-card-body">
        <h3 class="book-title">${escapeHTML(book.title)}</h3>
        <p class="book-author">${escapeHTML(book.author)}</p>
        <div class="book-card-footer">
          <span class="book-price">${formatPrice(book.price)}</span>
          <button type="button" class="add-to-cart-btn" data-add-to-cart="${book.id}" aria-label="Add ${escapeHTML(book.title)} to cart">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
          </button>
        </div>
      </div>
    </article>
  `;
}


/* ============================================================
   5. CART LOGIC
   ============================================================ */

function addToCart(product, quantity = 1) {
  const existing = cart.find((item) => item.id === product.id);

  if (existing) {
    existing.quantity += quantity;
  } else {
    cart.push({
      id: product.id,
      title: product.title,
      author: product.author,
      price: product.price,
      image: product.image,
      quantity,
    });
  }

  saveCart();
  updateCartUI();
  showToast(`Added "${product.title}" to cart`);
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

/**
 * Re-render everything that depends on cart state: the nav
 * counter, the cart sidebar contents, and the checkout summary.
 */
function updateCartUI() {
  // Nav badge
  document.getElementById("cart-count").textContent = cartItemCount();

  // Sidebar
  const itemsEl = document.getElementById("cart-items");
  const emptyEl = document.getElementById("cart-empty");
  const footerEl = document.getElementById("cart-footer");

  if (cart.length === 0) {
    itemsEl.classList.add("hidden");
    footerEl.classList.add("hidden");
    emptyEl.classList.remove("hidden");
  } else {
    itemsEl.classList.remove("hidden");
    footerEl.classList.remove("hidden");
    emptyEl.classList.add("hidden");
    itemsEl.innerHTML = cart.map(cartItemHTML).join("");
    wireCartItemControls(itemsEl);
  }

  document.getElementById("cart-total").textContent = formatPrice(cartTotal());

  // Checkout modal summary (kept in sync in case it's open)
  const count = cartItemCount();
  document.getElementById("checkout-item-count").textContent =
    `${count} item${count === 1 ? "" : "s"}`;
  document.getElementById("checkout-total").textContent = formatPrice(cartTotal());
}

function cartItemHTML(item) {
  return `
    <div class="cart-item" data-cart-item="${item.id}">
      <img src="${escapeHTML(item.image)}" alt="" class="cart-item-cover" />
      <div class="flex-1 min-w-0">
        <p class="cart-item-title">${escapeHTML(item.title)}</p>
        <p class="cart-item-price">${formatPrice(item.price)} each</p>
        <div class="qty-stepper">
          <button type="button" data-qty-decrease>&minus;</button>
          <span>${item.quantity}</span>
          <button type="button" data-qty-increase>+</button>
        </div>
        <button type="button" class="remove-item-btn" data-remove-item>Remove</button>
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
   6. CHECKOUT LOGIC
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

  if (!customer.name || !customer.phone || !customer.address) {
    setCheckoutStatus("Please fill in all fields.", "error");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Placing Order…";
  setCheckoutStatus("Sending your order to the shop…", "info");

  try {
    await createDaftraInvoice(customer, cart);

    setCheckoutStatus("Order placed! A confirmation is on its way.", "success");
    clearCart();
    form.reset();

    // Give the success message a moment to be seen, then close up.
    setTimeout(() => {
      closeCheckout();
      closeCart();
      setCheckoutStatus("", null);
    }, 1600);
  } catch (err) {
    console.error("submitOrder() failed:", err);
    setCheckoutStatus(
      "Something went wrong placing your order. Please try again.",
      "error"
    );
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Place Order";
  }
}

function setCheckoutStatus(message, kind) {
  const el = document.getElementById("checkout-status");
  if (!message) {
    el.classList.add("hidden");
    el.textContent = "";
    return;
  }
  el.textContent = message;
  el.classList.remove("hidden");
  el.style.color =
    kind === "error" ? "#B3452C" : kind === "success" ? "#3F7D4F" : "#12213F";
}


/* ============================================================
   7. UI WIRING (modals, nav, toast)
   ============================================================ */

function openCart() {
  document.getElementById("cart-overlay").hidden = false;
  document.getElementById("cart-panel").hidden = false;
  // next frame, so the transition actually animates in
  requestAnimationFrame(() => {
    document.getElementById("cart-overlay").classList.add("is-visible");
    document.getElementById("cart-panel").classList.add("is-open");
  });
  document.getElementById("cart-toggle").setAttribute("aria-expanded", "true");
}

function closeCart() {
  document.getElementById("cart-overlay").classList.remove("is-visible");
  document.getElementById("cart-panel").classList.remove("is-open");
  document.getElementById("cart-toggle").setAttribute("aria-expanded", "false");
  setTimeout(() => {
    document.getElementById("cart-overlay").hidden = true;
    document.getElementById("cart-panel").hidden = true;
  }, 300);
}

function openCheckout() {
  if (cart.length === 0) return;
  updateCartUI(); // make sure totals are current
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
  // Cart open/close
  document.getElementById("cart-toggle").addEventListener("click", openCart);
  document.getElementById("cart-close").addEventListener("click", closeCart);
  document.getElementById("cart-overlay").addEventListener("click", () => {
    closeCart();
    closeCheckout();
  });

  // Checkout open/close
  document.getElementById("checkout-open").addEventListener("click", openCheckout);
  document.getElementById("checkout-close").addEventListener("click", closeCheckout);
  document.getElementById("checkout-overlay").addEventListener("click", closeCheckout);
  document.getElementById("checkout-form").addEventListener("submit", submitOrder);

  // Escape key closes whichever panel is open
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    closeCheckout();
    closeCart();
  });

  // Mobile menu toggle
  const mobileToggle = document.getElementById("mobile-menu-toggle");
  const mobileMenu = document.getElementById("mobile-menu");
  mobileToggle.addEventListener("click", () => {
    const isOpen = !mobileMenu.classList.contains("hidden");
    mobileMenu.classList.toggle("hidden");
    mobileToggle.setAttribute("aria-expanded", String(!isOpen));
  });

  // Retry / refresh product fetch
  document.getElementById("products-retry").addEventListener("click", fetchProducts);
  document.getElementById("refresh-products").addEventListener("click", fetchProducts);

  document.getElementById("footer-year").textContent = new Date().getFullYear();
}


/* ============================================================
   Small helpers
   ============================================================ */

function formatPrice(amount) {
  return `${CURRENCY}${Number(amount).toFixed(2)}`;
}

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = String(str ?? "");
  return div.innerHTML;
}


/* ============================================================
   8. INIT
   ============================================================ */

document.addEventListener("DOMContentLoaded", () => {
  wireStaticUI();
  updateCartUI(); // reflect any cart persisted from a previous visit
  fetchProducts();
});
