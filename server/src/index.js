import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import cors from 'cors';
import nodemailer from 'nodemailer';
import crypto from 'node:crypto';
import db from './db.js';

const app = express();
const PORT = Number(process.env.PORT || 4000);
const TOKEN_TTL_SECONDS = 8 * 60 * 60;
const TOKEN_SECRET = process.env.TOKEN_SECRET || crypto.randomBytes(32).toString('hex');
if (process.env.TOKEN_SECRET && process.env.TOKEN_SECRET.length < 32) throw new Error('TOKEN_SECRET must be at least 32 characters long.');
const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map(value => value.trim()).filter(Boolean);
app.disable('x-powered-by');
app.use(cors({ origin(origin, callback) { if (!origin || allowedOrigins.includes(origin)) return callback(null, true); return callback(new Error('Origin is not allowed by CORS.')); } }));
app.use(express.json({ limit: '1mb' }));
app.use((_req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

const money = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const validDate = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};
const validTime = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
const timeMinutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
const validEmail = value => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
const todayInAppZone = () => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIME_ZONE || 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};
const mapSpace = space => ({ ...space, amenities: JSON.parse(space.amenities), active: Boolean(space.active) });
const mapBooking = booking => ({ ...booking, rate: Number(booking.rate), total: Number(booking.total), capacity: Number(booking.capacity), amenities: JSON.parse(booking.amenities) });
const publicUser = user => ({ id: Number(user.id), username: user.username, role: user.role });

function hashPassword(password, salt = crypto.randomBytes(16).toString('base64url')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('base64url');
  return `scrypt$${salt}$${hash}`;
}
function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const [algorithm, salt, hash] = stored.split('$');
  if (algorithm !== 'scrypt' || !salt || !hash) return false;
  try {
    const actual = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, 'base64url');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch { return false; }
}
function signToken(user) {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ sub: Number(user.id), username: user.username, role: user.role, tv: Number(user.token_version || 0), iat: now, exp: now + TOKEN_TTL_SECONDS })).toString('base64url');
  const signature = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}
function readToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return null;
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(parts[0]).digest();
  let supplied;
  try { supplied = Buffer.from(parts[1], 'base64url'); } catch { return null; }
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (!payload.sub || !payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

// Create a single administrator on the first run. The generated password is only for local setup;
// set ADMIN_USERNAME and ADMIN_PASSWORD in server/.env before the first start for a known credential.
function ensureInitialAdmin() {
  const existing = db.prepare('SELECT id FROM users LIMIT 1').get();
  if (existing) return;
  const username = String(process.env.ADMIN_USERNAME || 'admin').trim();
  let password = process.env.ADMIN_PASSWORD || '';
  let generated = false;
  if (!password) {
    password = crypto.randomBytes(18).toString('base64url');
    generated = true;
  }
  if (username.length < 3 || username.length > 80) throw new Error('ADMIN_USERNAME must be between 3 and 80 characters.');
  if (password.length < 12 || password.length > 128) throw new Error('ADMIN_PASSWORD must contain between 12 and 128 characters.');
  const result = db.prepare('INSERT INTO users (username, password_hash, role, active) VALUES (?, ?, ?, 1)')
    .run(username, hashPassword(password), 'admin');
  if (generated) {
    const credentialsPath = new URL('../data/initial-admin-credentials.txt', import.meta.url);
    const credentialsText = `TRACE Expert City initial administrator\nUsername: ${username}\nPassword: ${password}\n\nSign in and change this password in Settings. Delete this file after saving the new password securely.\n`;
    try {
      fs.writeFileSync(credentialsPath, credentialsText, { mode: 0o600 });
      try { fs.chmodSync(credentialsPath, 0o600); } catch { /* Windows ACLs are handled by the OS. */ }
      console.warn(`\n[INITIAL ADMIN CREATED] Username: ${username}\nPassword: ${password}\nA local copy was saved to server/data/initial-admin-credentials.txt. Change this password after signing in.\n`);
    } catch (error) {
      console.warn(`\n[INITIAL ADMIN CREATED] Username: ${username}\nPassword: ${password}\nSave these credentials now.\n`);
    }
  } else {
    console.log(`Initial administrator '${username}' created from server/.env.`);
  }
  return result;
}
const loginFailures = new Map();
const inquirySubmissions = new Map();
function rateLimitMap(map, { limit, windowMs, message }) {
  return (req, res, next) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const record = map.get(key);
    if (!record || record.resetAt <= now) {
      map.set(key, { count: 0, resetAt: now + windowMs });
    }
    const current = map.get(key);
    if (current.count >= limit) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((current.resetAt - now) / 1000))));
      return res.status(429).json({ error: message });
    }
    req.rateLimitKey = key;
    next();
  };
}
const loginRateLimit = rateLimitMap(loginFailures, { limit: 8, windowMs: 15 * 60 * 1000, message: 'Too many login attempts. Wait 15 minutes and try again.' });
const inquiryRateLimit = rateLimitMap(inquirySubmissions, { limit: 8, windowMs: 15 * 60 * 1000, message: 'Too many inquiries from this connection. Please try again later.' });
function requireAuth(req, res, next) {
  const authorization = req.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  const payload = match ? readToken(match[1]) : null;
  if (!payload) return res.status(401).json({ error: 'Your session has expired. Sign in again.' });
  const user = db.prepare('SELECT id, username, role, active, token_version FROM users WHERE id=?').get(Number(payload.sub));
  if (!user || !user.active || Number(user.token_version) !== Number(payload.tv)) return res.status(401).json({ error: 'Your session is no longer valid. Sign in again.' });
  req.user = user;
  next();
}
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Administrator access is required.' });
  next();
}
function requireEditor(req, res, next) {
  if (!['admin', 'staff'].includes(req.user?.role)) return res.status(403).json({ error: 'Your account can view records but cannot change bookings.' });
  next();
}

function calculatePrice(space, startDate, endDate, unit, quantity, startTime, endTime) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const days = Math.floor((end - start) / 86400000) + 1;
  const baseRate = Number(space.rate);
  if (unit === 'hour') {
    if (space.category !== 'meeting_room') throw Object.assign(new Error('Hourly bookings are available for meeting and training rooms only.'), { status: 400 });
    if (startDate !== endDate) throw Object.assign(new Error('Hourly bookings must start and end on the same date.'), { status: 400 });
    if (!validTime(startTime) || !validTime(endTime)) throw Object.assign(new Error('Choose a valid start time and end time for the hourly booking.'), { status: 400 });
    const durationMinutes = timeMinutes(endTime) - timeMinutes(startTime);
    if (durationMinutes <= 0 || durationMinutes % 60 !== 0) throw Object.assign(new Error('The end time must be after the start time, in whole-hour increments.'), { status: 400 });
    const durationHours = durationMinutes / 60;
    if (durationHours < 1 || durationHours > 12) throw Object.assign(new Error('Hourly duration must be between 1 and 12 hours.'), { status: 400 });
    if (Number(quantity) !== durationHours) throw Object.assign(new Error('The selected duration does not match the start and end times.'), { status: 400 });
    return { rate: baseRate, total: money(baseRate * durationHours), days, quantity: durationHours, startTime, endTime };
  }
  if (space.category === 'meeting_room' && !['day'].includes(unit)) throw Object.assign(new Error('Meeting and training rooms can be booked hourly or daily.'), { status: 400 });
  if (space.category === 'auditorium' && unit !== 'day') throw Object.assign(new Error('The auditorium is booked by the day.'), { status: 400 });
  if (space.category === 'coworking_desk' && !['day', 'week', 'month'].includes(unit)) throw Object.assign(new Error('Co-working desks can be booked by day, week, or month.'), { status: 400 });
  const rate = space.category === 'meeting_room' ? money(baseRate * 8) : unit === 'week' ? money(baseRate * 7) : unit === 'month' ? money(baseRate * 30) : baseRate;
  if (unit === 'day') return { rate, total: money(rate * days), days, quantity: days, startTime: null, endTime: null };
  if (unit === 'week') {
    const blocks = Math.ceil(days / 7);
    return { rate, total: money(rate * blocks), days, quantity: blocks, startTime: null, endTime: null };
  }
  const blocks = Math.ceil(days / 30);
  return { rate, total: money(rate * blocks), days, quantity: blocks, startTime: null, endTime: null };
}

function getAvailability(startDate, endDate, category, rentalUnit = 'day', startTime = '', endTime = '') {
  let sql = `SELECT s.*,
    CASE WHEN ? = 'hour' AND s.category <> 'meeting_room' THEN 0 ELSE NOT EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.space_id = s.id
        AND LOWER(b.status) = 'confirmed'
        AND b.start_date <= ?
        AND b.end_date >= ?
        AND (
          ? <> 'hour' OR b.rental_unit <> 'hour'
          OR b.start_time IS NULL OR b.end_time IS NULL
          OR (b.start_time < ? AND b.end_time > ?)
        )
    ) END AS available
    FROM spaces s
    WHERE s.active = 1`;
  const params = [rentalUnit, endDate, startDate, rentalUnit, endTime, startTime];
  if (category && category !== 'all') {
    sql += ' AND s.category = ?';
    params.push(category);
  }
  sql += ' ORDER BY s.category, s.name';
  return db.prepare(sql).all(...params).map(space => ({ ...mapSpace(space), available: Boolean(space.available) }));
}
function allBookingRows({ search = '', status = 'all', from = '', to = '' } = {}) {
  let sql = `SELECT b.*, s.name AS space_name, s.category, s.capacity, s.amenities,
    c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone
    FROM bookings b JOIN spaces s ON s.id = b.space_id JOIN customers c ON c.id = b.customer_id WHERE 1=1`;
  const params = [];
  if (status !== 'all') { sql += ' AND b.status = ?'; params.push(status); }
  if (from) { sql += ' AND b.end_date >= ?'; params.push(from); }
  if (to) { sql += ' AND b.start_date <= ?'; params.push(to); }
  if (search) {
    sql += ' AND (b.reference LIKE ? OR c.name LIKE ? OR c.email LIKE ? OR s.name LIKE ?)';
    const q = `%${search}%`; params.push(q, q, q, q);
  }
  sql += ' ORDER BY b.start_date DESC, b.id DESC';
  return db.prepare(sql).all(...params).map(mapBooking);
}

ensureInitialAdmin();
if (!process.env.TOKEN_SECRET) console.warn('[SECURITY] TOKEN_SECRET is not set. Sessions will be invalidated when the API restarts. Set a long random secret in server/.env for persistent sessions.');

app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'TRACE Expert City Space Booking API' }));
app.post('/api/auth/login', loginRateLimit, (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim().slice(0, 80) : '';
  const password = typeof req.body?.password === 'string' && req.body.password.length <= 128 ? req.body.password : '';
  const user = db.prepare('SELECT id, username, password_hash, role, active, token_version FROM users WHERE LOWER(username)=LOWER(?)').get(username);
  if (!user || !user.active || !verifyPassword(password, user.password_hash)) {
    const key = req.rateLimitKey || req.ip || 'unknown';
    const record = loginFailures.get(key) || { count: 0, resetAt: Date.now() + 15 * 60 * 1000 };
    record.count += 1;
    loginFailures.set(key, record);
    return res.status(401).json({ error: 'Incorrect username or password.' });
  }
  loginFailures.delete(req.rateLimitKey || req.ip || 'unknown');
  db.prepare('UPDATE users SET last_login=CURRENT_TIMESTAMP WHERE id=?').run(user.id);
  const latestUser = db.prepare('SELECT id, username, role, token_version FROM users WHERE id=?').get(user.id);
  res.json({ token: signToken(latestUser), user: publicUser(latestUser), expiresIn: TOKEN_TTL_SECONDS });
});
app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));
app.post('/api/auth/logout', requireAuth, (req, res) => {
  db.prepare('UPDATE users SET token_version=token_version+1 WHERE id=?').run(req.user.id);
  res.json({ message: 'Signed out successfully.' });
});
app.post('/api/auth/change-password', requireAuth, requireAdmin, (req, res) => {
  const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
  const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
  const user = db.prepare('SELECT id, username, password_hash, role, token_version FROM users WHERE id=?').get(req.user.id);
  if (!verifyPassword(currentPassword, user.password_hash)) return res.status(400).json({ error: 'Your current password is incorrect.' });
  if (newPassword.length < 12 || newPassword.length > 128) return res.status(400).json({ error: 'Your new password must be between 12 and 128 characters.' });
  if (newPassword === currentPassword) return res.status(400).json({ error: 'Choose a new password that differs from your current password.' });
  db.prepare('UPDATE users SET password_hash=?, token_version=token_version+1 WHERE id=?').run(hashPassword(newPassword), user.id);
  const updatedUser = db.prepare('SELECT id, username, role, token_version FROM users WHERE id=?').get(user.id);
  res.json({ message: 'Password updated. Other active sessions have been signed out.', token: signToken(updatedUser), user: publicUser(updatedUser) });
});

// Space list stays public for the visitor inquiry form. All management data and operations are protected.
app.get('/api/spaces', (_req, res) => res.json(db.prepare('SELECT * FROM spaces WHERE active=1 ORDER BY category,name').all().map(mapSpace)));
app.get('/api/spaces/:id/calendar', requireAuth, (req, res) => {
  const spaceId = Number(req.params.id);
  const month = String(req.query.month || '');
  if (!Number.isInteger(spaceId) || spaceId < 1 || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.status(400).json({ error: 'Provide a valid space ID and month (YYYY-MM).' });
  const space = db.prepare('SELECT id, name FROM spaces WHERE id=? AND active=1').get(spaceId);
  if (!space) return res.status(404).json({ error: 'Space not found.' });
  const [year, monthNumber] = month.split('-').map(Number);
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-${String(new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()).padStart(2, '0')}`;
  const bookings = db.prepare(`SELECT id, reference, start_date, end_date, start_time, end_time, rental_unit
    FROM bookings WHERE space_id=? AND LOWER(status)='confirmed' AND start_date <= ? AND end_date >= ? ORDER BY start_date, end_date`)
    .all(spaceId, monthEnd, monthStart);
  res.json({ space, month, bookings });
});
app.get('/api/availability', requireAuth, (req, res) => {
  const { startDate, endDate, category = 'all', startTime = '', endTime = '' } = req.query;
  const rentalUnit = ['hour', 'day', 'week', 'month'].includes(req.query.rentalUnit) ? req.query.rentalUnit : 'day';
  if (!validDate(startDate) || !validDate(endDate) || endDate < startDate) return res.status(400).json({ error: 'Choose real calendar dates with a valid start and end date.' });
  if (rentalUnit === 'hour') {
    if (startDate !== endDate || !validTime(startTime) || !validTime(endTime)) return res.status(400).json({ error: 'Hourly availability needs one date, a start time, and an end time.' });
    const duration = timeMinutes(endTime) - timeMinutes(startTime);
    if (duration < 60 || duration > 720 || duration % 60 !== 0) return res.status(400).json({ error: 'Choose a whole-hour time slot between 1 and 12 hours.' });
  }
  res.json(getAvailability(startDate, endDate, category, rentalUnit, startTime, endTime));
});
app.get('/api/bookings', requireAuth, (req, res) => {
  const search = String(req.query.search || '').trim().slice(0, 160);
  const status = String(req.query.status || 'all');
  const from = req.query.from || '';
  const to = req.query.to || '';
  if (!['all', 'confirmed', 'cancelled'].includes(status)) return res.status(400).json({ error: 'Invalid booking status filter.' });
  if ((from && !validDate(from)) || (to && !validDate(to)) || (from && to && from > to)) return res.status(400).json({ error: 'Invalid booking date filter.' });
  res.json(allBookingRows({ search, status, from, to }));
});
app.get('/api/bookings/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid booking ID.' });
  const row = allBookingRows().find(booking => booking.id === id);
  if (!row) return res.status(404).json({ error: 'Booking not found.' });
  res.json(row);
});

// BEGIN IMMEDIATE serializes writes. Date overlaps conflict except when both reservations are
// timed hourly bookings on the same day, in which case their time intervals are compared.
const createBooking = db.transaction(payload => {
  const space = db.prepare('SELECT * FROM spaces WHERE id=? AND active=1').get(payload.spaceId);
  if (!space) throw Object.assign(new Error('That space could not be found.'), { status: 404 });
  const price = calculatePrice(space, payload.startDate, payload.endDate, payload.rentalUnit, payload.quantity, payload.startTime, payload.endTime);
  const conflict = db.prepare(`SELECT id, reference FROM bookings b
    WHERE b.space_id=? AND LOWER(b.status)='confirmed'
      AND b.start_date <= ? AND b.end_date >= ?
      AND NOT (
        ? = 'hour' AND b.rental_unit = 'hour'
        AND b.start_date = ? AND b.end_date = ?
        AND b.start_time IS NOT NULL AND b.end_time IS NOT NULL
        AND (b.end_time <= ? OR b.start_time >= ?)
      ) LIMIT 1`).get(payload.spaceId, payload.endDate, payload.startDate, payload.rentalUnit,
        payload.startDate, payload.endDate, price.startTime || '', price.endTime || '');
  if (conflict) throw Object.assign(new Error(`This space is already booked for the requested date or time (booking ${conflict.reference}). Choose another slot.`), { status: 409 });
  const insertCustomer = db.prepare('INSERT INTO customers (name,email,phone) VALUES (?,?,?)');
  const customer = insertCustomer.run(payload.customerName.trim(), payload.customerEmail.trim().toLowerCase(), (payload.customerPhone || '').trim());
  const reference = `TRC-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const result = db.prepare(`INSERT INTO bookings (reference,space_id,customer_id,start_date,end_date,start_time,end_time,rental_unit,quantity,rate,total,status,notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,'confirmed',?)`).run(reference, space.id, customer.lastInsertRowid,
      payload.startDate, payload.endDate, price.startTime, price.endTime, payload.rentalUnit, price.quantity,
      price.rate, price.total, (payload.notes || '').trim());
  return {
    id: Number(result.lastInsertRowid), reference, total: price.total, rate: price.rate,
    quantity: price.quantity, spaceName: space.name,
    customerName: payload.customerName.trim(), customerEmail: payload.customerEmail.trim().toLowerCase(),
    startDate: payload.startDate, endDate: payload.endDate,
    startTime: price.startTime, endTime: price.endTime, rentalUnit: payload.rentalUnit
  };
});

const escapeHtml = value => String(value ?? '').replace(/[&<>\"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;'
}[character]));
const formatEmailDate = value => new Intl.DateTimeFormat('en-GB', {
  day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC'
}).format(new Date(`${value}T00:00:00Z`));
const formatEmailMoney = value => new Intl.NumberFormat('en-LK', {
  style: 'currency', currency: 'LKR', maximumFractionDigits: 2
}).format(Number(value || 0));

async function sendBookingConfirmationEmail(booking) {
  const configured = process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS;
  if (!configured) {
    console.log('[BOOKING CONFIRMATION EMAIL NOT SENT: SMTP not configured] Configure SMTP to email customers after bookings.');
    return false;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  const name = escapeHtml(booking.customerName);
  const reference = escapeHtml(booking.reference);
  const spaceName = escapeHtml(booking.spaceName);
  const dateRange = booking.startDate === booking.endDate
    ? formatEmailDate(booking.startDate)
    : `${formatEmailDate(booking.startDate)} – ${formatEmailDate(booking.endDate)}`;
  const timeRange = booking.rentalUnit === 'hour' && booking.startTime && booking.endTime
    ? `${booking.startTime} – ${booking.endTime}` : '';
  const rentalUnitLabel = ({ hour: 'hour', day: 'day', week: 'week', month: 'month' })[booking.rentalUnit] || booking.rentalUnit;
  const total = formatEmailMoney(booking.total);
  const rate = formatEmailMoney(booking.rate);
  const duration = `${booking.quantity} ${rentalUnitLabel}${booking.quantity === 1 ? '' : 's'}`;
  const dateText = timeRange ? `${dateRange}, ${timeRange}` : dateRange;
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const replyTo = process.env.ADMIN_EMAIL || process.env.SMTP_USER;

  await transporter.sendMail({
    from,
    to: booking.customerEmail,
    replyTo,
    subject: `Booking confirmation ${booking.reference} | TRACE Expert City`,
    text: `Hello ${booking.customerName},

Your booking at TRACE Expert City is confirmed.

Booking reference: ${booking.reference}
Space: ${booking.spaceName}
Date${booking.startDate === booking.endDate ? '' : 's'}: ${dateText}
Duration: ${duration}
Rate: ${rate}
Total: ${total}

Please keep your booking reference for future enquiries. If you need help, reply to this email.

TRACE Expert City`,
    html: `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f7f6;font-family:Arial,Helvetica,sans-serif;color:#20312d"><div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e2e9e6;border-radius:12px;overflow:hidden"><div style="padding:24px 28px;background:#173f35;color:#fff"><div style="font-size:12px;letter-spacing:2px;font-weight:bold">TRACE EXPERT CITY</div><h1 style="font-size:24px;margin:12px 0 0">Booking confirmed</h1></div><div style="padding:28px"><p>Hello ${name},</p><p>Your reservation has been confirmed. Please keep the booking reference below for future enquiries.</p><div style="padding:16px;background:#f2f7f4;border-radius:8px;margin:20px 0"><div style="font-size:12px;color:#52665e">BOOKING REFERENCE</div><div style="font-size:22px;font-weight:bold;letter-spacing:1px;margin-top:6px">${reference}</div></div><table role="presentation" style="width:100%;border-collapse:collapse"><tr><td style="padding:10px 0;color:#61716b;border-bottom:1px solid #e8eeeb">Space</td><td style="padding:10px 0;text-align:right;font-weight:bold;border-bottom:1px solid #e8eeeb">${spaceName}</td></tr><tr><td style="padding:10px 0;color:#61716b;border-bottom:1px solid #e8eeeb">Date${booking.startDate === booking.endDate ? '' : 's'}</td><td style="padding:10px 0;text-align:right;border-bottom:1px solid #e8eeeb">${escapeHtml(dateText)}</td></tr><tr><td style="padding:10px 0;color:#61716b;border-bottom:1px solid #e8eeeb">Duration</td><td style="padding:10px 0;text-align:right;border-bottom:1px solid #e8eeeb">${escapeHtml(duration)}</td></tr><tr><td style="padding:10px 0;color:#61716b;border-bottom:1px solid #e8eeeb">Rate</td><td style="padding:10px 0;text-align:right;border-bottom:1px solid #e8eeeb">${escapeHtml(rate)}</td></tr><tr><td style="padding:14px 0;font-weight:bold;font-size:16px">Total</td><td style="padding:14px 0;text-align:right;font-weight:bold;font-size:18px;color:#176b4d">${escapeHtml(total)}</td></tr></table><p style="margin-top:24px">If you have any questions or need to make a change, reply to this email.</p><p style="color:#61716b;font-size:13px;margin-top:28px">TRACE Expert City · Space bookings</p></div></div></body></html>`
  });
  return true;
}

app.post('/api/bookings', requireAuth, requireEditor, async (req, res) => {
  const p = req.body || {};
  const customerName = typeof p.customerName === 'string' ? p.customerName.trim() : '';
  const customerEmail = typeof p.customerEmail === 'string' ? p.customerEmail.trim() : '';
  const customerPhone = typeof p.customerPhone === 'string' ? p.customerPhone.trim() : '';
  const notes = typeof p.notes === 'string' ? p.notes.trim() : '';
  if (!Number.isInteger(Number(p.spaceId)) || Number(p.spaceId) < 1 || !customerName || customerName.length > 120 || !validEmail(customerEmail) || !validDate(p.startDate) || !validDate(p.endDate) || p.endDate < p.startDate || p.startDate < todayInAppZone()) {
    return res.status(400).json({ error: 'Provide a valid space, customer name, email address, and future or current start/end dates.' });
  }
  if (customerPhone.length > 60 || notes.length > 1000) return res.status(400).json({ error: 'Phone number or notes exceed the allowed length.' });
  const rentalUnit = ['hour', 'day', 'week', 'month'].includes(p.rentalUnit) ? p.rentalUnit : 'day';
  const quantity = Number(p.quantity ?? 1);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 720) return res.status(400).json({ error: 'Duration must be a positive whole number.' });
  try {
    const normalized = { ...p, customerName, customerEmail, customerPhone, notes, spaceId: Number(p.spaceId), quantity, rentalUnit };
    const result = createBooking.immediate(normalized);
    let emailStatus = 'not_configured';
    try {
      const emailSent = await sendBookingConfirmationEmail(result);
      emailStatus = emailSent ? 'sent' : 'not_configured';
    } catch (emailError) {
      emailStatus = 'failed';
      console.error(`Booking ${result.reference} was saved, but its confirmation email failed:`, emailError.message);
    }
    const message = emailStatus === 'sent'
      ? 'Booking created successfully. A confirmation email was sent to the customer.'
      : emailStatus === 'failed'
        ? 'Booking created successfully, but the confirmation email could not be sent. Check SMTP settings.'
        : 'Booking created successfully. Confirmation email is not configured yet.';
    res.status(201).json({ message, ...result, emailSent: emailStatus === 'sent', emailStatus });
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error('Booking creation failed:', error.message);
    res.status(status).json({ error: status >= 500 ? 'Could not create booking because of a server error.' : (error.message || 'Could not create booking.') });
  }
});
app.patch('/api/bookings/:id/cancel', requireAuth, requireEditor, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid booking ID.' });
  const result = db.prepare("UPDATE bookings SET status='cancelled' WHERE id=? AND status='confirmed'").run(id);
  if (!result.changes) return res.status(404).json({ error: 'Active booking not found.' });
  res.json({ message: 'Booking cancelled. The space is available for new reservations.' });
});

async function sendInquiryEmail(inquiry, spaceName) {
  const configured = process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS;
  if (!configured) {
    console.log('[INQUIRY EMAIL NOT SENT: SMTP not configured] Configure SMTP to deliver inquiry notifications.');
    return false;
  }
  const transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true', auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
  await transporter.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: process.env.ADMIN_EMAIL || process.env.SMTP_USER, replyTo: inquiry.email, subject: `TRACE Expert City space inquiry: ${spaceName || 'Space request'}`, text: `New space inquiry\n\nName: ${inquiry.name}\nEmail: ${inquiry.email}\nPhone: ${inquiry.phone || 'Not provided'}\nSpace: ${spaceName || 'Not specified'}\nDates: ${inquiry.start_date || 'Not specified'} to ${inquiry.end_date || 'Not specified'}\nRental unit: ${inquiry.rental_unit}\nMessage: ${inquiry.message || 'No message'}\n\nInquiry ID: ${inquiry.id}` });
  return true;
}
app.post('/api/inquiries', inquiryRateLimit, async (req, res) => {
  const limitKey = req.rateLimitKey || req.ip || 'unknown';
  const limitRecord = inquirySubmissions.get(limitKey);
  if (limitRecord) limitRecord.count += 1;
  const p = req.body || {};
  const name = typeof p.name === 'string' ? p.name.trim() : '';
  const email = typeof p.email === 'string' ? p.email.trim() : '';
  const phone = typeof p.phone === 'string' ? p.phone.trim() : '';
  const messageText = typeof p.message === 'string' ? p.message.trim() : '';
  if (!name || name.length > 120 || !validEmail(email) || !messageText || messageText.length > 2000 || phone.length > 60) return res.status(400).json({ error: 'Enter a name, valid email, and message. Check the field lengths.' });
  if ((p.startDate && (!validDate(p.startDate) || p.startDate < todayInAppZone())) || (p.endDate && (!validDate(p.endDate) || p.endDate < todayInAppZone())) || (p.startDate && p.endDate && p.endDate < p.startDate)) return res.status(400).json({ error: 'Please choose current or future dates in a valid range.' });
  const spaceId = p.spaceId ? Number(p.spaceId) : null;
  const space = spaceId ? db.prepare('SELECT * FROM spaces WHERE id=? AND active=1').get(spaceId) : null;
  if (p.spaceId && (!Number.isInteger(spaceId) || !space)) return res.status(400).json({ error: 'Choose a valid space.' });
  const rentalUnit = ['hour', 'day', 'week', 'month'].includes(p.rentalUnit) ? p.rentalUnit : 'day';
  const result = db.prepare('INSERT INTO inquiries (name,email,phone,space_id,start_date,end_date,rental_unit,message) VALUES (?,?,?,?,?,?,?,?)')
    .run(name, email.toLowerCase(), phone, space?.id || null, p.startDate || null, p.endDate || null, rentalUnit, messageText);
  const inquiry = { id: Number(result.lastInsertRowid), name, email, phone, start_date: p.startDate || '', end_date: p.endDate || '', rental_unit: rentalUnit, message: messageText };
  let emailSent = false;
  let emailStatus = 'not_configured';
  try { emailSent = await sendInquiryEmail(inquiry, space?.name || 'Not specified'); emailStatus = emailSent ? 'sent' : 'not_configured'; }
  catch (error) { emailStatus = 'failed'; console.error('Inquiry saved but email delivery failed:', error.message); }
  const responseMessage = emailStatus === 'sent' ? 'Inquiry sent. The TRACE team will follow up.' : emailStatus === 'failed' ? 'Inquiry saved, but email delivery failed. The administrator can review the saved inquiry and check SMTP settings.' : 'Inquiry saved. Email is not configured yet; the administrator can review it in the database.';
  res.status(201).json({ message: responseMessage, id: inquiry.id, emailSent, emailStatus });
});
app.get('/api/inquiries', requireAuth, (_req, res) => {
  const rows = db.prepare('SELECT i.*, s.name AS space_name FROM inquiries i LEFT JOIN spaces s ON s.id=i.space_id ORDER BY i.id DESC').all();
  res.json(rows);
});
app.get('/api/dashboard', requireAuth, (_req, res) => {
  const today = todayInAppZone();
  const totalSpaces = db.prepare('SELECT COUNT(*) AS n FROM spaces WHERE active=1').get().n;
  const activeBookings = db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE status='confirmed'").get().n;
  const todayBookings = db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE status='confirmed' AND start_date<=? AND end_date>=?").get(today, today).n;
  const revenue = db.prepare("SELECT COALESCE(SUM(total),0) AS n FROM bookings WHERE status='confirmed'").get().n;
  const inquiries = db.prepare('SELECT COUNT(*) AS n FROM inquiries').get().n;
  const todayAvailable = db.prepare(`SELECT COUNT(*) AS n FROM spaces s WHERE active=1 AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.space_id=s.id AND b.status='confirmed' AND b.start_date<=? AND b.end_date>=?)`).get(today, today).n;
  res.json({ totalSpaces, activeBookings, todayBookings, revenue: Number(revenue), inquiries, todayAvailable, date: today });
});

app.use((err, _req, res, _next) => {
  if (err.message === 'Origin is not allowed by CORS.') return res.status(403).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Unexpected server error.' });
});
app.listen(PORT, () => console.log(`TRACE Expert City API running at http://localhost:${PORT}`));
