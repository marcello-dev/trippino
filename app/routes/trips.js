// Trip routes module
// Exports a function that registers trip endpoints on the provided app

function registerTripRoutes(app, deps) {
  const { csrfProtection, getSession, run, get } = deps;

  // Create a new trip
  app.post("/api/trips", csrfProtection, async (req, res) => {
    try {
      const s = await getSession(req);
      if (!s) return res.status(401).json({ error: "not authenticated" });

      const { name, start_date } = req.body || {};
      if (!name || !String(name).trim()) {
        return res.status(400).json({ error: "trip name required" });
      }

      if (start_date && !/^\d{4}-\d{2}-\d{2}$/.test(start_date)) {
        return res
          .status(400)
          .json({ error: "start_date must be in YYYY-MM-DD format" });
      }

      const result = await run(
        `INSERT INTO trips(name, start_date, user_id) VALUES(?,?,?)`,
        [String(name).trim(), start_date || null, s.user.id],
      );

      return res.json({ ok: true, id: result.lastID });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "server error" });
    }
  });

  // Update a trip's name and/or start_date
  app.put("/api/trips/:id", csrfProtection, async (req, res) => {
    try {
      const s = await getSession(req);
      if (!s) return res.status(401).json({ error: "not authenticated" });

      const tripId = parseInt(req.params.id, 10);
      if (!tripId || !Number.isInteger(tripId)) {
        return res.status(400).json({ error: "invalid trip id" });
      }

      const { name, start_date } = req.body || {};
      const hasName = typeof name !== "undefined";
      const hasStart = typeof start_date !== "undefined";
      if (!hasName && !hasStart) {
        return res.status(400).json({ error: "no fields to update" });
      }

      // Verify ownership
      const trip = await get(
        `SELECT id, name, start_date FROM trips WHERE id = ? AND user_id = ?`,
        [tripId, s.user.id],
      );
      if (!trip) {
        return res
          .status(404)
          .json({ error: "trip not found or unauthorized" });
      }

      const sets = [];
      const params = [];

      if (hasName) {
        if (!name || !String(name).trim()) {
          return res.status(400).json({ error: "trip name required" });
        }
        sets.push("name = ?");
        params.push(String(name).trim());
      }

      if (hasStart) {
        let sd = start_date;
        if (sd === "") sd = null;
        if (sd && !/^\d{4}-\d{2}-\d{2}$/.test(sd)) {
          return res
            .status(400)
            .json({ error: "start_date must be in YYYY-MM-DD format" });
        }
        sets.push("start_date = ?");
        params.push(sd || null);
      }

      const sql = `UPDATE trips SET ${sets.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
      params.push(tripId);
      await run(sql, params);

      const updated = await get(
        `SELECT id, name, start_date FROM trips WHERE id = ? AND user_id = ?`,
        [tripId, s.user.id],
      );
      return res.json({ ok: true, trip: updated });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "server error" });
    }
  });

  // Delete a trip (CASCADE will automatically delete all cities)
  app.delete("/api/trips/:id", csrfProtection, async (req, res) => {
    try {
      const s = await getSession(req);
      if (!s) return res.status(401).json({ error: "not authenticated" });

      const tripId = parseInt(req.params.id, 10);
      if (!tripId || !Number.isInteger(tripId)) {
        return res.status(400).json({ error: "invalid trip id" });
      }

      const trip = await get(
        `SELECT id FROM trips WHERE id = ? AND user_id = ?`,
        [tripId, s.user.id],
      );
      if (!trip) {
        return res
          .status(404)
          .json({ error: "trip not found or unauthorized" });
      }

      await run(`DELETE FROM trips WHERE id = ?`, [tripId]);
      return res.json({ ok: true });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "server error" });
    }
  });
};

export default { registerTripRoutes };