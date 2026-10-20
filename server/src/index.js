import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import nodemailer from 'nodemailer';
import crypto from 'node:crypto';
import db from './db.js';

const app = express();
const PORT = Number(process.env.PORT || 4000);
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '1mb' }));
// Availability and booking lists must always reflect the latest database state.
app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate'); res.set('Pragma', 'no-cache'); res.set('Expires', '0'); next(); });

const money = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const validEmail = value => typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const mapSpace = s => ({ ...s, amenities: JSON.parse(s.amenities), active: Boolean(s.active) });
const mapBooking = b => ({ ...b, rate: Number(b.rate), total: Number(b.total), capacity: Number(b.capacity), amenities: JSON.parse(b.amenities) });
function calculatePrice(space, startDate, endDate, unit, quantity) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const days = Math.floor((end - start) / 86400000) + 1;
  if (unit === 'hour') {
    if (!['meeting_room'].includes(space.category)) throw Object.assign(new Error('Hourly bookings are available for meeting and training rooms only.'), { status: 400 });
    if (days !== 1) throw Object.assign(new Error('Hourly bookings must start and end on the same date.'), { status: 400 });
    if (quantity < 1 || quantity > 12) throw Object.assign(new Error('Hourly duration must be between 1 and 12 hours.'), { status: 400 });
    return { rate: Number(space.rate), total: money(Number(space.rate) * quantity), days };
  }
  if (space.category === 'meeting_room' && unit !== 'day') throw Object.assign(new Error('Meeting and training rooms can be booked hourly or daily.'), { status: 400 });
  if (space.category === 'auditorium' && unit !== 'day') throw Object.assign(new Error('The auditorium is booked by the day.'), { status: 400 });
  if (space.category === 'coworking_desk' && !['day','week','month'].includes(unit)) throw Object.assign(new Error('Co-working desks can be booked by day, week, or month.'), { status: 400 });
  const baseRate = Number(space.rate);
  const rate = space.category === 'meeting_room' ? baseRate * 8 : baseRate;
  if (unit === 'day') return { rate, total: money(rate * days), days };
  if (unit === 'week') return { rate: money(rate * 7), total: money(rate * 7 * Math.ceil(days / 7)), days };
  return { rate: money(rate * 30), total: money(rate * 30 * Math.ceil(days / 30)), days };
}
function getAvailability(startDate, endDate, category) {
  // A booking conflicts when its date range intersects the requested range:
  // existing.start_date <= requested.end_date AND existing.end_date >= requested.start_date.
  // Cancelled bookings are intentionally ignored. ISO YYYY-MM-DD dates compare lexically in SQLite.
  let sql = `SELECT s.*,
    NOT EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.space_id = s.id
        AND LOWER(b.status) = 'confirmed'
        AND b.start_date <= ?
        AND b.end_date >= ?
    ) AS available
    FROM spaces s
    WHERE s.active = 1`;
  const params = [endDate, startDate];
  if (category && category !== 'all') {
    sql += ' AND s.category = ?';
    params.push(category);
  }
  sql += ' ORDER BY s.category, s.name';
  return db.prepare(sql).all(...params).map(s => ({ ...mapSpace(s), available: Boolean(s.available) }));
}
function allBookingRows({ search = '', status = 'all', from = '', to = '' } = {}) {
  let sql = `SELECT b.*, s.name AS space_name, s.category, s.capacity, s.amenities, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone
    FROM bookings b JOIN spaces s ON s.id=b.space_id JOIN customers c ON c.id=b.customer_id WHERE 1=1`;
  const params = [];
  if (status !== 'all') { sql += ' AND b.status=?'; params.push(status); }
  if (from) { sql += ' AND b.end_date>=?'; params.push(from); }
  if (to) { sql += ' AND b.start_date<=?'; params.push(to); }
  if (search) { sql += ' AND (b.reference LIKE ? OR c.name LIKE ? OR c.email LIKE ? OR s.name LIKE ?)'; const q = `%${search}%`; params.push(q,q,q,q); }
  sql += ' ORDER BY b.start_date DESC, b.id DESC';
  return db.prepare(sql).all(...params).map(mapBooking);
}

app.get('/api/health', (_req,res) => res.json({ status: 'ok', service: 'TRACE Expert City Space Booking API' }));
app.get('/api/spaces', (_req,res) => res.json(db.prepare('SELECT * FROM spaces WHERE active=1 ORDER BY category,name').all().map(mapSpace)));
app.get('/api/spaces/:id/calendar', (req, res) => {
  const spaceId = Number(req.params.id);
  const month = String(req.query.month || '');
  if (!Number.isInteger(spaceId) || spaceId < 1 || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return res.status(400).json({ error: 'Provide a valid space ID and month (YYYY-MM).' });
  }
  const space = db.prepare('SELECT id, name FROM spaces WHERE id=? AND active=1').get(spaceId);
  if (!space) return res.status(404).json({ error: 'Space not found.' });
  const [year, monthNumber] = month.split('-').map(Number);
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-${String(new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()).padStart(2, '0')}`;
  const bookings = db.prepare(`SELECT id, reference, start_date, end_date, start_time, end_time
    FROM bookings WHERE space_id=? AND LOWER(status)='confirmed'
      AND start_date <= ? AND end_date >= ? ORDER BY start_date, end_date`)
    .all(spaceId, monthEnd, monthStart);
  res.json({ space, month, bookings });
});
app.get('/api/availability', (req,res) => {
  const { startDate, endDate, category='all' } = req.query;
  if (!validDate(startDate) || !validDate(endDate) || endDate < startDate) return res.status(400).json({ error: 'Choose a valid start date and end date.' });
  res.json(getAvailability(startDate, endDate, category));
});
app.get('/api/bookings', (req,res) => res.json(allBookingRows({ search: String(req.query.search || '').trim(), status: req.query.status || 'all', from: req.query.from || '', to: req.query.to || '' })));
app.get('/api/bookings/:id', (req,res) => {
  const row = allBookingRows().find(b => String(b.id) === req.params.id);
  if (!row) return res.status(404).json({ error: 'Booking not found.' });
  res.json(row);
});

// BEGIN IMMEDIATE serializes writers. The overlap check and insert happen in one transaction,
// so concurrent requests cannot both pass the same availability check.
const createBooking = db.transaction(payload => {
  const space = db.prepare('SELECT * FROM spaces WHERE id=? AND active=1').get(payload.spaceId);
  if (!space) throw Object.assign(new Error('That space could not be found.'), { status: 404 });
  const conflict = db.prepare(`SELECT id, reference FROM bookings WHERE space_id=? AND LOWER(status)='confirmed'
    AND start_date <= ? AND end_date >= ? LIMIT 1`).get(payload.spaceId, payload.endDate, payload.startDate);
  if (conflict) throw Object.assign(new Error(`This space is already booked for these dates (booking ${conflict.reference}). Choose another space or date range.`), { status: 409 });
  const price = calculatePrice(space, payload.startDate, payload.endDate, payload.rentalUnit, payload.quantity);
  const insertCustomer = db.prepare('INSERT INTO customers (name,email,phone) VALUES (?,?,?)');
  const customer = insertCustomer.run(payload.customerName.trim(), payload.customerEmail.trim(), (payload.customerPhone || '').trim());
  const reference = `TRC-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const result = db.prepare(`INSERT INTO bookings (reference,space_id,customer_id,start_date,end_date,start_time,end_time,rental_unit,quantity,rate,total,notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(reference, space.id, customer.lastInsertRowid, payload.startDate, payload.endDate,
      payload.startTime || null, payload.endTime || null, payload.rentalUnit, payload.quantity, price.rate, price.total, (payload.notes || '').trim());
  return { id: Number(result.lastInsertRowid), reference, total: price.total, rate: price.rate, spaceName: space.name };
});
app.post('/api/bookings', (req,res) => {
  const p = req.body || {};
  if (!Number.isInteger(Number(p.spaceId)) || !p.customerName?.trim() || !validEmail(p.customerEmail) || !validDate(p.startDate) || !validDate(p.endDate) || p.endDate < p.startDate) {
    return res.status(400).json({ error: 'Provide a space, customer name, valid email, and a valid date range.' });
  }
  const quantity = Number(p.quantity ?? 1);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 720) return res.status(400).json({ error: 'Duration must be a positive whole number.' });
  try {
    const normalized = { ...p, spaceId: Number(p.spaceId), quantity, rentalUnit: p.rentalUnit || 'day' };
    const result = createBooking.immediate(normalized);
    res.status(201).json({ message: 'Booking created successfully.', ...result });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message || 'Could not create booking.' });
  }
});
app.patch('/api/bookings/:id/cancel', (req,res) => {
  const result = db.prepare("UPDATE bookings SET status='cancelled' WHERE id=? AND status='confirmed'").run(Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: 'Active booking not found.' });
  res.json({ message: 'Booking cancelled. The space is available for new bookings.' });
});

async function sendInquiryEmail(inquiry, spaceName) {
  const configured = process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS;
  if (!configured) {
    console.log('\n[INQUIRY EMAIL NOT SENT: SMTP not configured] Admin:', process.env.ADMIN_EMAIL || 'facilities@example.com', '\n', { ...inquiry, spaceName }, '\n');
    return false;
  }
  const transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true', auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
  await transporter.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: process.env.ADMIN_EMAIL || process.env.SMTP_USER, replyTo: inquiry.email, subject: `TRACE Expert City space inquiry: ${spaceName || 'Space request'}`, text: `New space inquiry\n\nName: ${inquiry.name}\nEmail: ${inquiry.email}\nPhone: ${inquiry.phone || 'Not provided'}\nSpace: ${spaceName || 'Not specified'}\nDates: ${inquiry.start_date || 'Not specified'} to ${inquiry.end_date || 'Not specified'}\nRental unit: ${inquiry.rental_unit}\nMessage: ${inquiry.message || 'No message'}\n\nInquiry ID: ${inquiry.id}` });
  return true;
}
app.post('/api/inquiries', async (req,res) => {
  const p = req.body || {};
  if (!p.name?.trim() || !validEmail(p.email) || !p.message?.trim()) return res.status(400).json({ error: 'Enter your name, a valid email address, and a short message.' });
  if ((p.startDate && !validDate(p.startDate)) || (p.endDate && !validDate(p.endDate)) || (p.startDate && p.endDate && p.endDate < p.startDate)) return res.status(400).json({ error: 'Please check the requested date range.' });
  const space = p.spaceId ? db.prepare('SELECT * FROM spaces WHERE id=? AND active=1').get(Number(p.spaceId)) : null;
  if (p.spaceId && !space) return res.status(400).json({ error: 'Choose a valid space.' });
  const result = db.prepare('INSERT INTO inquiries (name,email,phone,space_id,start_date,end_date,rental_unit,message) VALUES (?,?,?,?,?,?,?,?)').run(p.name.trim(),p.email.trim(),(p.phone||'').trim(),space?.id || null,p.startDate || null,p.endDate || null,p.rentalUnit || 'day',p.message.trim());
  const inquiry = { id: Number(result.lastInsertRowid), name: p.name.trim(), email: p.email.trim(), phone: p.phone || '', start_date: p.startDate || '', end_date: p.endDate || '', rental_unit: p.rentalUnit || 'day', message: p.message.trim() };
  let emailSent = false;
  let emailStatus = 'not_configured';
  try { emailSent = await sendInquiryEmail(inquiry, space?.name || 'Not specified'); emailStatus = emailSent ? 'sent' : 'not_configured'; }
  catch (error) { emailStatus = 'failed'; console.error('Inquiry saved but email delivery failed:', error.message); }
  const message = emailStatus === 'sent' ? 'Inquiry sent. The TRACE team will follow up.' : emailStatus === 'failed' ? 'Inquiry saved, but email delivery failed. The administrator can review the saved inquiry and check SMTP settings.' : 'Inquiry saved. Email is not configured yet; the administrator can review it in the database/server log.';
  res.status(201).json({ message, id: inquiry.id, emailSent, emailStatus });
});
app.get('/api/inquiries', (_req,res) => {
  const rows = db.prepare(`SELECT i.*, s.name AS space_name FROM inquiries i LEFT JOIN spaces s ON s.id=i.space_id ORDER BY i.id DESC`).all();
  res.json(rows);
});
app.get('/api/dashboard', (_req,res) => {
  const today = new Date().toISOString().slice(0,10);
  const totalSpaces = db.prepare('SELECT COUNT(*) AS n FROM spaces WHERE active=1').get().n;
  const activeBookings = db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE status='confirmed'").get().n;
  const todayBookings = db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE status='confirmed' AND start_date<=? AND end_date>=?").get(today,today).n;
  const revenue = db.prepare("SELECT COALESCE(SUM(total),0) AS n FROM bookings WHERE status='confirmed'").get().n;
  const inquiries = db.prepare('SELECT COUNT(*) AS n FROM inquiries').get().n;
  const todayAvailable = db.prepare(`SELECT COUNT(*) AS n FROM spaces s WHERE active=1 AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.space_id=s.id AND b.status='confirmed' AND b.start_date<=? AND b.end_date>=?)`).get(today,today).n;
  res.json({ totalSpaces, activeBookings, todayBookings, revenue: Number(revenue), inquiries, todayAvailable, date: today });
});

app.use((err,_req,res,_next) => { console.error(err); res.status(500).json({ error: 'Unexpected server error.' }); });
app.listen(PORT, () => console.log(`TRACE Expert City API running at http://localhost:${PORT}`));
