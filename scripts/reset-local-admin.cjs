// Local recovery only. Never point this command at a production database.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { DatabaseSync } = require('node:sqlite');

async function resetLocalAdmin() {
  if (process.env.NODE_ENV === 'production') throw new Error('This command only resets a local development administrator.');
  const directory = path.resolve(__dirname, '..', 'data');
  if (process.env.DATA_DIR && path.resolve(process.env.DATA_DIR) !== directory) {
    throw new Error('Unset DATA_DIR before using local recovery; only this checkout data directory is supported.');
  }
  const file = path.join(directory, 'properties.db');
  if (!fs.existsSync(file) || fs.realpathSync(directory).toLowerCase() !== directory.toLowerCase() || fs.lstatSync(file).isSymbolicLink()) {
    throw new Error('Expected an existing database in this checkout data directory.');
  }
  const database = new DatabaseSync(file);
  database.exec('PRAGMA busy_timeout = 5000;');
  try {
    const admins = database.prepare("SELECT id, email FROM admin_users WHERE role = 'admin'").all();
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== '--email')) throw new Error('Usage: npm run reset-admin:local -- [--email admin@example.com]');
    const admin = args.length ? admins.find(row => row.email.toLowerCase() === args[1].toLowerCase()) : admins.length === 1 ? admins[0] : null;
    if (!admin) throw new Error('Choose an existing local administrator with --email when there is more than one account.');
    const password = `Local-${crypto.randomBytes(18).toString('base64url')}!`;
    const hash = await bcrypt.hash(password, 12);
    const backup = path.join(directory, `admin-reset-backup-${Date.now()}.db`);
    database.prepare('VACUUM INTO ?').run(backup);
    database.exec('BEGIN IMMEDIATE');
    try {
      database.prepare('UPDATE admin_users SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(hash, admin.id);
      database.prepare('DELETE FROM admin_sessions WHERE admin_id = ?').run(admin.id);
      database.prepare("DELETE FROM rate_limits WHERE key LIKE 'admin-login:%'").run();
      database.prepare('INSERT INTO audit_logs (actor, action, target, details) VALUES (?, ?, ?, ?)')
        .run('local-recovery', 'admin.password_reset', String(admin.id), JSON.stringify({ mustChangePassword: true }));
      database.exec('COMMIT');
    } catch (error) { database.exec('ROLLBACK'); throw error; }
    if (!await bcrypt.compare(password, database.prepare('SELECT password_hash FROM admin_users WHERE id = ?').get(admin.id).password_hash)) {
      throw new Error('Password reset read-back failed.');
    }
    console.log(JSON.stringify({ email: admin.email, temporaryPassword: password, mustChangePassword: true, backup }));
  } finally { database.close(); }
}

resetLocalAdmin().catch(error => { console.error(error.message); process.exitCode = 1; });
