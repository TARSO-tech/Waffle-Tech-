import {
  addRepairPart,
  adjustStock,
  archiveIngredient,
  archiveProduct,
  archiveSparePart,
  createRepairJob,
  createSale,
  deleteCustomer,
  formatCurrency,
  getDashboardSummary,
  getReport,
  getSale,
  initializeDatabase,
  listCustomers,
  listIngredients,
  listProducts,
  listRepairJobs,
  listSales,
  listSpareParts,
  listStockMovements,
  recordPayment,
  saveCustomer,
  saveIngredient,
  saveProduct,
  saveSparePart,
  toCents,
  updateRepairJob
} from "./database.js";

const app = document.querySelector("#app");
const navigation = document.querySelector("#bottom-nav");
const makeId = () => globalThis.crypto?.randomUUID?.() || `wt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const readMode = () => {
  try { return localStorage.getItem("waffle-tech-mode") === "repairs" ? "repairs" : "sales"; }
  catch { return "sales"; }
};

const state = {
  mode: readMode(),
  page: "dashboard",
  cart: [],
  checkoutKey: makeId(),
  repairKey: makeId(),
  recipeDraft: [],
  editingProduct: null,
  editingIngredient: null,
  editingPart: null,
  editingCustomer: null,
  receiptId: null,
  reportDays: 7
};

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
}[character]));
const money = cents => escapeHtml(formatCurrency(cents));
const dateTime = value => value ? escapeHtml(new Date(value).toLocaleString()) : "";
const dateLabel = value => value ? escapeHtml(new Date(value).toLocaleDateString()) : "";
const option = (value, label, selected = false) => `<option value="${escapeHtml(value)}"${selected ? " selected" : ""}>${escapeHtml(label)}</option>`;
const field = (label, input, required = false) => `<label class="field"><span>${label}${required ? " <b>*</b>" : ""}</span>${input}</label>`;
const pageTitle = (eyebrow, title, description = "") => `
  <section class="welcome">
    <p class="eyebrow">${eyebrow}</p><h1>${title}</h1>
    ${description ? `<p class="muted">${description}</p>` : ""}
  </section>`;
const emptyState = (title, description) => `
  <div class="empty-state"><span class="empty-icon">▤</span><strong>${title}</strong><p>${description}</p></div>`;

function updateModeChrome() {
  const isTech = state.mode === "repairs";
  document.body.classList.toggle("mode-tech", isTech);
  const toggle = document.querySelector("#mode-toggle");
  toggle.textContent = isTech ? "Tech Services" : "Waffle Sales";
  toggle.setAttribute("aria-label", `Switch to ${isTech ? "Waffle Sales" : "Tech Services"}`);
  toggle.setAttribute("aria-pressed", String(isTech));
  const links = isTech
    ? [["dashboard", "⌂", "Home"], ["repairs", "⚙", "Jobs"], ["customers", "♙", "Customers"], ["inventory", "▦", "Parts"], ["reports", "▥", "Reports"]]
    : [["dashboard", "⌂", "Home"], ["sales", "₱", "Sales"], ["inventory", "▦", "Products"], ["customers", "♙", "Customers"], ["transactions", "▤", "Orders"], ["reports", "▥", "Reports"]];
  navigation.innerHTML = links.map(([page, icon, label]) => `
    <button class="nav-item${state.page === page ? " active" : ""}" data-page="${page}">
      <span>${icon}</span><small>${label}</small>
    </button>`).join("");
}

function flash(message, kind = "success") {
  const container = document.querySelector("#app-flash");
  if (!container) return;
  container.innerHTML = `<div class="flash-message ${kind}" role="status">${escapeHtml(message)}</div>`;
}

function showDatabaseError(error) {
  app.innerHTML = `
    ${pageTitle(state.mode === "sales" ? "WAFFLE SALES" : "TECH SERVICES", "Database unavailable")}
    <section class="panel notice notice-error" role="alert">
      <strong>Could not open local SQLite storage</strong>
      <p>${escapeHtml(error.message || error)}</p>
      <button class="action-button primary" data-action="retry">Retry</button>
    </section>`;
}

async function renderPage(pageName = state.page) {
  if (pageName === "sales" || pageName === "repairs") state.mode = pageName;
  state.page = pageName;
  try { localStorage.setItem("waffle-tech-mode", state.mode); } catch {}
  updateModeChrome();
  app.innerHTML = `<div class="loading-state" role="status">Opening local database...</div>`;

  try {
    await initializeDatabase();
    let content;
    switch (state.page) {
      case "dashboard": content = await renderDashboard(); break;
      case "sales": content = state.mode === "sales" ? await renderSales() : await renderDashboard(); break;
      case "repairs": content = state.mode === "repairs" ? await renderRepairs() : await renderDashboard(); break;
      case "inventory": content = await renderInventory(); break;
      case "customers": content = await renderCustomers(); break;
      case "transactions": content = await renderTransactions(); break;
      case "reports": content = await renderReports(); break;
      default: state.page = "dashboard"; content = await renderDashboard();
    }
    app.innerHTML = `<div id="app-flash" aria-live="polite"></div>${content}`;
    updateModeChrome();
    window.scrollTo({ top: 0, behavior: "auto" });
  } catch (error) {
    showDatabaseError(error);
  }
}

async function renderDashboard() {
  const summary = await getDashboardSummary(state.mode);
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  if (state.mode === "sales") {
    const recent = await listSales(5);
    return `
      ${pageTitle("WAFFLE SALES", "Sales overview", today)}
      <section class="stats-grid" aria-label="Sales summary">
        <article class="stat-card"><span class="stat-icon yellow">₱</span><p>Today's sales</p><h2>${money(summary.total_cents)}</h2><small>Completed and partial payments</small></article>
        <article class="stat-card"><span class="stat-icon brown">▤</span><p>Transactions</p><h2>${summary.transaction_count}</h2><small>Today's orders</small></article>
        <article class="stat-card"><span class="stat-icon green">▦</span><p>Products</p><h2>${summary.product_count}</h2><small>Active catalog items</small></article>
        <article class="stat-card"><span class="stat-icon yellow">!</span><p>Low stock</p><h2>${summary.low_stock_count}</h2><small>Ingredients at threshold</small></article>
      </section>
      <section class="panel"><div class="section-heading"><div><p class="eyebrow">SELL</p><h2>Quick actions</h2></div></div><div class="actions-grid">
        <button class="action-button primary" data-page="sales"><span>＋</span> New Sale</button>
        <button class="action-button" data-page="inventory"><span>▦</span> Products & Stock</button>
        <button class="action-button" data-page="customers"><span>♙</span> Customers</button>
      </div></section>
      <section class="panel"><div class="section-heading"><div><p class="eyebrow">ORDER HISTORY</p><h2>Recent transactions</h2></div><button class="text-button" data-page="transactions">View all</button></div>
        ${recent.length ? `<div class="record-list">${recent.map(sale => `<button class="record-row" data-receipt="${escapeHtml(sale.id)}"><span><strong>${escapeHtml(sale.customer_name || "Walk-in")}</strong><small>${dateTime(sale.created_at)} · ${sale.id.slice(0, 8)}</small></span><b>${money(sale.total_cents)}</b></button>`).join("")}</div>` : emptyState("No transactions yet", "Completed sales will appear here.")}
      </section>`;
  }

  const recent = await listRepairJobs(5);
  return `
    ${pageTitle("TECH SERVICES", "Service overview", today)}
    <section class="stats-grid" aria-label="Service summary">
      <article class="stat-card"><span class="stat-icon blue">⚙</span><p>Active jobs</p><h2>${summary.active_jobs}</h2><small>Currently in service</small></article>
      <article class="stat-card"><span class="stat-icon green">✓</span><p>Completed today</p><h2>${summary.completed_today}</h2><small>Ready for pickup</small></article>
      <article class="stat-card"><span class="stat-icon blue-light">◷</span><p>Awaiting review</p><h2>${summary.awaiting_review}</h2><small>Needs assessment</small></article>
      <article class="stat-card"><span class="stat-icon blue">▦</span><p>Low stock</p><h2>${summary.low_stock_count}</h2><small>Spare parts at threshold</small></article>
    </section>
    <section class="panel"><div class="section-heading"><div><p class="eyebrow">SERVICE DESK</p><h2>Quick actions</h2></div></div><div class="actions-grid">
      <button class="action-button primary" data-page="repairs"><span>＋</span> New Repair</button>
      <button class="action-button" data-page="inventory"><span>▦</span> Spare Parts</button>
      <button class="action-button" data-page="customers"><span>♙</span> Customers</button>
    </div></section>
    <section class="panel"><div class="section-heading"><div><p class="eyebrow">WORK QUEUE</p><h2>Recent repair jobs</h2></div><button class="text-button" data-page="repairs">View all</button></div>
      ${recent.length ? `<div class="record-list">${recent.map(job => `<div class="record-row"><span><strong>${escapeHtml(job.job_number)} · ${escapeHtml(job.device_type)} ${escapeHtml(job.model)}</strong><small>${escapeHtml(job.customer_name)} · ${escapeHtml(job.status.replaceAll("_", " "))}</small></span><b>${money(Number(job.service_charge_cents) + Number(job.parts_total_cents))}</b></div>`).join("")}</div>` : emptyState("No repair jobs yet", "Create a service job to begin tracking repairs.")}
    </section>`;
}

async function renderSales() {
  const [products, customers] = await Promise.all([listProducts(), listCustomers("sales")]);
  const cartTotal = state.cart.reduce((sum, line) => sum + Number(line.product.price_cents) * line.quantity, 0);
  const productOptions = products.map(product => option(product.id, `${product.name} · ${money(product.price_cents)}`)).join("");
  const customerOptions = customers.map(customer => option(customer.id, `${customer.name}${customer.phone ? ` · ${customer.phone}` : ""}`)).join("");
  return `
    ${pageTitle("WAFFLE SALES", "New sale", "Checkout deducts recipe ingredients in the same database transaction.")}
    <section class="panel"><div class="section-heading"><div><p class="eyebrow">PRODUCTS</p><h2>Add to order</h2></div></div>
      ${products.length ? `<form class="form-grid compact-grid" data-form="cart-add">
        ${field("Product", `<select name="productId" required>${productOptions}</select>`, true)}
        ${field("Quantity", '<input name="quantity" type="number" min="1" step="1" value="1" required>', true)}
        <button class="action-button primary form-action"><span>＋</span> Add item</button>
      </form>` : `${emptyState("No products in the catalog", "Add products and ingredient recipes in Products & Stock.")}<button class="action-button primary" data-page="inventory">Open Products & Stock</button>`}
    </section>
    <section class="panel"><div class="section-heading"><div><p class="eyebrow">CURRENT ORDER</p><h2>Cart · ${money(cartTotal)}</h2></div></div>
      ${state.cart.length ? `<div class="record-list">${state.cart.map(line => `<div class="record-row"><span><strong>${escapeHtml(line.product.name)}</strong><small>${line.quantity} × ${money(line.product.price_cents)}</small></span><b>${money(line.quantity * line.product.price_cents)}</b><div class="row-actions"><button class="icon-button" data-action="cart-minus" data-id="${escapeHtml(line.product.id)}" aria-label="Decrease quantity">−</button><button class="icon-button" data-action="cart-plus" data-id="${escapeHtml(line.product.id)}" aria-label="Increase quantity">＋</button><button class="icon-button danger" data-action="cart-remove" data-id="${escapeHtml(line.product.id)}" aria-label="Remove item">×</button></div></div>`).join("")}</div>
        <form class="form-grid" data-form="checkout">
          ${field("Customer", `<select name="customerId"><option value="">Walk-in customer</option>${customerOptions}</select>`)}
          ${field("Discount (PHP)", '<input name="discount" type="number" min="0" step="0.01" value="0">')}
          ${field("Amount tendered (PHP)", '<input name="paid" type="number" min="0" step="0.01" value="0">')}
          ${field("Payment method", '<select name="paymentMethod"><option>cash</option><option>card</option><option>e-wallet</option><option>bank transfer</option></select>')}
          <input type="hidden" name="idempotencyKey" value="${escapeHtml(state.checkoutKey)}">
          <button class="action-button primary form-action" type="submit"><span>✓</span> Complete sale</button>
        </form>` : emptyState("Cart is empty", "Choose products above to start an order.")}
    </section>`;
}

function renderRecipeDraft(ingredients) {
  return `
    <div class="recipe-editor"><h3>Ingredient recipe</h3>
      ${state.recipeDraft.length ? `<div class="recipe-lines">${state.recipeDraft.map((line, index) => {
        const ingredient = ingredients.find(item => item.id === line.ingredientId);
        return `<div class="recipe-line"><span>${escapeHtml(ingredient?.name || "Missing ingredient")} · ${escapeHtml(line.quantity)} ${escapeHtml(ingredient?.unit || "")}</span><button class="icon-button danger" type="button" data-action="recipe-remove" data-index="${index}" aria-label="Remove ingredient">×</button></div>`;
      }).join("")}</div>` : '<p class="muted">Add the ingredients deducted for each unit sold.</p>'}
      ${ingredients.length ? `<div class="recipe-add"><select id="recipe-ingredient">${ingredients.map(item => option(item.id, `${item.name} (${item.unit})`)).join("")}</select><input id="recipe-quantity" type="number" min="0.001" step="any" value="1" aria-label="Quantity per product"><button class="action-button" type="button" data-action="recipe-add">Add ingredient</button></div>` : '<p class="muted">Create an ingredient before adding a recipe.</p>'}
    </div>`;
}

function stockAdjustmentForm(item) {
  return `<form class="stock-adjustment" data-form="stock-adjustment">
    <input type="hidden" name="itemId" value="${escapeHtml(item.id)}">
    <input type="hidden" name="idempotencyKey" value="${makeId()}">
    ${field("Adjust stock (+/-)", '<input name="delta" type="number" step="any" required>')}
    ${field("Reason", '<input name="reason" maxlength="120" required>')}
    <button class="action-button" type="submit">Save adjustment</button>
  </form>`;
}

async function renderInventory() {
  if (state.mode === "sales") {
    const [products, ingredients, movements] = await Promise.all([listProducts(), listIngredients(), listStockMovements("sales")]);
    const product = state.editingProduct;
    const ingredient = state.editingIngredient;
    return `
      ${pageTitle("WAFFLE SALES", "Products & ingredients", "Manage the catalog, recipes, and ingredient stock.")}
      <section class="panel"><div class="section-heading"><div><p class="eyebrow">CATALOG</p><h2>${product ? "Edit product" : "Add product"}</h2></div>${product ? '<button class="text-button" data-action="cancel-product">Cancel edit</button>' : ""}</div>
        <form class="form-grid" data-form="product">
          <input type="hidden" name="id" value="${escapeHtml(product?.id || "")}">
          ${field("Product name", `<input name="name" maxlength="100" value="${escapeHtml(product?.name || "")}" required>`, true)}
          ${field("Category", `<input name="category" maxlength="60" value="${escapeHtml(product?.category || "")}" placeholder="Waffle, drink, add-on">`)}
          ${field("Price (PHP)", `<input name="price" type="number" min="0" step="0.01" value="${product ? (Number(product.price_cents) / 100).toFixed(2) : ""}" required>`, true)}
          ${renderRecipeDraft(ingredients)}
          <button class="action-button primary form-action" type="submit">${product ? "Save product" : "Add product"}</button>
        </form>
      </section>
      <section class="panel"><div class="section-heading"><div><p class="eyebrow">INGREDIENT INVENTORY</p><h2>${ingredient ? "Edit ingredient" : "Add ingredient"}</h2></div>${ingredient ? '<button class="text-button" data-action="cancel-ingredient">Cancel edit</button>' : ""}</div>
        <form class="form-grid" data-form="ingredient">
          <input type="hidden" name="id" value="${escapeHtml(ingredient?.id || "")}">
          ${field("Ingredient", `<input name="name" maxlength="100" value="${escapeHtml(ingredient?.name || "")}" required>`, true)}
          ${field("Unit", `<input name="unit" maxlength="24" value="${escapeHtml(ingredient?.unit || "unit")}" required>`, true)}
          ${field(`${ingredient ? "" : "Initial "}quantity`, `<input name="quantity" type="number" min="0" step="any" value="${ingredient ? Number(ingredient.quantity) : "0"}"${ingredient ? " disabled" : ""}>`)}
          ${field("Low-stock threshold", `<input name="lowStockThreshold" type="number" min="0" step="any" value="${Number(ingredient?.low_stock_threshold || 0)}">`)}
          <button class="action-button primary form-action" type="submit">${ingredient ? "Save ingredient" : "Add ingredient"}</button>
        </form>
      </section>
      <section class="panel"><div class="section-heading"><div><p class="eyebrow">ACTIVE CATALOG</p><h2>Products (${products.length})</h2></div></div>
        ${products.length ? `<div class="record-list">${products.map(item => `<article class="inventory-record"><div class="record-row"><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.category || "Uncategorized")} · ${item.recipe.map(line => `${escapeHtml(line.name)} ${escapeHtml(line.quantity_per_product)} ${escapeHtml(line.unit)}`).join(", ") || "Recipe not configured"}</small></span><b>${money(item.price_cents)}</b></div><div class="row-actions"><button class="action-button" data-action="edit-product" data-id="${escapeHtml(item.id)}">Edit</button><button class="action-button danger" data-action="archive-product" data-id="${escapeHtml(item.id)}">Archive</button></div></article>`).join("")}</div>` : emptyState("No products yet", "Add a product and its ingredient recipe above.")}
      </section>
      <section class="panel"><div class="section-heading"><div><p class="eyebrow">STOCK ON HAND</p><h2>Ingredients (${ingredients.length})</h2></div></div>
        ${ingredients.length ? `<div class="record-list">${ingredients.map(item => `<article class="inventory-record"><div class="record-row"><span><strong>${escapeHtml(item.name)}</strong><small>Low-stock threshold: ${escapeHtml(item.low_stock_threshold)} ${escapeHtml(item.unit)}</small></span><b class="${Number(item.quantity) <= Number(item.low_stock_threshold) ? "stock-low" : ""}">${escapeHtml(item.quantity)} ${escapeHtml(item.unit)}</b></div>${stockAdjustmentForm(item)}<div class="row-actions"><button class="action-button" data-action="edit-ingredient" data-id="${escapeHtml(item.id)}">Edit</button><button class="action-button danger" data-action="archive-ingredient" data-id="${escapeHtml(item.id)}">Archive</button></div></article>`).join("")}</div>` : emptyState("No ingredients yet", "Add ingredients and quantities above.")}
      </section>
      ${renderMovementHistory(movements)}`;
  }

  const [parts, movements] = await Promise.all([listSpareParts(), listStockMovements("repairs")]);
  const part = state.editingPart;
  return `
    ${pageTitle("TECH SERVICES", "Spare parts", "Track repair stock and record each adjustment.")}
    <section class="panel"><div class="section-heading"><div><p class="eyebrow">PART CATALOG</p><h2>${part ? "Edit spare part" : "Add spare part"}</h2></div>${part ? '<button class="text-button" data-action="cancel-part">Cancel edit</button>' : ""}</div>
      <form class="form-grid" data-form="spare-part">
        <input type="hidden" name="id" value="${escapeHtml(part?.id || "")}">
        ${field("Part name", `<input name="name" maxlength="100" value="${escapeHtml(part?.name || "")}" required>`, true)}
        ${field("SKU", `<input name="sku" maxlength="50" value="${escapeHtml(part?.sku || "")}">`)}
        ${field("Unit", `<input name="unit" maxlength="24" value="${escapeHtml(part?.unit || "unit")}" required>`, true)}
        ${field(`${part ? "" : "Initial "}quantity`, `<input name="quantity" type="number" min="0" step="any" value="${part ? Number(part.quantity) : "0"}"${part ? " disabled" : ""}>`)}
        ${field("Price (PHP)", `<input name="price" type="number" min="0" step="0.01" value="${part ? (Number(part.price_cents) / 100).toFixed(2) : "0.00"}">`)}
        ${field("Low-stock threshold", `<input name="lowStockThreshold" type="number" min="0" step="any" value="${Number(part?.low_stock_threshold || 0)}">`)}
        <button class="action-button primary form-action" type="submit">${part ? "Save part" : "Add spare part"}</button>
      </form>
    </section>
    <section class="panel"><div class="section-heading"><div><p class="eyebrow">STOCK ON HAND</p><h2>Spare parts (${parts.length})</h2></div></div>
      ${parts.length ? `<div class="record-list">${parts.map(item => `<article class="inventory-record"><div class="record-row"><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.sku || "No SKU")} · Low-stock threshold ${escapeHtml(item.low_stock_threshold)} ${escapeHtml(item.unit)}</small></span><b class="${Number(item.quantity) <= Number(item.low_stock_threshold) ? "stock-low" : ""}">${escapeHtml(item.quantity)} ${escapeHtml(item.unit)}</b></div>${stockAdjustmentForm(item)}<div class="row-actions"><button class="action-button" data-action="edit-part" data-id="${escapeHtml(item.id)}">Edit</button><button class="action-button danger" data-action="archive-part" data-id="${escapeHtml(item.id)}">Archive</button></div></article>`).join("")}</div>` : emptyState("No spare parts yet", "Add parts and starting quantities above.")}
    </section>
    ${renderMovementHistory(movements)}`;
}

function renderMovementHistory(movements) {
  return `<section class="panel"><div class="section-heading"><div><p class="eyebrow">AUDIT TRAIL</p><h2>Recent stock adjustments</h2></div></div>
    ${movements.length ? `<div class="record-list">${movements.slice(0, 30).map(item => `<div class="record-row"><span><strong>${escapeHtml(item.reason)} · ${escapeHtml(item.item_name)}</strong><small>${dateTime(item.created_at)}</small></span><b class="${Number(item.quantity_delta) < 0 ? "stock-low" : ""}">${Number(item.quantity_delta) > 0 ? "+" : ""}${escapeHtml(item.quantity_delta)}</b></div>`).join("")}</div>` : emptyState("No stock movements yet", "Adjustments and automatic deductions will be recorded here.")}
  </section>`;
}

async function renderCustomers() {
  const customers = await listCustomers(state.mode);
  const customer = state.editingCustomer;
  return `
    ${pageTitle(state.mode === "sales" ? "WAFFLE SALES" : "TECH SERVICES", "Customers", "Shared customer records, with activity scoped to the current mode.")}
    <section class="panel"><div class="section-heading"><div><p class="eyebrow">CUSTOMER DETAILS</p><h2>${customer ? "Edit customer" : "Register customer"}</h2></div>${customer ? '<button class="text-button" data-action="cancel-customer">Cancel edit</button>' : ""}</div>
      <form class="form-grid" data-form="customer">
        <input type="hidden" name="id" value="${escapeHtml(customer?.id || "")}">
        ${field("Full name", `<input name="name" maxlength="100" value="${escapeHtml(customer?.name || "")}" required>`, true)}
        ${field("Phone", `<input name="phone" type="tel" maxlength="40" value="${escapeHtml(customer?.phone || "")}">`)}
        ${field("Email", `<input name="email" type="email" maxlength="120" value="${escapeHtml(customer?.email || "")}">`)}
        ${field("Address", `<input name="address" maxlength="200" value="${escapeHtml(customer?.address || "")}">`)}
        ${field("Notes", `<textarea name="notes" rows="2" maxlength="500">${escapeHtml(customer?.notes || "")}</textarea>`)}
        <button class="action-button primary form-action" type="submit">${customer ? "Save changes" : "Register customer"}</button>
      </form>
    </section>
    <section class="panel"><div class="section-heading"><div><p class="eyebrow">DIRECTORY</p><h2>Customers (${customers.length})</h2></div></div>
      ${customers.length ? `<div class="record-list">${customers.map(item => `<article class="inventory-record"><div class="record-row"><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.phone || item.email || "No contact details")} · ${Number(item.activity_count)} ${state.mode === "sales" ? "orders" : "jobs"}</small></span><b>${dateLabel(item.created_at)}</b></div><div class="row-actions"><button class="action-button" data-action="edit-customer" data-id="${escapeHtml(item.id)}">Edit</button><button class="action-button danger" data-action="delete-customer" data-id="${escapeHtml(item.id)}">Delete</button></div></article>`).join("")}</div>` : emptyState("No customers yet", "Register a customer above.")}
    </section>`;
}

async function renderRepairCard(job, parts) {
  const balance = Number(job.service_charge_cents) + Number(job.parts_total_cents) - Number(job.paid_cents);
  const partOptions = parts.map(part => option(part.id, `${part.name} · ${part.quantity} ${part.unit} available · ${money(part.price_cents)}`)).join("");
  const statuses = ["received", "diagnosing", "waiting_parts", "in_progress", "ready", "completed", "cancelled"];
  return `<article class="repair-card">
    <div class="record-row"><span><strong>${escapeHtml(job.job_number)} · ${escapeHtml(job.device_type)} ${escapeHtml(job.brand)} ${escapeHtml(job.model)}</strong><small>${escapeHtml(job.customer_name)} · ${dateTime(job.created_at)}</small></span><b class="status-pill">${escapeHtml(job.status.replaceAll("_", " "))}</b></div>
    <p><strong>Reported issue:</strong> ${escapeHtml(job.reported_issue)}</p>
    ${job.serial_number ? `<p><strong>Serial:</strong> ${escapeHtml(job.serial_number)}</p>` : ""}
    <p><strong>Diagnosis:</strong> ${escapeHtml(job.diagnosis || "Not entered")}</p>
    <form class="form-grid compact-grid" data-form="repair-update">
      <input type="hidden" name="id" value="${escapeHtml(job.id)}">
      ${field("Device type", `<input name="deviceType" maxlength="60" value="${escapeHtml(job.device_type)}" required>`)}
      ${field("Brand", `<input name="brand" maxlength="60" value="${escapeHtml(job.brand)}">`)}
      ${field("Model", `<input name="model" maxlength="80" value="${escapeHtml(job.model)}">`)}
      ${field("Serial / IMEI", `<input name="serialNumber" maxlength="100" value="${escapeHtml(job.serial_number)}">`)}
      ${field("Reported issue", `<input name="reportedIssue" maxlength="1000" value="${escapeHtml(job.reported_issue)}" required>`)}
      ${field("Service charge (PHP)", `<input name="serviceCharge" type="number" min="0" step="0.01" value="${(Number(job.service_charge_cents) / 100).toFixed(2)}" required>`)}
      ${field("Status", `<select name="status">${statuses.map(status => option(status, status.replaceAll("_", " "), status === job.status)).join("")}</select>`)}
      ${field("Diagnosis / notes", `<input name="diagnosis" maxlength="500" value="${escapeHtml(job.diagnosis)}">`)}
      <button class="action-button" type="submit">Update job</button>
    </form>
    ${job.parts.length ? `<div class="job-parts"><strong>Parts used</strong>${job.parts.map(part => `<div>${escapeHtml(part.part_name)} · ${escapeHtml(part.quantity)} × ${money(part.unit_price_cents)} = ${money(part.line_total_cents)}</div>`).join("")}</div>` : ""}
    ${job.payments.length ? `<div class="job-parts"><strong>Payments received</strong>${job.payments.map(payment => `<div>${dateTime(payment.created_at)} · ${escapeHtml(payment.method)}${payment.reference ? ` · ${escapeHtml(payment.reference)}` : ""} · ${money(payment.amount_cents)}</div>`).join("")}</div>` : ""}
    ${!['completed', 'cancelled'].includes(job.status) && parts.length ? `<form class="form-grid compact-grid" data-form="repair-part">
      <input type="hidden" name="repairJobId" value="${escapeHtml(job.id)}">
      <input type="hidden" name="idempotencyKey" value="${makeId()}">
      ${field("Spare part", `<select name="partId" required>${partOptions}</select>`)}
      ${field("Quantity", '<input name="quantity" type="number" min="0.001" step="any" value="1" required>')}
      <button class="action-button" type="submit">Add part / deduct stock</button>
    </form>` : ""}
    <div class="job-totals"><span>Service ${money(job.service_charge_cents)} + parts ${money(job.parts_total_cents)}</span><strong>Balance ${money(balance)}</strong></div>
    ${balance > 0 ? `<form class="form-grid compact-grid" data-form="repair-payment">
      <input type="hidden" name="repairJobId" value="${escapeHtml(job.id)}">
      <input type="hidden" name="idempotencyKey" value="${makeId()}">
      ${field("Payment (PHP)", `<input name="amount" type="number" min="0.01" max="${(balance / 100).toFixed(2)}" step="0.01" required>`)}
      ${field("Method", '<select name="method"><option>cash</option><option>card</option><option>e-wallet</option><option>bank transfer</option></select>')}
      ${field("Reference (optional)", '<input name="reference" maxlength="120">')}
      <button class="action-button" type="submit">Record payment</button>
    </form>` : '<p class="paid-badge">Paid in full</p>'}
  </article>`;
}

async function renderRepairs() {
  const [customers, parts, jobs] = await Promise.all([listCustomers("repairs"), listSpareParts(), listRepairJobs()]);
  const customerOptions = customers.map(customer => option(customer.id, `${customer.name}${customer.phone ? ` · ${customer.phone}` : ""}`)).join("");
  const cards = await Promise.all(jobs.map(job => renderRepairCard(job, parts)));
  return `
    ${pageTitle("TECH SERVICES", "Repair jobs", "Register devices, track status, use spare parts, and record payments.")}
    <section class="panel"><div class="section-heading"><div><p class="eyebrow">SERVICE INTAKE</p><h2>New repair job</h2></div></div>
      ${customers.length ? `<form class="form-grid" data-form="repair-create">
        ${field("Customer", `<select name="customerId" required>${customerOptions}</select>`, true)}
        ${field("Device type", '<input name="deviceType" maxlength="60" placeholder="Phone, laptop, tablet" required>', true)}
        ${field("Brand", '<input name="brand" maxlength="60">')}
        ${field("Model", '<input name="model" maxlength="80">')}
        ${field("Serial / IMEI", '<input name="serialNumber" maxlength="100">')}
        ${field("Reported issue", '<textarea name="reportedIssue" rows="3" maxlength="1000" required></textarea>', true)}
        ${field("Service charge (PHP)", '<input name="serviceCharge" type="number" min="0" step="0.01" value="0">')}
        ${field("Initial payment (PHP)", '<input name="paid" type="number" min="0" step="0.01" value="0">')}
        ${field("Payment method", '<select name="paymentMethod"><option>cash</option><option>card</option><option>e-wallet</option><option>bank transfer</option></select>')}
        <input type="hidden" name="idempotencyKey" value="${escapeHtml(state.repairKey)}">
        <button class="action-button primary form-action" type="submit">Create repair job</button>
      </form>` : `${emptyState("Register a customer first", "Repair jobs are linked to shared customer records.")}<button class="action-button primary" data-page="customers">Open customers</button>`}
    </section>
    <section class="panel"><div class="section-heading"><div><p class="eyebrow">SERVICE HISTORY</p><h2>Repair jobs (${jobs.length})</h2></div></div>
      ${cards.length ? `<div class="repair-list">${cards.join("")}</div>` : emptyState("No repair jobs yet", "New repair jobs will appear here.")}
    </section>`;
}

async function renderTransactions() {
  const [sales, selected] = await Promise.all([listSales(200), state.receiptId ? getSale(state.receiptId) : null]);
  const receipt = selected ? renderReceipt(selected) : "";
  const rows = sales.map(sale => {
    const balance = Number(sale.total_cents) - Number(sale.paid_cents);
    const paymentForm = balance > 0 ? `
      <form class="form-grid compact-grid" data-form="sale-payment">
        <input type="hidden" name="saleId" value="${escapeHtml(sale.id)}">
        <input type="hidden" name="idempotencyKey" value="${makeId()}">
        ${field("Payment (PHP)", `<input name="amount" type="number" min="0.01" max="${(balance / 100).toFixed(2)}" step="0.01" required>`)}
        ${field("Method", '<select name="method"><option>cash</option><option>card</option><option>e-wallet</option><option>bank transfer</option></select>')}
        ${field("Reference (optional)", '<input name="reference" maxlength="120">')}
        <button class="action-button" type="submit">Record payment</button>
      </form>` : "";
    return `<article class="inventory-record">
      <button class="record-row record-button" data-receipt="${escapeHtml(sale.id)}">
        <span><strong>${escapeHtml(sale.customer_name || "Walk-in")}</strong><small>${dateTime(sale.created_at)} · ${escapeHtml(sale.payment_method)}</small></span><b>${money(sale.total_cents)}</b>
      </button>
      <div class="row-actions"><span>Paid ${money(sale.paid_cents)}${balance ? ` · Due ${money(balance)}` : " · Paid"}</span><button class="action-button" data-receipt="${escapeHtml(sale.id)}">View receipt</button></div>
      ${paymentForm}
    </article>`;
  });
  return `
    ${pageTitle("WAFFLE SALES", "Transactions & receipts", "Every sale is saved with its line items and payment record.")}
    ${receipt}
    <section class="panel"><div class="section-heading"><div><p class="eyebrow">SALES LEDGER</p><h2>Transactions (${sales.length})</h2></div></div>
      ${sales.length ? `<div class="record-list">${rows.join("")}</div>` : emptyState("No transactions yet", "Completed sales and receipts will appear here.")}
    </section>`;
}

function renderReceipt(sale) {
  return `<section class="panel receipt" id="receipt"><div class="section-heading"><div><p class="eyebrow">WAFFLE TECH · RECEIPT</p><h2>${escapeHtml(sale.id.slice(0, 12).toUpperCase())}</h2><small>${dateTime(sale.created_at)}</small></div><button class="action-button" data-action="print-receipt">Print</button></div>
    <p>Customer: ${escapeHtml(sale.customer_name || "Walk-in")}</p>
    <div class="record-list">${sale.items.map(item => `<div class="record-row"><span>${escapeHtml(item.product_name)} × ${escapeHtml(item.quantity)}</span><b>${money(item.line_total_cents)}</b></div>`).join("")}</div>
    <div class="receipt-totals"><p>Subtotal <b>${money(sale.subtotal_cents)}</b></p><p>Discount <b>−${money(sale.discount_cents)}</b></p><p>Total <b>${money(sale.total_cents)}</b></p><p>Paid <b>${money(sale.paid_cents)}</b></p><p>Change <b>${money(sale.change_cents)}</b></p></div>
    ${sale.payments.length ? `<div class="job-parts"><strong>Payments</strong>${sale.payments.map(payment => `<div>${dateTime(payment.created_at)} · ${escapeHtml(payment.method)}${payment.reference ? ` · ${escapeHtml(payment.reference)}` : ""} · ${money(payment.amount_cents)}</div>`).join("")}</div>` : ""}
  </section>`;
}

async function renderReports() {
  const start = new Date();
  if (state.reportDays === 7) start.setDate(start.getDate() - 6);
  if (state.reportDays === 30) start.setDate(1);
  if (state.reportDays === 365) start.setMonth(0, 1);
  start.setHours(0, 0, 0, 0);
  const report = await getReport(state.mode, start.toISOString());
  const summary = report.summary || { count: 0, total: 0, paid: 0 };
  const rows = state.mode === "sales" ? report.popular : report.popularParts;
  const rowTitle = state.mode === "sales" ? "Popular products" : "Parts used";
  return `
    ${pageTitle(state.mode === "sales" ? "WAFFLE SALES" : "TECH SERVICES", "Reports", "Local reports are calculated from saved transactions and job history.")}
    <section class="panel report-filters"><div class="section-heading"><div><p class="eyebrow">REPORT PERIOD</p><h2>${state.reportDays === 1 ? "Daily" : state.reportDays === 7 ? "Weekly" : state.reportDays === 30 ? "Monthly" : "Year to date"} summary</h2></div></div>
      <div class="segmented-control"><button class="${state.reportDays === 1 ? "selected" : ""}" data-range="1">Daily</button><button class="${state.reportDays === 7 ? "selected" : ""}" data-range="7">Weekly</button><button class="${state.reportDays === 30 ? "selected" : ""}" data-range="30">Monthly</button><button class="${state.reportDays === 365 ? "selected" : ""}" data-range="365">Year</button></div>
    </section>
    <section class="stats-grid" aria-label="Report totals">
      <article class="stat-card"><p>${state.mode === "sales" ? "Transactions" : "Repair jobs"}</p><h2>${Number(summary.count || 0)}</h2></article>
      <article class="stat-card"><p>${state.mode === "sales" ? "Sales total" : "Service charges + parts"}</p><h2>${money(summary.total)}</h2></article>
      <article class="stat-card"><p>Payments received</p><h2>${money(summary.paid)}</h2></article>
    </section>
    ${state.mode === "repairs" ? `<section class="panel"><div class="section-heading"><div><p class="eyebrow">JOB STATUS</p><h2>Status breakdown</h2></div></div>${report.statuses.length ? `<div class="record-list">${report.statuses.map(item => `<div class="record-row"><span>${escapeHtml(item.status.replaceAll("_", " "))}</span><b>${Number(item.count)}</b></div>`).join("")}</div>` : emptyState("No repair activity", "Jobs will be summarized here.")}</section>` : ""}
    <section class="panel"><div class="section-heading"><div><p class="eyebrow">DAILY TOTALS</p><h2>By day</h2></div></div>${report.days.length ? `<div class="record-list">${report.days.map(day => `<div class="record-row"><span>${escapeHtml(day.day)} · ${Number(day.count)} ${state.mode === "sales" ? "orders" : "jobs"}</span><b>${money(day.total_cents)}</b></div>`).join("")}</div>` : emptyState("No activity for this period", "Saved activity will appear in this report.")}</section>
    <section class="panel"><div class="section-heading"><div><p class="eyebrow">${state.mode === "sales" ? "PRODUCT MIX" : "PARTS USAGE"}</p><h2>${rowTitle}</h2></div></div>${rows.length ? `<div class="record-list">${rows.map(item => `<div class="record-row"><span>${escapeHtml(state.mode === "sales" ? item.product_name : item.part_name)} · ${Number(item.quantity)} units</span><b>${money(item.total_cents)}</b></div>`).join("")}</div>` : emptyState("No item activity", "Item totals will appear after recorded sales or part usage.")}</section>`;
}

function formValues(form) {
  if (["stock-adjustment", "repair-part", "repair-payment", "sale-payment"].includes(form.dataset.form)
    && !form.elements.namedItem("idempotencyKey")) {
    const key = document.createElement("input");
    key.type = "hidden";
    key.name = "idempotencyKey";
    key.value = makeId();
    form.append(key);
  }
  return Object.fromEntries(new FormData(form).entries());
}

async function handleSubmit(form) {
  const values = formValues(form);
  switch (form.dataset.form) {
    case "cart-add": {
      const products = await listProducts();
      const product = products.find(item => item.id === values.productId);
      if (!product) throw new Error("That product is no longer available.");
      const quantity = Math.floor(Number(values.quantity));
      const existing = state.cart.find(line => line.product.id === product.id);
      if (existing) existing.quantity += quantity;
      else state.cart.push({ product, quantity });
      await renderPage("sales");
      flash("Item added to the order.");
      break;
    }
    case "checkout": {
      const id = await createSale({
        idempotencyKey: values.idempotencyKey,
        customerId: values.customerId || null,
        items: state.cart.map(line => ({ productId: line.product.id, quantity: line.quantity })),
        discountCents: toCents(values.discount),
        paidCents: toCents(values.paid),
        paymentMethod: values.paymentMethod
      });
      state.cart = [];
      state.checkoutKey = makeId();
      state.receiptId = id;
      await renderPage("transactions");
      flash("Sale saved. Ingredient stock was deducted.");
      break;
    }
    case "product":
      await saveProduct({ id: values.id || null, name: values.name, category: values.category, priceCents: toCents(values.price), recipe: state.recipeDraft });
      state.editingProduct = null;
      state.recipeDraft = [];
      await renderPage("inventory");
      flash("Product saved.");
      break;
    case "ingredient":
      await saveIngredient({ id: values.id || null, name: values.name, unit: values.unit, quantity: Number(values.quantity || 0), lowStockThreshold: Number(values.lowStockThreshold || 0) });
      state.editingIngredient = null;
      await renderPage("inventory");
      flash("Ingredient saved.");
      break;
    case "spare-part":
      await saveSparePart({ id: values.id || null, name: values.name, sku: values.sku, unit: values.unit, quantity: Number(values.quantity || 0), priceCents: toCents(values.price), lowStockThreshold: Number(values.lowStockThreshold || 0) });
      state.editingPart = null;
      await renderPage("inventory");
      flash("Spare part saved.");
      break;
    case "stock-adjustment":
      await adjustStock({ mode: state.mode, itemId: values.itemId, delta: Number(values.delta), reason: values.reason, idempotencyKey: values.idempotencyKey });
      await renderPage("inventory");
      flash("Stock adjustment saved.");
      break;
    case "customer":
      await saveCustomer(values);
      state.editingCustomer = null;
      await renderPage("customers");
      flash("Customer record saved.");
      break;
    case "repair-create":
      await createRepairJob({
        ...values,
        serviceChargeCents: toCents(values.serviceCharge),
        paidCents: toCents(values.paid)
      });
      state.repairKey = makeId();
      await renderPage("repairs");
      flash("Repair job created.");
      break;
    case "repair-update":
      await updateRepairJob(values.id, { ...values, serviceChargeCents: toCents(values.serviceCharge) });
      await renderPage("repairs");
      flash("Repair status updated.");
      break;
    case "repair-part":
      await addRepairPart(values);
      await renderPage("repairs");
      flash("Part added and spare stock deducted.");
      break;
    case "repair-payment":
    case "sale-payment":
      await recordPayment({
        saleId: values.saleId || null,
        repairJobId: values.repairJobId || null,
        idempotencyKey: values.idempotencyKey,
        amountCents: toCents(values.amount),
        method: values.method,
        reference: values.reference || ""
      });
      await renderPage(state.page);
      flash("Payment recorded.");
      break;
    default: throw new Error("This form is not supported.");
  }
}

async function handleAction(button) {
  const id = button.dataset.id;
  switch (button.dataset.action) {
    case "retry": await renderPage(state.page); break;
    case "recipe-add": {
      const ingredientId = document.querySelector("#recipe-ingredient")?.value;
      const quantity = Number(document.querySelector("#recipe-quantity")?.value);
      if (!ingredientId || !Number.isFinite(quantity) || quantity <= 0) throw new Error("Choose an ingredient and a positive recipe quantity.");
      const current = state.recipeDraft.find(line => line.ingredientId === ingredientId);
      if (current) current.quantity += quantity;
      else state.recipeDraft.push({ ingredientId, quantity });
      await renderPage("inventory");
      break;
    }
    case "recipe-remove":
      state.recipeDraft.splice(Number(button.dataset.index), 1);
      await renderPage("inventory");
      break;
    case "cancel-product": state.editingProduct = null; state.recipeDraft = []; await renderPage("inventory"); break;
    case "cancel-ingredient": state.editingIngredient = null; await renderPage("inventory"); break;
    case "cancel-part": state.editingPart = null; await renderPage("inventory"); break;
    case "cancel-customer": state.editingCustomer = null; await renderPage("customers"); break;
    case "edit-product": {
      const products = await listProducts();
      state.editingProduct = products.find(item => item.id === id) || null;
      state.recipeDraft = state.editingProduct?.recipe.map(line => ({ ingredientId: line.ingredient_id, quantity: Number(line.quantity_per_product) })) || [];
      await renderPage("inventory");
      break;
    }
    case "archive-product":
      if (confirm("Archive this product? Past receipts will be preserved.")) {
        await archiveProduct(id);
        await renderPage("inventory");
        flash("Product archived.");
      }
      break;
    case "edit-ingredient":
      state.editingIngredient = (await listIngredients()).find(item => item.id === id) || null;
      await renderPage("inventory");
      break;
    case "archive-ingredient":
      if (confirm("Archive this ingredient? Stock history and past sales will be preserved.")) {
        await archiveIngredient(id);
        await renderPage("inventory");
        flash("Ingredient archived.");
      }
      break;
    case "edit-part":
      state.editingPart = (await listSpareParts()).find(item => item.id === id) || null;
      await renderPage("inventory");
      break;
    case "archive-part":
      if (confirm("Archive this spare part? Past repair records will be preserved.")) {
        await archiveSparePart(id);
        await renderPage("inventory");
        flash("Spare part archived.");
      }
      break;
    case "edit-customer":
      state.editingCustomer = (await listCustomers(state.mode)).find(item => item.id === id) || null;
      await renderPage("customers");
      break;
    case "delete-customer":
      if (confirm("Delete this customer? Past sales and repair records will remain with the saved name.")) {
        await deleteCustomer(id);
        await renderPage("customers");
        flash("Customer deleted.");
      }
      break;
    case "cart-plus":
      state.cart.find(line => line.product.id === id).quantity += 1;
      await renderPage("sales");
      break;
    case "cart-minus": {
      const line = state.cart.find(item => item.product.id === id);
      if (line) line.quantity -= 1;
      state.cart = state.cart.filter(item => item.quantity > 0);
      await renderPage("sales");
      break;
    }
    case "cart-remove":
      state.cart = state.cart.filter(item => item.product.id !== id);
      await renderPage("sales");
      break;
    case "print-receipt": window.print(); break;
    default: break;
  }
}

document.addEventListener("submit", async event => {
  const form = event.target.closest("form[data-form]");
  if (!form) return;
  event.preventDefault();
  const submitButton = form.querySelector("button[type=submit]");
  if (submitButton) submitButton.disabled = true;
  try {
    await handleSubmit(form);
  } catch (error) {
    flash(error.message || String(error), "error");
    if (submitButton) submitButton.disabled = false;
  }
});

document.addEventListener("click", async event => {
  const modeToggle = event.target.closest("#mode-toggle");
  if (modeToggle) {
    state.mode = state.mode === "sales" ? "repairs" : "sales";
    state.page = "dashboard";
    await renderPage("dashboard");
    return;
  }
  const range = event.target.closest("[data-range]");
  if (range) {
    state.reportDays = Number(range.dataset.range);
    await renderPage("reports");
    return;
  }
  const receipt = event.target.closest("[data-receipt]");
  if (receipt) {
    state.receiptId = receipt.dataset.receipt;
    await renderPage("transactions");
    return;
  }
  const pageButton = event.target.closest("[data-page]");
  if (pageButton) {
    await renderPage(pageButton.dataset.page);
    return;
  }
  const action = event.target.closest("[data-action]");
  if (!action) return;
  try { await handleAction(action); }
  catch (error) { flash(error.message || String(error), "error"); }
});

window.addEventListener("online", () => {
  const status = document.querySelector("#connection");
  if (status) status.innerHTML = '<span class="status-dot"></span> Internet available';
});
window.addEventListener("offline", () => {
  const status = document.querySelector("#connection");
  if (status) status.innerHTML = '<span class="status-dot"></span> Offline mode';
});

const connection = document.querySelector("#connection");
if (connection) connection.innerHTML = `<span class="status-dot"></span> ${navigator.onLine ? "Internet available" : "Offline mode"}`;
updateModeChrome();
void renderPage("dashboard");
