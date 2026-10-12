/**
 * Database layer tests: connection setup and transactions
 */

import { openDatabase, initSchema } from "../app/db.js";
import { runMigrations } from "../migrate.js";

describe("Database", () => {
  let database;

  beforeEach(async () => {
    database = openDatabase(":memory:");
    await initSchema(database.run);
    await runMigrations(database.db);
  });

  afterEach(async () => {
    await database.close();
  });

  it("should enforce foreign keys", async () => {
    const row = await database.get("PRAGMA foreign_keys");
    expect(row.foreign_keys).toBe(1);

    await expect(
      database.run(`INSERT INTO trips (name, user_id) VALUES (?, ?)`, [
        "Orphan",
        999,
      ]),
    ).rejects.toThrow(/FOREIGN KEY/);
  });

  it("should commit a successful transaction", async () => {
    const result = await database.transaction(async () => {
      await database.run(`INSERT INTO users (email) VALUES (?)`, ["a@x.com"]);
      return "done";
    });

    expect(result).toBe("done");
    expect(await database.all(`SELECT * FROM users`)).toHaveLength(1);
  });

  it("should roll back a failed transaction", async () => {
    await expect(
      database.transaction(async () => {
        await database.run(`INSERT INTO users (email) VALUES (?)`, ["a@x.com"]);
        await database.run(`INSERT INTO users (email) VALUES (?)`, ["a@x.com"]);
      }),
    ).rejects.toThrow(/UNIQUE/);

    expect(await database.all(`SELECT * FROM users`)).toHaveLength(0);
  });

  it("should run concurrent transactions one after another", async () => {
    const insert = (email) =>
      database.transaction(() =>
        database.run(`INSERT INTO users (email) VALUES (?)`, [email]),
      );

    await Promise.all([
      insert("a@x.com"),
      insert("b@x.com"),
      insert("c@x.com"),
    ]);

    expect(await database.all(`SELECT * FROM users`)).toHaveLength(3);
  });

  it("should keep working after a rolled back transaction", async () => {
    await database
      .transaction(async () => {
        throw new Error("boom");
      })
      .catch(() => {});

    await database.transaction(() =>
      database.run(`INSERT INTO users (email) VALUES (?)`, ["a@x.com"]),
    );
    expect(await database.all(`SELECT * FROM users`)).toHaveLength(1);
  });
});
