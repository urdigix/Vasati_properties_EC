const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

test('deleting all listings and slides persists across database initialization', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vasati-persistence-'));
  process.env.DATA_DIR = dataDir;
  const database = require('../db/database');
  try {
    database.initializeDatabase();
    assert.ok(database.getAllProperties().length > 0);
    database.db.exec('DELETE FROM properties; DELETE FROM featured_projects;');
    database.initializeDatabase();
    assert.equal(database.getAllProperties().length, 0);
    assert.equal(database.getFeaturedProjects().length, 0);
    database.db.exec('DROP TABLE schema_migrations;');
    database.initializeDatabase();
    assert.equal(database.getAllProperties().length, 0, 'an existing database without a migration marker is not reseeded');
    assert.equal(database.getFeaturedProjects().length, 0);
  } finally {
    database.db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
