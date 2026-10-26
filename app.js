
const app = document.querySelector("#app");
const navigation = document.querySelector("#bottom-nav");
let activeMode = "sales";

const pages = {
  dashboard: {
    title: "Dashboard",
    description: "Your business at a glance."
  },
  sales: {
    title: "Waffle Sales",
    description: "Your point of sale for waffles, drinks, and other products.",
    items: ["Product catalog", "Shopping cart", "Discounts", "Checkout and receipts"]
  },
  repairs: {
    title: "Tech Services",
    description: "Manage smartphone, laptop, and computer repair jobs.",
    items: ["New repair job", "Repair status", "Technician assignment", "Repair payments"]
  },
  inventory: {
    title: "Inventory",
    description: "Review stock and low-stock items.",
    items: []
  },
  reports: {
    title: "Reports",
    description: "Review business activity and performance.",
    items: []
  },
  customers: {
    title: "Customers",
    description: "Manage customer contact details and visit history.",
    items: ["Add customer", "Customer directory", "Contact details", "Visit history"]
  },
  transactions: {
    title: "Transactions",
    description: "Review completed sales and payments.",
    items: ["Transaction history", "Date filters", "Receipt history", "Refund records"]
  }
};

function renderPage(pageName) {
  if (pageName === "sales" || pageName === "repairs") {
    activeMode = pageName;
    updateModeToggle();
  }

  if (pageName === "dashboard" || pageName === activeMode) {
    renderDashboard();
  } else {
    const page = pages[pageName] || pages[activeMode];
    const items = pageName === "inventory"
      ? activeMode === "sales"
        ? ["Waffle and drink products", "Ingredient stock", "Stock adjustments", "Low-stock alerts"]
        : ["Device parts", "Repair supplies", "Stock adjustments", "Low-stock alerts"]
      : pageName === "reports"
        ? activeMode === "sales"
          ? ["Daily sales", "Monthly sales", "Popular products", "Inventory valuation"]
          : ["Open repair jobs", "Completed jobs", "Service revenue", "Parts usage"]
        : page.items;

    app.innerHTML = `
      <section class="welcome">
        <p class="eyebrow">${activeMode === "sales" ? "WAFFLE SALES" : "TECH SERVICES"}</p>
        <h1>${page.title}</h1>
        <p class="muted">${page.description}</p>
      </section>
      <section class="panel">
        <div class="section-heading"><div><p class="eyebrow">OVERVIEW</p><h2>${page.title}</h2></div></div>
        <div class="module-list">
          ${items.map(item => `<div class="module-row"><span class="module-symbol">›</span><span>${item}</span></div>`).join("")}
        </div>
        <div class="notice">
          <strong>Database setup required</strong>
          <p>This module's data-entry and saving functions will be added in the next development steps. No records have been saved yet.</p>
        </div>
        <button class="action-button primary full-width" data-page="dashboard">Return to ${activeMode === "sales" ? "Waffle Sales" : "Tech Services"}</button>
      </section>
    `;
  }

  updateNavigation(pageName);
  document.body.classList.toggle("mode-tech", activeMode === "repairs");
  window.scrollTo({ top: 0, behavior: "auto" });
}

function renderDashboard() {
  if (activeMode === "sales") {
    app.innerHTML = `
      <section class="welcome"><p class="eyebrow">WAFFLE SALES</p><h1>Sales overview</h1><p class="muted" id="today"></p></section>
      <section class="stats-grid" aria-label="Sales summary">
        <article class="stat-card"><span class="stat-icon yellow">₱</span><p>Today's sales</p><h2>₱0.00</h2><small>Completed sales</small></article>
        <article class="stat-card"><span class="stat-icon brown">▤</span><p>Transactions</p><h2>0</h2><small>Today's orders</small></article>
        <article class="stat-card"><span class="stat-icon green">▦</span><p>Products</p><h2>0</h2><small>In your catalog</small></article>
      </section>
      <section class="panel"><div class="section-heading"><div><p class="eyebrow">SELL</p><h2>Quick actions</h2></div></div><div class="actions-grid">
        <button class="action-button primary" data-page="sales"><span>＋</span> New Sale</button>
        <button class="action-button" data-page="inventory"><span>▦</span> Products</button>
        <button class="action-button" data-page="customers"><span>♙</span> Customers</button>
      </div></section>
      <section class="panel"><div class="section-heading"><div><p class="eyebrow">ORDER HISTORY</p><h2>Recent transactions</h2></div><button class="text-button" data-page="transactions">View all</button></div>
        <div class="empty-state"><span class="empty-icon">▤</span><strong>No transactions yet</strong><p>Completed sales will appear here.</p></div>
      </section>
    `;
  } else {
    app.innerHTML = `
      <section class="welcome"><p class="eyebrow">TECH SERVICES</p><h1>Service overview</h1><p class="muted" id="today"></p></section>
      <section class="stats-grid" aria-label="Service summary">
        <article class="stat-card"><span class="stat-icon blue">⚙</span><p>Active jobs</p><h2>0</h2><small>Currently in service</small></article>
        <article class="stat-card"><span class="stat-icon green">✓</span><p>Completed today</p><h2>0</h2><small>Ready for pickup</small></article>
        <article class="stat-card"><span class="stat-icon blue-light">◷</span><p>Awaiting review</p><h2>0</h2><small>Needs assessment</small></article>
      </section>
      <section class="panel"><div class="section-heading"><div><p class="eyebrow">SERVICE DESK</p><h2>Quick actions</h2></div></div><div class="actions-grid">
        <button class="action-button primary" data-page="repairs"><span>＋</span> New Repair</button>
        <button class="action-button" data-page="repairs"><span>⚙</span> Job Queue</button>
        <button class="action-button" data-page="customers"><span>♙</span> Customers</button>
      </div></section>
      <section class="panel"><div class="section-heading"><div><p class="eyebrow">WORK QUEUE</p><h2>Recent repair jobs</h2></div><button class="text-button" data-page="repairs">View all</button></div>
        <div class="empty-state"><span class="empty-icon">⚙</span><strong>No repair jobs yet</strong><p>New service jobs will appear here.</p></div>
      </section>
    `;
  }
  setDate();
}

function updateNavigation(pageName) {
  const links = activeMode === "sales"
    ? [["dashboard", "⌂", "Home"], ["sales", "₱", "Sales"], ["inventory", "▦", "Products"], ["customers", "♙", "Customers"], ["reports", "▥", "Reports"]]
    : [["dashboard", "⌂", "Home"], ["repairs", "⚙", "Jobs"], ["customers", "♙", "Customers"], ["inventory", "▦", "Parts"], ["reports", "▥", "Reports"]];

  navigation.innerHTML = links.map(([page, icon, label]) => `
    <button class="nav-item${page === pageName ? " active" : ""}" data-page="${page}">
      <span>${icon}</span><small>${label}</small>
    </button>
  `).join("");
}

function updateModeToggle() {
  const toggle = document.querySelector("#mode-toggle");
  if (!toggle) return;

  const isTechServices = activeMode === "repairs";
  toggle.textContent = isTechServices ? "Tech Services" : "Waffle Sales";
  toggle.setAttribute("aria-label", `Switch to ${isTechServices ? "Waffle Sales" : "Tech Services"}`);
  toggle.setAttribute("aria-pressed", String(isTechServices));
}

function setDate() {
  const dateElement = document.querySelector("#today");

  if (dateElement) {
    dateElement.textContent = new Date().toLocaleDateString(
      undefined,
      {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric"
      }
    );
  }
}

function updateConnection() {
  const indicator = document.querySelector("#connection");
  if (!indicator) return;

  const online = navigator.onLine;

  indicator.innerHTML = `
    <span class="status-dot"
      style="background:${online ? "#16834a" : "#b45309"}"></span>
    ${online ? "Internet available" : "Offline mode"}
  `;
}

document.addEventListener("click", event => {
  const modeToggle = event.target.closest("#mode-toggle");
  if (modeToggle) {
    renderPage(activeMode === "sales" ? "repairs" : "sales");
    return;
  }

  const button = event.target.closest("[data-page]");
  if (!button) return;

  renderPage(button.dataset.page);
});

window.addEventListener("online", updateConnection);
window.addEventListener("offline", updateConnection);

updateConnection();
updateModeToggle();
renderPage("dashboard");
  
