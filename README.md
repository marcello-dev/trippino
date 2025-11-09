# Trippino

[![CI/CD](https://github.com/marcello-dev/trippino/actions/workflows/ci.yml/badge.svg)](https://github.com/marcello-dev/trippino/actions/workflows/ci.yml)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/marcello-dev/trippino/pulls)

Trippino is a website for planning simple trips. Check it out here: https://trippino.apivenue.com

It is built as a small single-node Express + SQLite demo app. It serves a static frontend from `app/public` and provides JSON APIs in `app/app.js`.

## State management

As we don't always have internet connection when travelling, Trippino tries to to work offline as much as it can.

The table below summarizes how the state (trips, cities, etc.) is managed.

|                               | Online                                                           | Offline                                                          |
| ----------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| Anonymous user (unregistered) | State saved to local storage only                                | State saved to local storage only                                |
| First login user              | Local state is saved to remote database                          | N/A                                                              |
| Logged in user                | Local and remote state in sync                                   | Read-only                                                        |
| Logged out user               | Local storage only, state is replaced with remote state on login | Local storage only, state is replaced with remote state on login |

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
