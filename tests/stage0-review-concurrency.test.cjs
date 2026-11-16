const { test } = require('node:test');
const assert = require('node:assert/strict');
const { edge, database, employee, attachmentUrl } = require('./helpers/edge.cjs');
const { reportSql } = require('./helpers/report-sql.cjs');
const finance = require('../finance-data.js');
const exportData = require('../finance-export-data.js');

// Real report SQL/compare-and-swap, synthetic staff sessions and intercepted
// archival. This is intentionally not a live PostgREST/GoTrue or Drive test.
test('two managers accepting one report commit one completion and one financial row', { timeout: 15000 }, async () => {
  const staff = [employee('m'), employee('manager_a', 'manager'), employee('manager_b', 'manager')];
  const order = {
    id: '7395762-stage0-synthetic', source: 'Лемана Про', status: 'В работе',
    master_staff_id: 'm', master_workflow_stage: 'started',
    amount: 1000, original_amount: 1000, master_payout: 552.5,
    extra_work_amount: 100, work: 'Тестовый монтаж', address: 'Тестовый адрес',
    report_review_status: 'pending', report_upload_token: 'stage0-review',
    report_uploaded_at: '2026-11-16T09:00:00Z', updated_at: '2026-11-16T09:00:00Z',
    report_type: 'work', report_act_url: attachmentUrl('7395762-stage0-synthetic', 'stage0-review'),
    report_photo_urls: JSON.stringify([attachmentUrl('7395762-stage0-synthetic', 'stage0-review', 'photo.jpg')]),
  };
  const db = database({ business_staff: staff, orders: [order] });
  const sql = await reportSql(db);
  try {
    let arrivals = 0;
    let release;
    const bothRead = new Promise(resolve => { release = resolve; });
    const before = await sql.read(order.id);
    const api = edge('order-lifecycle-api', db, {
      fetch: async () => {
        // Both handlers have read the same pending report before either writes.
        if (++arrivals === 2) release();
        await bothRead;
        return Response.json({ ok: true, order: {
          ...before, drive_archive_status: 'archived', drive_archive_url: 'https://drive.test/stage0',
        } });
      },
    });
    const body = {
      action: 'reviewReport', id: order.id, decision: 'approved',
      expected_report_token: before.report_upload_token,
      expected_report_uploaded_at: before.report_uploaded_at,
    };
    const results = await Promise.all([
      api(body, 'staff_manager_a'), api(body, 'staff_manager_b'),
    ]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    assert.equal(sql.trace.filter(change => change.rows.length).length, 1);
    const saved = await sql.read(order.id);
    assert.equal(saved.status, 'Выполнена');
    assert.equal(saved.report_review_status, 'approved');
    assert.equal(saved.master_payout, 552.5);
    assert.equal(saved.extra_work_amount, 100);
    const rows = finance.records([saved], staff);
    assert.equal(rows.length, 1);
    assert.equal(finance.aggregate(rows).pay, 652.5);
    const statement = exportData.snapshot([saved], staff, [], { master: 'm', format: 'master' });
    assert.equal(statement.rows.length, 1);
    assert.equal(statement.total.pay, 652.5);

    // The response of the winner may be lost. Either manager can safely retry.
    const attempts = sql.trace.length;
    for (const actor of ['staff_manager_a', 'staff_manager_b']) {
      assert.equal((await api(body, actor)).status, 200);
      assert.deepEqual(await sql.read(order.id), saved);
    }
    assert.equal(sql.trace.length, attempts);
    assert.equal(arrivals, 2);
  } finally {
    await sql.close();
  }
});
