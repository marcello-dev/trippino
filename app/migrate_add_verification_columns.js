// Migration: add verification columns to users table if missing
const sqlite3 = require('sqlite3')
const path = require('path')
const fs = require('fs')

const DB = process.env.DATABASE_URL || path.join(__dirname, 'data.sqlite')
if (!fs.existsSync(DB)) {
  console.error(`Database file not found: ${DB}`)
  process.exit(1)
}

const db = new sqlite3.Database(DB)

function pragmaTableInfo(table) {
  return new Promise((resolve, reject) => {
    db.all(`PRAGMA table_info(${table})`, (err, rows) => {
      if (err) return reject(err)
      resolve(rows || [])
    })
  })
}

function runSql(sql) {
  return new Promise((resolve, reject) => {
    db.run(sql, function (err) {
      if (err) return reject(err)
      resolve(this)
    })
  })
}

async function migrate() {
  try {
    const info = await pragmaTableInfo('users')
    if (!info || !info.length) {
      console.error('No users table found or table has no columns.');
      console.error('If your app created the table with the old schema, restart the app once to let it create the base table, then re-run this migration.');
      process.exit(1)
    }

    const cols = info.map(r => r.name)
    const toAdd = []
    if (!cols.includes('verified')) toAdd.push("ALTER TABLE users ADD COLUMN verified INTEGER DEFAULT 0")
    if (!cols.includes('verification_token')) toAdd.push("ALTER TABLE users ADD COLUMN verification_token TEXT")
    if (!cols.includes('verification_expires')) toAdd.push("ALTER TABLE users ADD COLUMN verification_expires INTEGER")

    if (!toAdd.length) {
      console.log('No migration needed: all verification columns already present.')
      db.close()
      process.exit(0)
    }

    for (const sql of toAdd) {
      console.log('Running:', sql)
      await runSql(sql)
    }

    console.log('Migration completed successfully.')
    db.close()
    process.exit(0)
  } catch (err) {
    console.error('Migration failed:', err)
    db.close()
    process.exit(1)
  }
}

migrate()
