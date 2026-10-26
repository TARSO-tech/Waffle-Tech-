
const app = document.querySelector("#app");
const originalDashboard = app.innerHTML;

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
    title: "Tech Repairs",
    description: "Manage smartphone, laptop, and computer repair jobs.",
    items: ["New repair job", "Repair status", "Technician assignment", "Repair payments"]
  },
  inventory: {
    title: "Inventory",
    description: "Manage food products, ingredients, and electronic repair parts.",
    items: ["Product list", "Stock adjustments", "Stock-in history", "Low-stock alerts"]
  },
  reports: {
    title: "Reports",
    description: "Review your business performance using locally stored records.",
    items: ["Daily sales", "Monthly sales", "Estimated profit", "Inventory valuation"]
  },
  customers: {
    title: "Customers",
    description: "Manage customer contact details and service history.",
    items: ["Add customer", "Customer directory", "Sales history", "Repair history"]
  },
  transactions: {
    title: "Transactions",
    description: "Review completed sales and payments.",
    items: ["Transaction history", "Date filters", "Receipt history", "Refund records"]
  }
};

function renderPage(pageName) {
  const page = pages[pageName] || pages.dashboard;

  if (pageName === "dashboard") {
    app.innerHTML = originalDashboard;
    setDate();
  } else {
    const items = page.items || [];

    app.innerHTML = `
      <section class="welcome">
        <p class="eyebrow">WAFFLE TECH POS</p>
        <h1>${page.title}</h1>
        <p class="muted">${page.description}</p>
      </section>

      <section class="panel">
        <div class="section-heading">
          <div>
            <p class="eyebrow">MODULE OVERVIEW</p>
            <h2>${page.title}</h2>
          </div>
        </div>
        <div class="module-list">
          ${items.map(item => `
            <div class="module-row">
              <span class="module-symbol">›</span>
              <span>${item}</span>
            </div>
          `).join("")}
        </div>
        <div class="notice">
          <strong>Database setup required</strong>
          <p>This module's data-entry and saving functions will be added in the next development steps. No records have been saved yet.</p>
        </div>
        <button class="action-button primary full-width"
                data-page="dashboard">
          Return to dashboard
        </button>
      </section>
    `;
  }

  document.querySelectorAll(".nav-item").forEach(button => {
    button.classList.toggle("active", button.dataset.page === pageName);
  });

  window.scrollTo({ top: 0, behavior: "auto" });
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
  const button = event.target.closest("[data-page]");
  if (!button) return;

  renderPage(button.dataset.page);
});

window.addEventListener("online", updateConnection);
window.addEventListener("offline", updateConnection);

setDate();
updateConnection();
  
