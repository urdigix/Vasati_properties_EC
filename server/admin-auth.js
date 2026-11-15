const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { db, consumeRateLimit, logAudit } = require('../db/database');

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const DEFAULT_EMAIL = 'admin@example.com';
const DEFAULT_PASSWORD = 'Admin@12345';

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function getCookie(req, name) {
  const cookies = String(req.headers.cookie || '').split(';');
  for (const item of cookies) {
    const [key, ...parts] = item.trim().split('=');
    if (key === name) { try { return decodeURIComponent(parts.join('=')); } catch { return null; } }
  }
  return null;
}

async function initializeAdmin() {
  const isProduction = process.env.NODE_ENV === 'production';
  const password = process.env.ADMIN_DEFAULT_PASSWORD || (isProduction ? '' : DEFAULT_PASSWORD);
  const email = process.env.ADMIN_DEFAULT_EMAIL || DEFAULT_EMAIL;
  if (isProduction && (!password || password === DEFAULT_PASSWORD)) {
    throw new Error('Production requires a non-default ADMIN_DEFAULT_PASSWORD.');
  }

  const existing = db.prepare('SELECT id, password_hash FROM admin_users LIMIT 1').get();
  if (!existing) {
    const passwordHash = await bcrypt.hash(password, 12);
    db.prepare('INSERT INTO admin_users (email, password_hash, must_change_password) VALUES (?, ?, 1)')
      .run(email.trim().toLowerCase(), passwordHash);
    console.log('Initialized the initial administrator account.');
  } else if (isProduction && await bcrypt.compare(DEFAULT_PASSWORD, existing.password_hash)) {
    throw new Error('Production cannot start while the temporary local administrator password is active.');
  }

  // Explicit operator-requested migration; bootstrap configuration alone never renames accounts.
  const migrateFrom = String(process.env.ADMIN_EMAIL_MIGRATE_FROM || '').trim().toLowerCase();
  const migrateTo = email.trim().toLowerCase();
  if (migrateFrom && migrateFrom !== migrateTo) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(migrateTo)) {
      throw new Error('Administrator email migration requires a valid destination email.');
    }
    const source = db.prepare("SELECT id FROM admin_users WHERE email = ? AND role = 'admin'").get(migrateFrom);
    if (source) {
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('UPDATE admin_users SET email = ? WHERE id = ? AND email = ?')
          .run(migrateTo, source.id, migrateFrom);
        logAudit('deployment', 'admin.email_changed', source.id, { from: migrateFrom, to: migrateTo });
        db.exec('COMMIT');
        console.log(`Administrator email updated to ${migrateTo}.`);
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }
  }
}

function currentAdmin(req) {
  const token = getCookie(req, 'vasati_admin_session');
  if (!token) return null;
  const row = db.prepare(`
    SELECT admin_users.id, admin_users.email, admin_users.role, admin_users.must_change_password
    FROM admin_sessions
    JOIN admin_users ON admin_users.id = admin_sessions.admin_id
    WHERE admin_sessions.token_hash = ? AND admin_sessions.expires_at > ?
  `).get(hash(token), Date.now());
  return row || null;
}

function requireAdmin(req, res, next) {
  const admin = currentAdmin(req);
  if (!admin) return res.status(401).json({ success: false, message: 'Administrator login required.' });
  if (admin.role !== 'admin') return res.status(403).json({ success: false, message: 'Administrator role required.' });
  if (admin.must_change_password) {
    return res.status(403).json({ success: false, message: 'Change the temporary password before continuing.', code: 'PASSWORD_CHANGE_REQUIRED' });
  }
  req.admin = admin;
  next();
}

function activeAdmin(req, res) {
  const admin = currentAdmin(req);
  if (!admin) {
    res.status(401).json({ success: false, message: 'Administrator login required.' });
    return null;
  }
  if (admin.role !== 'admin') {
    res.status(403).json({ success: false, message: 'Administrator role required.' });
    return null;
  }
  if (admin.must_change_password) {
    res.status(403).json({ success: false, message: 'Change the temporary password before continuing.', code: 'PASSWORD_CHANGE_REQUIRED' });
    return null;
  }
  return admin;
}

function issueSession(adminId, res) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare('INSERT INTO admin_sessions (token_hash, admin_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(hash(token), adminId, now + SESSION_TTL_MS, now);
  const flags = [`vasati_admin_session=${encodeURIComponent(token)}`, 'HttpOnly', 'SameSite=Strict', 'Path=/', `Max-Age=${SESSION_TTL_MS / 1000}`];
  if (process.env.NODE_ENV === 'production') flags.push('Secure');
  res.setHeader('Set-Cookie', flags.join('; '));
}

async function login(req, res) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const limit = consumeRateLimit(`admin-login:${ip}`, 8, 15 * 60 * 1000);
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfter));
    return res.status(429).json({ success: false, message: 'Too many login attempts. Try again later.' });
  }

  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = db.prepare('SELECT * FROM admin_users WHERE email = ?').get(email);
  const valid = user ? await bcrypt.compare(password, user.password_hash) : false;
  if (!valid) return res.status(401).json({ success: false, message: 'Email or password is incorrect.' });

  issueSession(user.id, res);
  logAudit(user.email, 'admin.login');
  res.json({ success: true, mustChangePassword: Boolean(user.must_change_password) });
}

function logout(req, res) {
  const token = getCookie(req, 'vasati_admin_session');
  if (token) {
    const admin = currentAdmin(req);
    db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(hash(token));
    if (admin) logAudit(admin.email, 'admin.logout');
  }
  const flags = ['vasati_admin_session=', 'HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=0'];
  if (process.env.NODE_ENV === 'production') flags.push('Secure');
  res.setHeader('Set-Cookie', flags.join('; '));
  res.json({ success: true });
}

async function changePassword(req, res) {
  const admin = currentAdmin(req);
  if (!admin) return res.status(401).json({ success: false, message: 'Administrator login required.' });
  const password = String(req.body.password || '');
  if (password.length < 12 || password.length > 128) {
    return res.status(400).json({ success: false, message: 'Password must be between 12 and 128 characters.' });
  }
  if (password === DEFAULT_PASSWORD && process.env.NODE_ENV === 'production') {
    return res.status(400).json({ success: false, message: 'Choose a unique password.' });
  }
  const passwordHash = await bcrypt.hash(password, 12);
  db.prepare('UPDATE admin_users SET password_hash = ?, must_change_password = 0 WHERE id = ?')
    .run(passwordHash, admin.id);
  db.prepare('DELETE FROM admin_sessions WHERE admin_id = ? AND token_hash != ?')
    .run(admin.id, hash(getCookie(req, 'vasati_admin_session')));
  logAudit(admin.email, 'admin.password_changed');
  res.json({ success: true });
}

module.exports = { initializeAdmin, currentAdmin, activeAdmin, requireAdmin, login, logout, changePassword };
