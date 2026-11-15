const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('explicit admin email migration preserves identity and password and is idempotent', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vasati-email-'));
  process.env.DATA_DIR = directory;
  process.env.NODE_ENV = 'development';
  process.env.ADMIN_DEFAULT_EMAIL = 'old@example.test';
  process.env.ADMIN_DEFAULT_PASSWORD = 'temporary-test-password';
  const database = require('../db/database');
  database.initializeDatabase();
  const auth = require('../server/admin-auth');
  try {
    await auth.initializeAdmin();
    const before = database.db.prepare('SELECT * FROM admin_users').get();
    process.env.ADMIN_DEFAULT_EMAIL = 'new@example.test';
    await auth.initializeAdmin();
    assert.equal(database.db.prepare('SELECT email FROM admin_users').get().email, 'old@example.test');
    process.env.ADMIN_EMAIL_MIGRATE_FROM = 'someone-else@example.test';
    await auth.initializeAdmin();
    assert.equal(database.db.prepare('SELECT email FROM admin_users').get().email, 'old@example.test');
    process.env.ADMIN_EMAIL_MIGRATE_FROM = 'old@example.test';
    await auth.initializeAdmin();
    const after = database.db.prepare('SELECT * FROM admin_users').get();
    assert.deepEqual({ ...after }, { ...before, email: 'new@example.test' });
    await auth.initializeAdmin();
    assert.equal(database.db.prepare("SELECT count(*) AS n FROM audit_logs WHERE action = 'admin.email_changed'").get().n, 1);
  } finally {
    database.db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
