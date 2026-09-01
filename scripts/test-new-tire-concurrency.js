#!/usr/bin/env node
const assert = require('assert');
const { recordWidgetNewTireOrder } = require('../netlify/functions/lib/new-tire-order');

class Query {
  constructor(database) {
    this.database = database;
    this.filters = {};
    this.inserted = null;
  }

  select() {
    return this;
  }

  eq(column, value) {
    this.filters[column] = value;
    return this;
  }

  insert(row) {
    this.inserted = row;
    return this;
  }

  async maybeSingle() {
    await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 8)));
    const key = this.filters.stripe_session_id;
    return { data: key ? (this.database.orders.get(key) || null) : null, error: null };
  }

  async single() {
    await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 8)));
    const key = this.inserted?.stripe_session_id;
    if (key && this.database.orders.has(key)) {
      return {
        data: null,
        error: { code: '23505', message: 'duplicate key value violates unique constraint' },
      };
    }
    const order = { id: `test-order-${this.database.orders.size + 1}`, ...this.inserted };
    if (key) this.database.orders.set(key, order);
    return { data: order, error: null };
  }
}

async function main() {
  const database = {
    orders: new Map(),
    from(table) {
      assert.strictEqual(table, 'new_tire_orders');
      return new Query(this);
    },
  };
  const request = {
    supabaseAdmin: database,
    userId: '162acae5-a4e8-432b-956b-5cdbd22dbe10',
    customer: {
      name: 'Concurrency Test',
      email: 'concurrency-test@example.invalid',
      phone: '000-000-0000',
    },
    items: [{
      brand: 'Mirage',
      model: 'MR-182',
      size: '225/45R18',
      qty: 4,
      unitPrice: 95.4,
    }],
    fulfillment: 'Pickup',
    vehicle: {},
    notes: 'Automated concurrency test',
    orderNumber: 'concurrency-idempotency-1',
    recordedLocally: true,
    totals: { subtotal: 381.6, tax: 49.61, total: 431.21 },
    appointments: [],
  };

  const responses = await Promise.all(
    Array.from({ length: 40 }, () => recordWidgetNewTireOrder(request)),
  );
  assert.strictEqual(database.orders.size, 1, 'only one order row should be inserted');
  assert.strictEqual(responses.filter((result) => !result.alreadyPaid).length, 1);
  assert.strictEqual(responses.filter((result) => result.alreadyPaid).length, 39);
  assert.strictEqual(new Set(responses.map((result) => result.order.id)).size, 1);
  console.log('ok  40 concurrent duplicate submissions return one order');
}

main().catch((error) => {
  console.error('FAIL concurrency:', error);
  process.exit(1);
});
