import { Capacitor } from "@capacitor/core";
import { CapacitorSQLite, SQLiteConnection } from "@capacitor-community/sqlite";

const DATABASE_NAME = "waffle_tech";
const DATABASE_VERSION = 1;
let isNative = Capacitor.isNativePlatform();
let sqlite = new SQLiteConnection(CapacitorSQLite);
let databasePromise;
let transactionQueue = Promise.resolve();

const migrations = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        phone TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        address TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS customers_phone_unique
        ON customers(phone) WHERE phone <> '';
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT '',
        price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ingredients (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        unit TEXT NOT NULL DEFAULT 'unit',
        quantity REAL NOT NULL DEFAULT 0 CHECK (quantity >= 0),
        low_stock_threshold REAL NOT NULL DEFAULT 0 CHECK (low_stock_threshold >= 0),
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS product_ingredients (
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        ingredient_id TEXT NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
        quantity_per_product REAL NOT NULL CHECK (quantity_per_product > 0),
        PRIMARY KEY (product_id, ingredient_id)
      );
      CREATE TABLE IF NOT EXISTS spare_parts (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        sku TEXT NOT NULL DEFAULT '',
        unit TEXT NOT NULL DEFAULT 'unit',
        quantity REAL NOT NULL DEFAULT 0 CHECK (quantity >= 0),
        low_stock_threshold REAL NOT NULL DEFAULT 0 CHECK (low_stock_threshold >= 0),
        price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS spare_parts_sku_unique
        ON spare_parts(sku) WHERE sku <> '';
      CREATE TABLE IF NOT EXISTS sales (
        id TEXT PRIMARY KEY NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
        customer_name TEXT NOT NULL DEFAULT '',
        subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0),
        discount_cents INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
        total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
        paid_cents INTEGER NOT NULL DEFAULT 0 CHECK (paid_cents >= 0),
        change_cents INTEGER NOT NULL DEFAULT 0 CHECK (change_cents >= 0),
        payment_method TEXT NOT NULL DEFAULT 'cash',
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sale_items (
        id TEXT PRIMARY KEY NOT NULL,
        sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
        product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
        product_name TEXT NOT NULL,
        unit_price_cents INTEGER NOT NULL,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        line_total_cents INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS repair_jobs (
        id TEXT PRIMARY KEY NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        job_number TEXT NOT NULL UNIQUE,
        customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
        customer_name TEXT NOT NULL,
        device_type TEXT NOT NULL,
        brand TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        serial_number TEXT NOT NULL DEFAULT '',
        reported_issue TEXT NOT NULL,
        diagnosis TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'received'
          CHECK (status IN ('received', 'diagnosing', 'waiting_parts', 'in_progress', 'ready', 'completed', 'cancelled')),
        service_charge_cents INTEGER NOT NULL DEFAULT 0 CHECK (service_charge_cents >= 0),
        parts_total_cents INTEGER NOT NULL DEFAULT 0 CHECK (parts_total_cents >= 0),
        paid_cents INTEGER NOT NULL DEFAULT 0 CHECK (paid_cents >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS repair_parts (
        id TEXT PRIMARY KEY NOT NULL,
        repair_job_id TEXT NOT NULL REFERENCES repair_jobs(id) ON DELETE CASCADE,
        spare_part_id TEXT REFERENCES spare_parts(id) ON DELETE SET NULL,
        part_name TEXT NOT NULL,
        unit_price_cents INTEGER NOT NULL,
        quantity REAL NOT NULL CHECK (quantity > 0),
        line_total_cents INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        sale_id TEXT REFERENCES sales(id) ON DELETE CASCADE,
        repair_job_id TEXT REFERENCES repair_jobs(id) ON DELETE CASCADE,
        amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
        method TEXT NOT NULL,
        reference TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        CHECK ((sale_id IS NOT NULL) != (repair_job_id IS NOT NULL))
      );
      CREATE TABLE IF NOT EXISTS stock_movements (
        id TEXT PRIMARY KEY NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        mode TEXT NOT NULL CHECK (mode IN ('sales', 'repairs')),
        inventory_type TEXT NOT NULL CHECK (inventory_type IN ('ingredients', 'spare_parts')),
        item_id TEXT NOT NULL,
        quantity_delta REAL NOT NULL CHECK (quantity_delta <> 0),
        reason TEXT NOT NULL,
        reference_id TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sales_created_at_idx ON sales(created_at);
      CREATE INDEX IF NOT EXISTS repairs_created_at_idx ON repair_jobs(created_at);
      CREATE INDEX IF NOT EXISTS repairs_status_idx ON repair_jobs(status);
      CREATE INDEX IF NOT EXISTS movements_item_idx ON stock_movements(inventory_type, item_id, created_at);
    `
  }
];

function makeId() {
  return globalThis.crypto?.randomUUID?.()
    || `wt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function now() {
  return new Date().toISOString();
}

function changedRows(result) {
  return result?.changes?.changes ?? 0;
}

async function openDatabase() {
  if (!isNative) {
    const { defineCustomElements } = await import("jeep-sqlite/loader");
    defineCustomElements(window);
    await customElements.whenDefined("jeep-sqlite");
    let element = document.querySelector("jeep-sqlite");
    if (!element) {
      element = document.createElement("jeep-sqlite");
      element.setAttribute("wasmPath", new URL("assets/", document.baseURI).pathname);
      document.body.append(element);
    }
    await element.componentOnReady?.();
    await sqlite.initWebStore();
  }

  const db = await sqlite.createConnection(DATABASE_NAME, false, "no-encryption", DATABASE_VERSION, false);
  await db.open();
  await db.execute("PRAGMA foreign_keys = ON;", false);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const versions = await db.query("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1");
  let version = Number(versions.values?.[0]?.version || 0);

  for (const migration of migrations) {
    if (migration.version <= version) continue;
    await db.execute(migration.sql, true);
    await db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", [migration.version, now()]);
    version = migration.version;
  }

  if (!isNative) await sqlite.saveToStore(DATABASE_NAME);
  return db;
}

async function getDatabase() {
  if (!databasePromise) {
    databasePromise = openDatabase().catch(error => {
      databasePromise = null;
      throw new Error(`Could not open the Waffle Tech database: ${error.message || error}`);
    });
  }
  return databasePromise;
}

async function query(sql, values = []) {
  const db = await getDatabase();
  const result = await db.query(sql, values);
  return result.values || [];
}

function withTransaction(operation) {
  const task = transactionQueue.then(() => runTransaction(operation));
  transactionQueue = task.catch(() => undefined);
  return task;
}

async function runTransaction(operation) {
  const db = await getDatabase();
  await db.beginTransaction();
  try {
    const result = await operation(db);
    await db.commitTransaction();
    if (!isNative) await sqlite.saveToStore(DATABASE_NAME);
    return result;
  } catch (error) {
    try {
      const state = await db.isTransactionActive();
      if (state.result) await db.rollbackTransaction();
    } catch (rollbackError) {
      console.error("SQLite rollback failed", rollbackError);
    }
    throw error;
  }
}

async function run(db, sql, values = []) {
  return db.run(sql, values, false);
}

function requireText(value, label) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function requirePositive(value, label, allowZero = false) {
  const number = Number(value);
  if (!Number.isFinite(number) || (allowZero ? number < 0 : number <= 0)) {
    throw new Error(`${label} must be ${allowZero ? "zero or greater" : "greater than zero"}.`);
  }
  return number;
}

export async function initializeDatabase() {
  await getDatabase();
}

export function setSQLitePluginForTests(plugin) {
  sqlite = new SQLiteConnection(plugin);
  isNative = true;
  databasePromise = null;
  transactionQueue = Promise.resolve();
}

export async function getDashboardSummary(mode) {
  if (mode === "sales") {
    const [sales, transactions, products, lowStock] = await Promise.all([
      query("SELECT COALESCE(SUM(total_cents), 0) AS total FROM sales WHERE date(created_at, 'localtime') = date('now', 'localtime')"),
      query("SELECT COUNT(*) AS count FROM sales WHERE date(created_at, 'localtime') = date('now', 'localtime')"),
      query("SELECT COUNT(*) AS count FROM products WHERE active = 1"),
      query("SELECT COUNT(*) AS count FROM ingredients WHERE active = 1 AND quantity <= low_stock_threshold")
    ]);
    return {
      total_cents: Number(sales[0]?.total || 0),
      transaction_count: Number(transactions[0]?.count || 0),
      product_count: Number(products[0]?.count || 0),
      low_stock_count: Number(lowStock[0]?.count || 0)
    };
  }

  const [active, completed, awaiting, lowStock] = await Promise.all([
    query("SELECT COUNT(*) AS count FROM repair_jobs WHERE status NOT IN ('completed', 'cancelled')"),
    query("SELECT COUNT(*) AS count FROM repair_jobs WHERE status = 'completed' AND date(updated_at, 'localtime') = date('now', 'localtime')"),
    query("SELECT COUNT(*) AS count FROM repair_jobs WHERE status IN ('received', 'diagnosing')"),
    query("SELECT COUNT(*) AS count FROM spare_parts WHERE active = 1 AND quantity <= low_stock_threshold")
  ]);
  return {
    active_jobs: Number(active[0]?.count || 0),
    completed_today: Number(completed[0]?.count || 0),
    awaiting_review: Number(awaiting[0]?.count || 0),
    low_stock_count: Number(lowStock[0]?.count || 0)
  };
}

export async function listProducts() {
  const products = await query("SELECT * FROM products WHERE active = 1 ORDER BY name COLLATE NOCASE");
  for (const product of products) {
    product.recipe = await query(
      `SELECT pi.ingredient_id, pi.quantity_per_product, i.name, i.unit
       FROM product_ingredients pi JOIN ingredients i ON i.id = pi.ingredient_id
       WHERE pi.product_id = ? ORDER BY i.name COLLATE NOCASE`,
      [product.id]
    );
  }
  return products;
}

export async function saveProduct(input) {
  const id = input.id || makeId();
  const name = requireText(input.name, "Product name");
  const price = Math.round(requirePositive(input.priceCents, "Product price", true));
  const recipe = Array.isArray(input.recipe) ? input.recipe : [];
  const timestamp = now();

  await withTransaction(async db => {
    if (input.id) {
      const result = await run(db, "UPDATE products SET name = ?, category = ?, price_cents = ?, updated_at = ? WHERE id = ? AND active = 1", [name, input.category || "", price, timestamp, id]);
      if (!changedRows(result)) throw new Error("Product no longer exists.");
    } else {
      await run(db, "INSERT INTO products (id, name, category, price_cents, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", [id, name, input.category || "", price, timestamp, timestamp]);
    }
    await run(db, "DELETE FROM product_ingredients WHERE product_id = ?", [id]);
    for (const entry of recipe) {
      await run(db, "INSERT INTO product_ingredients (product_id, ingredient_id, quantity_per_product) VALUES (?, ?, ?)", [id, entry.ingredientId, requirePositive(entry.quantity, "Recipe quantity")]);
    }
  });
  return id;
}

export async function archiveProduct(id) {
  await withTransaction(db => run(db, "UPDATE products SET active = 0, updated_at = ? WHERE id = ?", [now(), id]));
}

export async function listIngredients() {
  return query("SELECT * FROM ingredients WHERE active = 1 ORDER BY name COLLATE NOCASE");
}

export async function saveIngredient(input) {
  const id = input.id || makeId();
  const name = requireText(input.name, "Ingredient name");
  const unit = requireText(input.unit || "unit", "Unit");
  const threshold = requirePositive(input.lowStockThreshold || 0, "Low-stock threshold", true);
  const timestamp = now();

  await withTransaction(async db => {
    if (input.id) {
      const result = await run(db, "UPDATE ingredients SET name = ?, unit = ?, low_stock_threshold = ?, updated_at = ? WHERE id = ? AND active = 1", [name, unit, threshold, timestamp, id]);
      if (!changedRows(result)) throw new Error("Ingredient no longer exists.");
    } else {
      const quantity = requirePositive(input.quantity || 0, "Initial quantity", true);
      await run(db, "INSERT INTO ingredients (id, name, unit, quantity, low_stock_threshold, updated_at) VALUES (?, ?, ?, ?, ?, ?)", [id, name, unit, quantity, threshold, timestamp]);
      if (quantity > 0) {
        await run(db, "INSERT INTO stock_movements (id, idempotency_key, mode, inventory_type, item_id, quantity_delta, reason, created_at) VALUES (?, ?, 'sales', 'ingredients', ?, ?, 'Initial stock', ?)", [makeId(), `initial-ingredient:${id}`, id, quantity, timestamp]);
      }
    }
  });
  return id;
}

export async function archiveIngredient(id) {
  const usage = await query("SELECT COUNT(*) AS count FROM product_ingredients pi JOIN products p ON p.id = pi.product_id WHERE pi.ingredient_id = ? AND p.active = 1", [id]);
  if (Number(usage[0]?.count || 0)) throw new Error("Remove this ingredient from active product recipes before archiving it.");
  await withTransaction(db => run(db, "UPDATE ingredients SET active = 0, updated_at = ? WHERE id = ?", [now(), id]));
}

export async function listSpareParts() {
  return query("SELECT * FROM spare_parts WHERE active = 1 ORDER BY name COLLATE NOCASE");
}

export async function saveSparePart(input) {
  const id = input.id || makeId();
  const name = requireText(input.name, "Part name");
  const unit = requireText(input.unit || "unit", "Unit");
  const sku = String(input.sku || "").trim();
  const threshold = requirePositive(input.lowStockThreshold || 0, "Low-stock threshold", true);
  const price = Math.round(requirePositive(input.priceCents || 0, "Part price", true));
  const timestamp = now();

  await withTransaction(async db => {
    if (input.id) {
      const result = await run(db, "UPDATE spare_parts SET name = ?, sku = ?, unit = ?, low_stock_threshold = ?, price_cents = ?, updated_at = ? WHERE id = ? AND active = 1", [name, sku, unit, threshold, price, timestamp, id]);
      if (!changedRows(result)) throw new Error("Spare part no longer exists.");
    } else {
      const quantity = requirePositive(input.quantity || 0, "Initial quantity", true);
      await run(db, "INSERT INTO spare_parts (id, name, sku, unit, quantity, low_stock_threshold, price_cents, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [id, name, sku, unit, quantity, threshold, price, timestamp]);
      if (quantity > 0) {
        await run(db, "INSERT INTO stock_movements (id, idempotency_key, mode, inventory_type, item_id, quantity_delta, reason, created_at) VALUES (?, ?, 'repairs', 'spare_parts', ?, ?, 'Initial stock', ?)", [makeId(), `initial-part:${id}`, id, quantity, timestamp]);
      }
    }
  });
  return id;
}

export async function archiveSparePart(id) {
  await withTransaction(db => run(db, "UPDATE spare_parts SET active = 0, updated_at = ? WHERE id = ?", [now(), id]));
}

export async function adjustStock({ mode, itemId, delta, reason, idempotencyKey }) {
  if (mode !== "sales" && mode !== "repairs") throw new Error("Select a valid business mode.");
  const inventoryType = mode === "sales" ? "ingredients" : "spare_parts";
  const table = mode === "sales" ? "ingredients" : "spare_parts";
  const movementKey = requireText(idempotencyKey, "Stock adjustment request key");
  const change = Number(delta);
  if (!Number.isFinite(change) || change === 0) throw new Error("Enter a non-zero stock adjustment.");
  const adjustmentReason = requireText(reason, "Adjustment reason");

  return withTransaction(async db => {
    const previous = await query("SELECT id FROM stock_movements WHERE idempotency_key = ?", [movementKey]);
    if (previous.length) {
      const current = await query(`SELECT quantity FROM ${table} WHERE id = ?`, [itemId]);
      return Number(current[0]?.quantity || 0);
    }
    const rows = await query(`SELECT quantity FROM ${table} WHERE id = ? AND active = 1`, [itemId]);
    if (!rows.length) throw new Error("Inventory item not found.");
    const balance = Number(rows[0].quantity) + change;
    if (balance < 0) throw new Error("Stock cannot be adjusted below zero.");
    await run(db, `UPDATE ${table} SET quantity = ?, updated_at = ? WHERE id = ?`, [balance, now(), itemId]);
    await run(db, "INSERT INTO stock_movements (id, idempotency_key, mode, inventory_type, item_id, quantity_delta, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [makeId(), movementKey, mode, inventoryType, itemId, change, adjustmentReason, now()]);
    return balance;
  });
}

export async function listCustomers(mode) {
  const activityJoin = mode === "sales"
    ? "LEFT JOIN sales s ON s.customer_id = c.id"
    : "LEFT JOIN repair_jobs r ON r.customer_id = c.id";
  const countExpression = mode === "sales" ? "COUNT(DISTINCT s.id)" : "COUNT(DISTINCT r.id)";
  return query(`
    SELECT c.*, ${countExpression} AS activity_count
    FROM customers c ${activityJoin}
    GROUP BY c.id ORDER BY c.name COLLATE NOCASE
  `);
}

export async function saveCustomer(input) {
  const id = input.id || makeId();
  const name = requireText(input.name, "Customer name");
  const phone = String(input.phone || "").trim();
  const email = String(input.email || "").trim();
  if (!phone && !email) throw new Error("Enter a phone number or email address.");
  const timestamp = now();

  await withTransaction(async db => {
    if (input.id) {
      const result = await run(db, "UPDATE customers SET name = ?, phone = ?, email = ?, address = ?, notes = ?, updated_at = ? WHERE id = ?", [name, phone, email, input.address || "", input.notes || "", timestamp, id]);
      if (!changedRows(result)) throw new Error("Customer no longer exists.");
    } else {
      await run(db, "INSERT INTO customers (id, name, phone, email, address, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [id, name, phone, email, input.address || "", input.notes || "", timestamp, timestamp]);
    }
  });
  return id;
}

export async function deleteCustomer(id) {
  await withTransaction(db => run(db, "DELETE FROM customers WHERE id = ?", [id]));
}

export async function listSales(limit = 100) {
  return query("SELECT * FROM sales ORDER BY created_at DESC LIMIT ?", [limit]);
}

export async function getSale(id) {
  const sales = await query("SELECT * FROM sales WHERE id = ?", [id]);
  if (!sales.length) return null;
  sales[0].items = await query("SELECT * FROM sale_items WHERE sale_id = ? ORDER BY product_name", [id]);
  sales[0].payments = await query("SELECT * FROM payments WHERE sale_id = ? ORDER BY created_at", [id]);
  return sales[0];
}

export async function createSale(input) {
  const idempotencyKey = requireText(input.idempotencyKey, "Sale request key");
  const cart = Array.isArray(input.items) ? input.items : [];
  if (!cart.length) throw new Error("Add at least one product to the sale.");
  const timestamp = now();
  const saleId = makeId();

  return withTransaction(async db => {
    const existing = await query("SELECT id FROM sales WHERE idempotency_key = ?", [idempotencyKey]);
    if (existing.length) return existing[0].id;

    const lineItems = [];
    const ingredientUse = new Map();
    let subtotal = 0;
    for (const line of cart) {
      const requestedQuantity = requirePositive(line.quantity, "Product quantity");
      const quantity = Math.floor(requestedQuantity);
      if (quantity !== requestedQuantity) throw new Error("Product quantities must be whole numbers.");
      const products = await query("SELECT id, name, price_cents FROM products WHERE id = ? AND active = 1", [line.productId]);
      if (!products.length) throw new Error("A selected product is no longer available.");
      const product = products[0];
      const lineTotal = Number(product.price_cents) * quantity;
      subtotal += lineTotal;
      lineItems.push({ ...product, quantity, lineTotal });
      const recipe = await query("SELECT ingredient_id, quantity_per_product FROM product_ingredients WHERE product_id = ?", [product.id]);
      if (!recipe.length) throw new Error(`${product.name} needs a recipe before it can be sold.`);
      for (const entry of recipe) {
        ingredientUse.set(entry.ingredient_id, (ingredientUse.get(entry.ingredient_id) || 0) + Number(entry.quantity_per_product) * quantity);
      }
    }

    const discount = Math.round(requirePositive(input.discountCents || 0, "Discount", true));
    if (discount > subtotal) throw new Error("Discount cannot exceed the sale subtotal.");
    const total = subtotal - discount;
    const tendered = Math.round(requirePositive(input.paidCents || 0, "Amount paid", true));
    const paid = Math.min(tendered, total);
    const customer = input.customerId ? await query("SELECT id, name FROM customers WHERE id = ?", [input.customerId]) : [];

    await run(db, `INSERT INTO sales
      (id, idempotency_key, customer_id, customer_name, subtotal_cents, discount_cents, total_cents, paid_cents, change_cents, payment_method, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [saleId, idempotencyKey, customer[0]?.id || null, customer[0]?.name || "", subtotal, discount, total, paid, Math.max(0, tendered - total), input.paymentMethod || "cash", timestamp]);

    for (const line of lineItems) {
      await run(db, "INSERT INTO sale_items (id, sale_id, product_id, product_name, unit_price_cents, quantity, line_total_cents) VALUES (?, ?, ?, ?, ?, ?, ?)", [makeId(), saleId, line.id, line.name, line.price_cents, line.quantity, line.lineTotal]);
    }
    if (paid > 0) {
      await run(db, "INSERT INTO payments (id, idempotency_key, sale_id, amount_cents, method, created_at) VALUES (?, ?, ?, ?, ?, ?)", [makeId(), `${idempotencyKey}:initial-payment`, saleId, paid, input.paymentMethod || "cash", timestamp]);
    }

    for (const [ingredientId, used] of ingredientUse) {
      const ingredients = await query("SELECT name, quantity FROM ingredients WHERE id = ? AND active = 1", [ingredientId]);
      if (!ingredients.length || Number(ingredients[0].quantity) < used) {
        throw new Error(`Not enough ${ingredients[0]?.name || "ingredient"} in stock to complete this sale.`);
      }
      await run(db, "UPDATE ingredients SET quantity = quantity - ?, updated_at = ? WHERE id = ? AND quantity >= ?", [used, timestamp, ingredientId, used]);
      await run(db, "INSERT INTO stock_movements (id, idempotency_key, mode, inventory_type, item_id, quantity_delta, reason, reference_id, created_at) VALUES (?, ?, 'sales', 'ingredients', ?, ?, 'Sale deduction', ?, ?)", [makeId(), `${idempotencyKey}:ingredient:${ingredientId}`, ingredientId, -used, saleId, timestamp]);
    }
    return saleId;
  });
}

export async function createRepairJob(input) {
  const idempotencyKey = requireText(input.idempotencyKey, "Repair request key");
  const id = makeId();
  const timestamp = now();
  const serviceCharge = Math.round(requirePositive(input.serviceChargeCents || 0, "Service charge", true));
  const paid = Math.round(requirePositive(input.paidCents || 0, "Amount paid", true));
  if (paid > serviceCharge) throw new Error("Initial payment cannot exceed the service charge.");

  return withTransaction(async db => {
    const existing = await query("SELECT id FROM repair_jobs WHERE idempotency_key = ?", [idempotencyKey]);
    if (existing.length) return existing[0].id;
    const customers = await query("SELECT id, name FROM customers WHERE id = ?", [input.customerId]);
    if (!customers.length) throw new Error("Select a registered customer.");
    const jobNumber = `WT-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    await run(db, `INSERT INTO repair_jobs
      (id, idempotency_key, job_number, customer_id, customer_name, device_type, brand, model, serial_number, reported_issue, diagnosis, status, service_charge_cents, parts_total_cents, paid_cents, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'received', ?, 0, ?, ?, ?)`,
    [id, idempotencyKey, jobNumber, customers[0].id, customers[0].name, requireText(input.deviceType, "Device type"), input.brand || "", input.model || "", input.serialNumber || "", requireText(input.reportedIssue, "Reported issue"), serviceCharge, paid, timestamp, timestamp]);
    if (paid > 0) {
      await run(db, "INSERT INTO payments (id, idempotency_key, repair_job_id, amount_cents, method, created_at) VALUES (?, ?, ?, ?, ?, ?)", [makeId(), `${idempotencyKey}:initial-payment`, id, paid, input.paymentMethod || "cash", timestamp]);
    }
    return id;
  });
}

export async function listRepairJobs(limit = 100) {
  const jobs = await query("SELECT * FROM repair_jobs ORDER BY created_at DESC LIMIT ?", [limit]);
  for (const job of jobs) {
    job.parts = await query("SELECT * FROM repair_parts WHERE repair_job_id = ? ORDER BY part_name", [job.id]);
    job.payments = await query("SELECT amount_cents, method, reference, created_at FROM payments WHERE repair_job_id = ? ORDER BY created_at", [job.id]);
  }
  return jobs;
}

export async function updateRepairJob(id, values) {
  const status = values.status;
  const allowed = ["received", "diagnosing", "waiting_parts", "in_progress", "ready", "completed", "cancelled"];
  if (!allowed.includes(status)) throw new Error("Select a valid repair status.");
  const deviceType = requireText(values.deviceType, "Device type");
  const reportedIssue = requireText(values.reportedIssue, "Reported issue");
  const serviceCharge = Math.round(requirePositive(values.serviceChargeCents, "Service charge", true));
  const diagnosis = String(values.diagnosis || "").trim();
  await withTransaction(async db => {
    const jobs = await query("SELECT paid_cents, parts_total_cents FROM repair_jobs WHERE id = ?", [id]);
    if (!jobs.length) throw new Error("Repair job no longer exists.");
    if (Number(jobs[0].paid_cents) > serviceCharge + Number(jobs[0].parts_total_cents)) {
      throw new Error("Service charge cannot be reduced below the amount already paid.");
    }
    await run(db, `UPDATE repair_jobs SET status = ?, diagnosis = ?, device_type = ?, brand = ?, model = ?,
      serial_number = ?, reported_issue = ?, service_charge_cents = ?, updated_at = ? WHERE id = ?`,
    [status, diagnosis, deviceType, values.brand || "", values.model || "", values.serialNumber || "", reportedIssue, serviceCharge, now(), id]);
  });
}

export async function addRepairPart(input) {
  const quantity = requirePositive(input.quantity, "Part quantity");
  const key = requireText(input.idempotencyKey, "Part request key");
  return withTransaction(async db => {
    const previous = await query("SELECT reference_id FROM stock_movements WHERE idempotency_key = ?", [key]);
    if (previous.length) return previous[0].reference_id;
    const jobs = await query("SELECT id, status FROM repair_jobs WHERE id = ?", [input.repairJobId]);
    if (!jobs.length) throw new Error("Repair job not found.");
    if (["completed", "cancelled"].includes(jobs[0].status)) throw new Error("Parts cannot be added to a completed or cancelled job.");
    const parts = await query("SELECT * FROM spare_parts WHERE id = ? AND active = 1", [input.partId]);
    if (!parts.length) throw new Error("Selected spare part is no longer available.");
    const part = parts[0];
    if (Number(part.quantity) < quantity) throw new Error(`Not enough ${part.name} in stock.`);
    const timestamp = now();
    const lineTotal = Math.round(Number(part.price_cents) * quantity);
    await run(db, "UPDATE spare_parts SET quantity = quantity - ?, updated_at = ? WHERE id = ? AND quantity >= ?", [quantity, timestamp, part.id, quantity]);
    await run(db, "INSERT INTO repair_parts (id, repair_job_id, spare_part_id, part_name, unit_price_cents, quantity, line_total_cents) VALUES (?, ?, ?, ?, ?, ?, ?)", [makeId(), input.repairJobId, part.id, part.name, part.price_cents, quantity, lineTotal]);
    await run(db, "UPDATE repair_jobs SET parts_total_cents = parts_total_cents + ?, updated_at = ? WHERE id = ?", [lineTotal, timestamp, input.repairJobId]);
    await run(db, "INSERT INTO stock_movements (id, idempotency_key, mode, inventory_type, item_id, quantity_delta, reason, reference_id, created_at) VALUES (?, ?, 'repairs', 'spare_parts', ?, ?, 'Repair part usage', ?, ?)", [makeId(), key, part.id, -quantity, input.repairJobId, timestamp]);
    return input.repairJobId;
  });
}

export async function recordPayment(input) {
  const amount = Math.round(requirePositive(input.amountCents, "Payment amount"));
  const key = requireText(input.idempotencyKey, "Payment request key");
  const saleId = input.saleId || null;
  const repairJobId = input.repairJobId || null;
  if (Boolean(saleId) === Boolean(repairJobId)) throw new Error("Payment must belong to one sale or one repair job.");

  await withTransaction(async db => {
    const existing = await query("SELECT id FROM payments WHERE idempotency_key = ?", [key]);
    if (existing.length) return;
    const id = saleId || repairJobId;
    const records = saleId
      ? await query("SELECT id, total_cents, paid_cents FROM sales WHERE id = ?", [id])
      : await query("SELECT id, service_charge_cents, parts_total_cents, paid_cents FROM repair_jobs WHERE id = ?", [id]);
    if (!records.length) throw new Error("Payment record not found.");
    const record = records[0];
    const total = saleId ? Number(record.total_cents) : Number(record.service_charge_cents) + Number(record.parts_total_cents);
    const balance = total - Number(record.paid_cents);
    if (amount > balance) throw new Error(`Payment exceeds the outstanding balance of ${formatCurrency(balance)}.`);
    const timestamp = now();
    await run(db, "INSERT INTO payments (id, idempotency_key, sale_id, repair_job_id, amount_cents, method, reference, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [makeId(), key, saleId, repairJobId, amount, input.method || "cash", input.reference || "", timestamp]);
    if (saleId) {
      await run(db, "UPDATE sales SET paid_cents = paid_cents + ? WHERE id = ?", [amount, id]);
    } else {
      await run(db, "UPDATE repair_jobs SET paid_cents = paid_cents + ?, updated_at = ? WHERE id = ?", [amount, timestamp, id]);
    }
  });
}

export async function listStockMovements(mode, itemId = null, limit = 100) {
  const inventoryType = mode === "sales" ? "ingredients" : "spare_parts";
  const source = `FROM stock_movements m
    LEFT JOIN ingredients i ON m.inventory_type = 'ingredients' AND i.id = m.item_id
    LEFT JOIN spare_parts p ON m.inventory_type = 'spare_parts' AND p.id = m.item_id`;
  const select = `SELECT m.*, COALESCE(i.name, p.name, 'Archived item') AS item_name ${source}`;
  if (itemId) {
    return query(`${select} WHERE m.mode = ? AND m.inventory_type = ? AND m.item_id = ? ORDER BY m.created_at DESC LIMIT ?`, [mode, inventoryType, itemId, limit]);
  }
  return query(`${select} WHERE m.mode = ? AND m.inventory_type = ? ORDER BY m.created_at DESC LIMIT ?`, [mode, inventoryType, limit]);
}

export async function getReport(mode, startDate) {
  if (mode === "sales") {
    const [summary, days, popular] = await Promise.all([
      query("SELECT COUNT(*) AS count, COALESCE(SUM(total_cents), 0) AS total, COALESCE(SUM(paid_cents), 0) AS paid FROM sales WHERE created_at >= ?", [startDate]),
      query("SELECT date(created_at, 'localtime') AS day, COUNT(*) AS count, SUM(total_cents) AS total_cents FROM sales WHERE created_at >= ? GROUP BY day ORDER BY day DESC", [startDate]),
      query(`SELECT product_name, SUM(quantity) AS quantity, SUM(line_total_cents) AS total_cents
             FROM sale_items si JOIN sales s ON s.id = si.sale_id
             WHERE s.created_at >= ? GROUP BY product_name ORDER BY quantity DESC LIMIT 10`, [startDate])
    ]);
    return { summary: summary[0], days, popular };
  }

  const [summary, statuses, days, popularParts] = await Promise.all([
    query("SELECT COUNT(*) AS count, COALESCE(SUM(service_charge_cents + parts_total_cents), 0) AS total, COALESCE(SUM(paid_cents), 0) AS paid FROM repair_jobs WHERE created_at >= ?", [startDate]),
    query("SELECT status, COUNT(*) AS count FROM repair_jobs WHERE created_at >= ? GROUP BY status ORDER BY count DESC", [startDate]),
    query("SELECT date(created_at, 'localtime') AS day, COUNT(*) AS count, SUM(service_charge_cents + parts_total_cents) AS total_cents FROM repair_jobs WHERE created_at >= ? GROUP BY day ORDER BY day DESC", [startDate]),
    query(`SELECT part_name, SUM(quantity) AS quantity, SUM(line_total_cents) AS total_cents
           FROM repair_parts rp JOIN repair_jobs r ON r.id = rp.repair_job_id
           WHERE r.created_at >= ? GROUP BY part_name ORDER BY quantity DESC LIMIT 10`, [startDate])
  ]);
  return { summary: summary[0], statuses, days, popularParts };
}

export function formatCurrency(cents) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "PHP" }).format(Number(cents || 0) / 100);
}

export function toCents(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) throw new Error("Enter a valid amount.");
  return Math.round(value * 100);
}