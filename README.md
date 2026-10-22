# TRACE Expert City: Space Booking System

A full-stack space rental and booking application built with React, Vite, Express, and SQLite. The existing TRACE Expert City dashboard design is retained, with improved booking validation and protected staff access.

## What's included

- Existing dashboard, space directory, availability page, monthly calendar, booking list, inquiry management, and public inquiry form.
- Secure administrator sign-in. Passwords are stored as salted scrypt hashes, not plain text.
- Signed bearer sessions that expire after 8 hours, protected management endpoints, sign-out, and password changes.
- Login attempt throttling and public inquiry rate limiting.
- Date validation that rejects impossible calendar dates such as February 31.
- Hourly room reservations with start/end times and interval-aware conflict checks. Two bookings may use the same room on the same day if their time slots do not overlap.
- Whole-day bookings still conflict with all reservations on overlapping dates. Legacy hourly records without time slots are treated conservatively as occupying the full date.
- Correct daily, weekly, and monthly rate summaries. Weekly desk rentals use 7-day blocks and monthly rentals use 30-day blocks.
- Atomic SQLite transactions to prevent concurrent requests from double-booking the same slot.
- Parameterized SQL queries, server-side price calculation, strict input validation, and baseline security headers.
- Public inquiry submissions, optional SMTP email notifications, CSV exports, and persistent SQLite data.

## Requirements

- Node.js 20 or newer recommended (Node.js 18+ should work)
- npm

## Run locally

Open a terminal in the project root and run:

```bash
npm install
```

Copy the environment example file:

**Windows PowerShell**

```powershell
Copy-Item server/.env.example server/.env
```

**macOS / Linux**

```bash
cp server/.env.example server/.env
```

Start the application:

```bash
npm run dev
```

Open the staff workspace at **http://localhost:5173**. The API runs at **http://localhost:4000**. The public inquiry page is available at **http://localhost:5173/inquiry**.

### First administrator login

The application creates one administrator account on the first API start.

- Username: `admin` unless you change `ADMIN_USERNAME` in `server/.env` before the first start.
- Password: if `ADMIN_PASSWORD` is blank, the API generates a strong random password and prints it in the server terminal. It also saves a local copy to `server/data/initial-admin-credentials.txt` with restricted file permissions where supported.
- Sign in with those credentials, open **Settings & setup**, and change the password. Delete `server/data/initial-admin-credentials.txt` after you have stored the new password safely.

To choose your own password from the start, set `ADMIN_PASSWORD` in `server/.env` before the first server start. Use at least 12 characters. Existing user records are not overwritten if you change the environment variables after the administrator has already been created.

### Persistent sessions

Set `TOKEN_SECRET` in `server/.env` to a long random secret of at least 32 characters. If it is blank, the API creates a temporary in-memory secret. Sessions will be invalidated whenever the API restarts, but users can sign in again. A token expires after 8 hours. Sign-out invalidates existing tokens for the administrator account.

Example secret generation:

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Copy the generated value into `TOKEN_SECRET`. Do not commit `server/.env` or share the initial admin credentials file.

## Email configuration (optional)

Booking confirmation emails are sent to the customer after a booking is successfully saved. Inquiry notifications are sent to the configured administrator. Both features require SMTP. Bookings and inquiries are still saved if SMTP is not configured or an email delivery attempt fails. The API response and dashboard notification report whether the customer email was sent. Configure the following in `server/.env`:
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

Restart the API after editing the environment file. `SMTP_FROM` should be an address or sender name that your SMTP provider permits. `ADMIN_EMAIL` is used as the reply-to address for customer booking confirmations and as the recipient for new inquiry notifications. If SMTP is not configured or delivery fails, the booking remains saved and the dashboard reports the email status.

## Build and run

Create a production frontend build:

```bash
npm run build
```

Start the API:

```bash
npm start
```

The `npm start` command runs the API. For a production deployment, host `client/dist` on a static web server and set `VITE_API_URL` before building to the public API URL ending in `/api`. Set `CLIENT_ORIGIN` to the exact frontend origin, use HTTPS, configure a persistent `TOKEN_SECRET`, back up the SQLite database, and review the hosting provider's security settings.

## Booking rules

- Meeting and training rooms support hourly bookings and daily bookings. A daily rate is 8 times the hourly rate.
- Hourly bookings require one date, start time, end time, and a whole-hour duration between 1 and 12 hours.
- An hourly booking conflicts with another hourly booking only when their time intervals overlap. For example, 09:00-11:00 and 11:00-13:00 may share the same date, but 10:00-12:00 conflicts with 09:00-11:00.
- Daily and longer bookings conflict with every confirmed reservation on the same space for the overlapping dates, including hourly reservations.
- The auditorium is booked by the day.
- Co-working desks can be booked by day, week, or month. Weekly blocks contain 7 days; monthly blocks contain 30 days. The date range includes both the start and end dates.
- The availability search is a conservative date-range search. A date with an hourly reservation may still have other available time slots. The booking form and API validate the exact hourly slot when a booking is saved.
- Final prices are calculated and validated on the server. The browser's estimate is only a preview.

## API endpoints

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| GET | `/api/health` | Public | API health check |
| POST | `/api/auth/login` | Public, rate limited | Sign in and receive a session token |
| GET | `/api/auth/me` | Signed in | Current account details |
| POST | `/api/auth/logout` | Signed in | Invalidate current account sessions |
| POST | `/api/auth/change-password` | Admin | Change the administrator password |
| GET | `/api/spaces` | Public | Active spaces for the visitor inquiry form |
| GET | `/api/spaces/:id/calendar?month=YYYY-MM` | Signed in | Confirmed bookings for a space and month |
| GET | `/api/availability?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&category=all&rentalUnit=day` | Signed in | Date-range availability search; use `rentalUnit=hour&startTime=09:00&endTime=11:00` for exact hourly slots |
| GET | `/api/bookings` | Signed in | Booking list, with search/status/date filters |
| GET | `/api/bookings/:id` | Signed in | Booking details |
| POST | `/api/bookings` | Signed in | Create a booking, reject conflicts, and email the customer confirmation when SMTP is configured |
| PATCH | `/api/bookings/:id/cancel` | Signed in | Cancel a confirmed booking |
| GET | `/api/inquiries` | Signed in | View visitor inquiries |
| POST | `/api/inquiries` | Public, rate limited | Save an inquiry and optionally email the administrator |
| GET | `/api/dashboard` | Signed in | Dashboard metrics |

### Example hourly booking payload

```json
{
  "spaceId": 1,
  "customerName": "Amal Perera",
  "customerEmail": "amal@example.com",
  "customerPhone": "+94 77 000 0000",
  "startDate": "2026-11-02",
  "endDate": "2026-11-02",
  "startTime": "09:00",
  "endTime": "11:00",
  "rentalUnit": "hour",
  "quantity": 2,
  "notes": "Project planning meeting"
}
```

The protected booking API requires `Authorization: Bearer <token>` on staff endpoints. The login route returns the token and current user details.

## Database and existing data

The SQLite database is created at `server/data/trace-bookings.sqlite` on first run. The application creates the authentication table automatically. If you have an existing database, stop the server and copy your original database into the new project's `server/data/` directory before starting. The schema changes are additive, and the migration updates only the built-in `TRC-DEMO01` sample booking if its old version has no time slot. Do not delete your existing database if it contains bookings you need.

To reset the local demo, stop the server and delete `server/data/trace-bookings.sqlite`. On the next start, the spaces and a fictional sample booking are recreated. Resetting the database also removes the local user account, so a new administrator password will be generated unless `ADMIN_PASSWORD` is set.

## Notes before production

This project is ready for local development and functional testing. A real public deployment still needs HTTPS, a persistent secret, production SMTP credentials, database backups, access-control policy for additional staff accounts, audit logging, and a privacy/security review. The first version creates a single administrator account; it does not include a user-management screen for adding staff accounts.
