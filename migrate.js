#!/usr/bin/env node

import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readdir } from "fs/promises";
import sqlite3 from "sqlite3";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATABASE_URL =
  process.env.DATABASE_URL || path.join(__dirname, "app", "data.sqlite");
const MIGRATIONS_DIR = path.join(__dirname, "migrations");

// Initialize migration tracking table
function initMigrationTable(db) {
  return new Promise((resolve, reject) => {
    db.run(
      `CREATE TABLE IF NOT EXISTS __migrations (
      id TEXT PRIMARY KEY,
      executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
      (err) => {
        if (err) reject(err);
        else resolve();
      },
    );
  });
}

// Get executed migrations
function getExecutedMigrations(db) {
  return new Promise((resolve, reject) => {
    db.all("SELECT id FROM __migrations ORDER BY id", (err, rows) => {
      if (err) reject(err);
      else resolve(rows.map((row) => row.id));
    });
  });
}

// Mark migration as executed
function markMigrationExecuted(db, migrationId) {
  return new Promise((resolve, reject) => {
    db.run("INSERT INTO __migrations (id) VALUES (?)", [migrationId], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// Execute SQL statements
function executeSql(db, sql) {
  return new Promise((resolve, reject) => {
    db.exec(sql, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function runMigrations() {
  const db = new sqlite3.Database(DATABASE_URL);

  try {
    // Initialize migration tracking
    await initMigrationTable(db);

    // Get list of migration files
    const files = await readdir(MIGRATIONS_DIR);
    const migrationFiles = files.filter((file) => file.endsWith(".sql")).sort();

    // Get already executed migrations
    const executedMigrations = await getExecutedMigrations(db);

    // Find pending migrations
    const pendingMigrations = migrationFiles.filter((file) => {
      const migrationId = file.replace(".sql", "");
      return !executedMigrations.includes(migrationId);
    });

    if (pendingMigrations.length === 0) {
      console.log("No pending migrations found.");
      return;
    }

    console.log(`Found ${pendingMigrations.length} pending migration(s):`);
    pendingMigrations.forEach((migration) => console.log(`  - ${migration}`));
    console.log("");

    // Execute pending migrations
    for (const migrationFile of pendingMigrations) {
      const migrationId = migrationFile.replace(".sql", "");
      const migrationPath = path.join(MIGRATIONS_DIR, migrationFile);

      try {
        const { readFile } = await import("fs/promises");
        const sql = await readFile(migrationPath, "utf8");

        console.log(`Executing migration: ${migrationFile}`);
        await executeSql(db, sql);
        await markMigrationExecuted(db, migrationId);
        console.log(`✓ Migration ${migrationFile} completed successfully`);
      } catch (error) {
        console.error(`✗ Migration ${migrationFile} failed:`, error.message);
        throw error;
      }
    }

    console.log("\nAll migrations completed successfully!");
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  } finally {
    db.close();
  }
}

// Run migrations if this script is called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations();
}

export { runMigrations };
