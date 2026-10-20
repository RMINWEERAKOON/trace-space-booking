# TRACE Expert City — Space Rental Booking System

A runnable full-stack hackathon application to replace the Excel-based space rental workflow. Built with React + Vite, Express, and SQLite.

## Features

- Admin dashboard with space inventory, confirmed booking totals, availability today, and booking revenue.
- Space directory with capacity, amenities, and rates for meeting/training rooms, an auditorium, and co-working desks.
- Date-range availability search.
- **Interactive monthly availability calendar** available from each space card: green dates are open, red dates have confirmed bookings, and past dates are grey. Calendar data is loaded from the database and updates when bookings are changed.
- Booking creation with customer contact details, rate calculation, and booking references.
- **Server-side overlap prevention** using an SQLite `BEGIN IMMEDIATE` transaction. Conflicting bookings for the same space are rejected with HTTP `409`, including concurrent requests.
- Booking list with search, status filter, details, cancellation, and CSV export.
- Public-style inquiry form and inquiry list. Inquiry records are saved even if SMTP has not been configured.
- Optional administrator email notification using SMTP environment variables.
- SQLite database and demo data are created automatically on first run.

## Requirements

- Node.js 20 or newer recommended (Node.js 18+ should work)
- npm

## Run locally

From the project root:

```bash
npm install
cp server/.env.example server/.env
npm run dev
```

On Windows PowerShell, use this for the environment file instead of `cp`:

```powershell
Copy-Item server/.env.example server/.env
```

Open **http://localhost:5173**. The API runs at **http://localhost:4000**.

If your local port 4000 is already in use, set `PORT` in `server/.env`. If you change the API port, also create `client/.env` with `VITE_API_URL=http://localhost:YOUR_PORT/api` and restart Vite.

## Email configuration

Inquiry submission works without SMTP,  and the inquiry is persisted in SQLite. To send actual email, edit `server/.env`:

```dotenv
ADMIN_EMAIL=your-admin@example.com
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password
SMTP_FROM=TRACE Expert City Bookings <bookings@example.com>
```

Use SMTP credentials from your email provider. Do not commit `server/.env` or expose credentials in frontend code. Restart the API after editing it. If SMTP is absent, the API logs a message indicating that delivery was not attempted; the UI does not claim that an email was sent.

## Production build

```bash
npm run build
npm start
```

The production command starts the API only. To serve the built frontend in production, deploy `client/dist` to a static host and set `VITE_API_URL` to your deployed API URL before building. Configure CORS, HTTPS, backups, and authentication before real use.

## Demo workflow (2–3 minutes)

1. Open Overview and point out the seeded spaces, one fictional upcoming sample booking, and dashboard summary.
2. Open Spaces and show room, auditorium, and co-working desk rates and amenities.
3. Open Availability, choose a date range, and check the available spaces. Click **Calendar** on any space card to view its month-by-month green (available) and red (booked) dates.
4. Click New booking, create a booking for a meeting room, and note the generated `TRC-...` reference and total.
5. Try creating a second booking for the same space with overlapping dates. The API rejects it with a conflict message; the first booking remains unchanged.
6. Open Bookings, search by customer or reference, open the booking details, then optionally cancel it and return to Availability.
7. Open Inquiries and submit a request. Without SMTP, it is saved and the UI explicitly says email delivery is not configured. With SMTP configured, an email is sent to `ADMIN_EMAIL`.

## API endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | API health check |
| GET | `/api/dashboard` | Dashboard metrics |
| GET | `/api/spaces` | Active spaces and rates |
| GET | `/api/spaces/:id/calendar?month=YYYY-MM` | Confirmed booking date ranges for one space and month |
| GET | `/api/availability?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&category=all` | Availability search |
| GET | `/api/bookings` | Booking list (`search`, `status`, `from`, `to` query parameters supported) |
| GET | `/api/bookings/:id` | Booking details |
| POST | `/api/bookings` | Create booking; rejects conflicts |
| PATCH | `/api/bookings/:id/cancel` | Cancel a confirmed booking |
| GET | `/api/inquiries` | Inquiry list |
| POST | `/api/inquiries` | Save an inquiry and attempt admin email |

### Example booking payload

```json
{
  "spaceId": 1,
  "customerName": "Amal Perera",
  "customerEmail": "amal@example.com",
  "customerPhone": "+94 77 000 0000",
  "startDate": "2026-11-02",
  "endDate": "2026-11-02",
  "rentalUnit": "hour",
  "quantity": 2,
  "notes": "Project planning meeting"
}
```

Meeting/training rooms support hourly and daily pricing (daily rate = 8 × hourly rate); auditorium bookings are daily; co-working desks support day, week, or month blocks. Date ranges are inclusive. Weekly desk rentals use 7-day blocks and monthly rentals use 30-day blocks.

## Data and reset

The database file is created at `server/data/trace-bookings.sqlite` on first launch. It is ignored by Git. When upgrading from an older extracted project folder, stop the server and copy your existing `server/data/trace-bookings.sqlite` into the new project’s `server/data/` folder to retain your existing bookings. Do not overwrite the database if you need its records. To reset the demo, stop the server and delete this file; it will be recreated with sample spaces and a fictional sample booking at next startup.

## Hackathon scope and production note

The public visitor workflow is request-to-book, not direct booking. The admin dashboard is intentionally open for a local hackathon demo and **does not implement authentication/authorization**. Before production use, add admin login and role checks, CSRF/rate-limit protections as appropriate, stronger audit logging, database backups, and privacy/security review. Seeded names and contact details are fictional.
