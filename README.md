# Trippino

Trippino is a website for planning simple trips. Check it out here: https://trippino.apivenue.com

It is built as a small single-node Express + SQLite demo app. It serves a static frontend from `app/public` and provides a small JSON API and authentication in `app/app.js`.

## Quick start (development)

1. Clone the repository and open a terminal in the project root.

2. Install dependencies for the server (app):

```bash
cd app
npm install
```

3. Copy the example env and edit SMTP settings if you want to test email verification. You can use Mailtrap, Ethereal, or another test SMTP provider.

```bash
cp .env.example .env
# Edit .env to set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM
# PORT can be set here (default in example is 5000)
```

4. Start the server:

```bash
# from /app
node app.js
```

5. Open the app in your browser: http://localhost:5000/ (or the port you set in `.env`).
