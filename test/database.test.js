import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import initSqlJs from "sql.js";
import {
  addRepairPart,
  adjustStock,
  createRepairJob,
  createSale,
  getReport,
  getSale,
  initializeDatabase,
  listCustomers,
  listIngredients,
  listRepairJobs,
  listSales,
  listSpareParts,
  recordPayment,
  saveCustomer,
  saveIngredient,
  saveProduct,
  saveSparePart,
  setSQLitePluginForTests,
  updateRepairJob
} from "../database.js";

const SQL = await initSqlJs({
  locateFile: filename => new URL(`../node_modules/sql.js/dist/${filename}`, import.meta.url).pathname
});

class SqliteTestPlugin {
  database = new SQL.Database();
  transactionActive = false;

  async initWebStore() {}
  async saveToStore() {}
  async createConnection() {}
  async open() {}

  async execute({ statements, transaction = true }) {
    if (transaction) this.database.run("BEGIN");
    try {
      this.database.exec(statements);
      if (transaction) this.database.run("COMMIT");
      return { changes: { changes: this.database.getRowsModified() } };
    } catch (error) {
      if (transaction) this.database.run("ROLLBACK");
      throw error;
    }
  }

  async run({ statement, values = [] }) {
    this.database.run(statement, values);
    return { changes: { changes: this.database.getRowsModified() } };
  }

  async query({ statement, values = [] }) {
    const prepared = this.database.prepare(statement, values);
    const rows = [];
    try {
      while (prepared.step()) rows.push(prepared.getAsObject());
    } finally {
      prepared.free();
    }
    return { values: rows };
  }

  async beginTransaction() {
    this.database.run("BEGIN");
    this.transactionActive = true;
    return { changes: { changes: 0 } };
  }

  async commitTransaction() {
    this.database.run("COMMIT");
    this.transactionActive = false;
    return { changes: { changes: 0 } };
  }

  async rollbackTransaction() {
    this.database.run("ROLLBACK");
    this.transactionActive = false;
    return { changes: { changes: 0 } };
  }

  async isTransactionActive() {
    return { result: this.transactionActive };
  }
}

let plugin;

beforeEach(async () => {
  plugin = new SqliteTestPlugin();
  setSQLitePluginForTests(plugin);
  await initializeDatabase();
});

test("migrations create the isolated sales, repair, inventory, and shared customer tables", async () => {
  const tables = await plugin.query({ statement: "SELECT name FROM sqlite_master WHERE type = 'table'" });
  const names = new Set(tables.values.map(row => row.name));
  for (const name of ["schema_migrations", "customers", "products", "ingredients", "sales", "sale_items", "repair_jobs", "repair_parts", "spare_parts", "payments", "stock_movements"]) {
    assert.ok(names.has(name), `missing table ${name}`);
  }
});

test("checkout deducts recipe stock atomically and duplicate sale requests do not process twice", async () => {
  const ingredientId = await saveIngredient({ name: "Batter", unit: "g", quantity: 1000, lowStockThreshold: 100 });
  const productId = await saveProduct({ name: "Classic Waffle", priceCents: 5000, recipe: [{ ingredientId, quantity: 100 }] });
  await saveProduct({ id: productId, name: "Classic Waffle", category: "Waffles", priceCents: 5500, recipe: [{ ingredientId, quantity: 100 }] });
  const input = {
    idempotencyKey: "checkout-once",
    items: [{ productId, quantity: 2 }],
    paidCents: 11000,
    paymentMethod: "cash"
  };

  const [firstSale, repeatedSale] = await Promise.all([createSale(input), createSale(input)]);
  const [sale] = await listSales();
  const [ingredient] = await listIngredients();
  const receipt = await getSale(firstSale);

  assert.equal(firstSale, repeatedSale);
  assert.equal(sale.total_cents, 11000);
  assert.equal(ingredient.quantity, 800);
  assert.equal(receipt.items.length, 1);
  assert.equal(receipt.payments.length, 1);
});

test("insufficient ingredients roll back sale rows and stock movements", async () => {
  const ingredientId = await saveIngredient({ name: "Limited flour", unit: "g", quantity: 5 });
  const productId = await saveProduct({ name: "Small waffle", priceCents: 3000, recipe: [{ ingredientId, quantity: 10 }] });

  await assert.rejects(createSale({
    idempotencyKey: "insufficient-stock",
    items: [{ productId, quantity: 1 }],
    paidCents: 3000
  }), /Not enough/);

  assert.equal((await listSales()).length, 0);
  assert.equal((await listIngredients())[0].quantity, 5);
  const movements = await plugin.query({ statement: "SELECT COUNT(*) AS count FROM stock_movements WHERE reason = 'Sale deduction'" });
  assert.equal(movements.values[0].count, 0);
});

test("repair part usage is idempotent and payments update the outstanding balance once", async () => {
  const customerId = await saveCustomer({ name: "Ari Customer", phone: "09170000000" });
  const partId = await saveSparePart({ name: "USB-C port", sku: "PORT-C", unit: "piece", quantity: 4, priceCents: 25000 });
  const repairId = await createRepairJob({
    idempotencyKey: "repair-intake-once",
    customerId,
    deviceType: "Phone",
    brand: "Example",
    model: "X1",
    reportedIssue: "Does not charge",
    serviceChargeCents: 50000
  });
  const partRequest = { idempotencyKey: "repair-part-once", repairJobId: repairId, partId, quantity: 2 };
  await addRepairPart(partRequest);
  await addRepairPart(partRequest);

  const payment = { idempotencyKey: "repair-payment-once", repairJobId: repairId, amountCents: 10000, method: "cash", reference: "RCPT-100" };
  await recordPayment(payment);
  await recordPayment(payment);
  await updateRepairJob(repairId, {
    status: "in_progress",
    deviceType: "Phone",
    brand: "Example",
    model: "X2",
    serialNumber: "S-100",
    reportedIssue: "Charge port is intermittent",
    diagnosis: "Worn connector",
    serviceChargeCents: 50000
  });

  const [part] = await listSpareParts();
  const [job] = await listRepairJobs();
  assert.equal(part.quantity, 2);
  assert.equal(job.parts.length, 1);
  assert.equal(job.parts_total_cents, 50000);
  assert.equal(job.paid_cents, 10000);
  assert.equal(job.status, "in_progress");
  assert.equal(job.model, "X2");
  assert.equal(job.diagnosis, "Worn connector");
  assert.equal(job.payments.length, 1);
  assert.equal(job.payments[0].reference, "RCPT-100");
  assert.equal((await listCustomers("repairs")).length, 1);
});

test("stock adjustments and reports use saved rows", async () => {
  const ingredientId = await saveIngredient({ name: "Milk", unit: "ml", quantity: 25 });
  const adjustment = { mode: "sales", itemId: ingredientId, delta: 5, reason: "Delivery", idempotencyKey: "delivery-once" };
  await adjustStock(adjustment);
  await adjustStock(adjustment);

  assert.equal((await listIngredients())[0].quantity, 30);
  const report = await getReport("sales", "2000-01-01T00:00:00.000Z");
  assert.equal(Number(report.summary.count), 0);
  const movements = await plugin.query({ statement: "SELECT COUNT(*) AS count FROM stock_movements WHERE idempotency_key = 'delivery-once'" });
  assert.equal(movements.values[0].count, 1);
});
