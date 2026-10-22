import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, '../data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'trace-bookings.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin' CHECK(role IN ('admin','staff','viewer')),
  active INTEGER NOT NULL DEFAULT 1,
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login TEXT
);
CREATE TABLE IF NOT EXISTS spaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL CHECK(category IN ('meeting_room','auditorium','coworking_desk')),
  description TEXT NOT NULL DEFAULT '',
  capacity INTEGER NOT NULL DEFAULT 1,
  amenities TEXT NOT NULL DEFAULT '[]',
  rate REAL NOT NULL CHECK(rate >= 0),
  rate_unit TEXT NOT NULL CHECK(rate_unit IN ('hour','day','week','month')),
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  space_id INTEGER NOT NULL REFERENCES spaces(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  start_time TEXT,
  end_time TEXT,
  rental_unit TEXT NOT NULL CHECK(rental_unit IN ('hour','day','week','month')),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity > 0),
  rate REAL NOT NULL CHECK(rate >= 0),
  total REAL NOT NULL CHECK(total >= 0),
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed','cancelled')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_bookings_space_dates ON bookings(space_id, start_date, end_date, status);
CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings(customer_id);
CREATE TABLE IF NOT EXISTS inquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  space_id INTEGER REFERENCES spaces(id),
  start_date TEXT,
  end_date TEXT,
  rental_unit TEXT NOT NULL DEFAULT 'day',
  message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

const count = db.prepare('SELECT COUNT(*) AS count FROM spaces').get().count;
if (count === 0) {
  const insert = db.prepare('INSERT INTO spaces (name, category, description, capacity, amenities, rate, rate_unit) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const seed = db.transaction(() => {
    [
      ['Meeting Room A','meeting_room','A focused, well-equipped room for team meetings and workshops.',8,['Display screen','Whiteboard','Video conferencing','Air conditioning'],3500,'hour'],
      ['Meeting Room B','meeting_room','Flexible training and collaboration room.',14,['Projector','Whiteboard','Air conditioning','Wi-Fi'],5000,'hour'],
      ['Training Room C','meeting_room','Classroom-style room for training sessions.',24,['Projector','Training tables','Whiteboard','Wi-Fi'],7500,'hour'],
      ['TRACE Auditorium','auditorium','Large presentation venue for events and conferences.',250,['Stage','PA system','Projector','Microphones','Air conditioning'],85000,'day'],
      ['Co-working Desk 01','coworking_desk','Dedicated desk for focused individual work.',1,['Desk and chair','Wi-Fi','Power outlet'],2500,'day'],
      ['Co-working Desk 02','coworking_desk','Dedicated desk for focused individual work.',1,['Desk and chair','Wi-Fi','Power outlet'],2500,'day'],
      ['Co-working Desk 03','coworking_desk','Dedicated desk for focused individual work.',1,['Desk and chair','Wi-Fi','Power outlet'],2500,'day'],
      ['Co-working Desk 04','coworking_desk','Dedicated desk for focused individual work.',1,['Desk and chair','Wi-Fi','Power outlet'],2500,'day']
    ].forEach(s => insert.run(s[0],s[1],s[2],s[3],JSON.stringify(s[4]),s[5],s[6]));
  });
  seed();
}

export default db;

// Add one clearly fictional upcoming reservation on first launch for a useful dashboard demo.
const bookingCount = db.prepare('SELECT COUNT(*) AS count FROM bookings').get().count;
if (bookingCount === 0) {
  const space = db.prepare("SELECT id, rate FROM spaces WHERE name='Meeting Room A'").get();
  const start = new Date();
  start.setDate(start.getDate() + 3);
  const end = new Date(start);
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const customer = db.prepare('INSERT INTO customers (name,email,phone) VALUES (?,?,?)').run('Kavindi Fernando','kavindi.demo@example.com','+94 77 123 4567');
  const reference = 'TRC-DEMO01';
  db.prepare(`INSERT INTO bookings (reference,space_id,customer_id,start_date,end_date,start_time,end_time,rental_unit,quantity,rate,total,status,notes) VALUES (?,?,?,?,?,'09:00','11:00','hour',2,?,?, 'confirmed',?)`)
    .run(reference, space.id, customer.lastInsertRowid, fmt(start), fmt(start), Number(space.rate), Number(space.rate)*2, 'Sample booking for the hackathon demo.');
}

// Upgrade the built-in demo booking from older versions that did not save its time slot.
db.prepare("UPDATE bookings SET start_time='09:00', end_time='11:00' WHERE reference='TRC-DEMO01' AND rental_unit='hour' AND start_time IS NULL").run();
