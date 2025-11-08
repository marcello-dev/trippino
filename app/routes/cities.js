/**
 * City routes module
 * Handles city CRUD operations within trips
 */

function registerCityRoutes(app, deps) {
  const { csrfProtection, getSession, run, get } = deps;

  // Create a city in a trip (appended at the end)
  app.post("/api/trips/:id/cities", csrfProtection, async (req, res) => {
    console.log("Creating city with data:", req.body);
    try {
      const s = await getSession(req);
      if (!s) return res.status(401).json({ error: "not authenticated" });

      const tripId = parseInt(req.params.id, 10);
      if (!tripId || !Number.isInteger(tripId)) {
        return res.status(400).json({ error: "invalid trip id" });
      }

      // Verify the trip belongs to the current user
      const trip = await get(
        `SELECT id FROM trips WHERE id = ? AND user_id = ?`,
        [tripId, s.user.id],
      );
      if (!trip) {
        return res
          .status(404)
          .json({ error: "trip not found or unauthorized" });
      }

      const { name, nights, notes } = req.body || {};
      if (!name || !String(name).trim()) {
        return res.status(400).json({ error: "city name required" });
      }

      let n =
        typeof nights === "undefined" || nights === null ? 1 : Number(nights);
      if (!Number.isFinite(n) || n < 0) {
        return res
          .status(400)
          .json({ error: "nights must be a non-negative number" });
      }

      const result = await run(
        `INSERT INTO cities(name, nights, notes, trip_id) VALUES(?,?,?,?)`,
        [
          String(name).trim(),
          n,
          typeof notes === "string" && notes.trim() !== "" ? notes : null,
          tripId,
        ],
      );

      const city = await get(
        `SELECT id, name, nights, notes, sort_order, trip_id FROM cities WHERE id = ?`,
        [result.lastID],
      );
      // Return 201 Created status
      res.status(201);
      return res.json(city);
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "server error" });
    }
  });

  // Update a city name, notes, and days
  app.put(
    "/api/trips/:tripId/cities/:cityId",
    csrfProtection,
    async (req, res) => {
      try {
        const s = await getSession(req);
        if (!s) return res.status(401).json({ error: "not authenticated" });

        const tripId = parseInt(req.params.tripId, 10);
        if (!tripId || !Number.isInteger(tripId)) {
          return res.status(400).json({ error: "invalid trip id" });
        }

        // Verify the trip belongs to the current user
        const trip = await get(
          `SELECT id FROM trips WHERE id = ? AND user_id = ?`,
          [tripId, s.user.id],
        );
        if (!trip) {
          return res
            .status(404)
            .json({ error: "trip not found or unauthorized" });
        }

        const cityId = parseInt(req.params.cityId, 10);
        if (!cityId || !Number.isInteger(cityId)) {
          return res.status(400).json({ error: "invalid city id" });
        }

        // Verify the city belongs to the trip
        const city = await get(
          `SELECT id, name, nights, notes, sort_order, trip_id FROM cities WHERE id = ? AND trip_id = ?`,
          [cityId, tripId],
        );
        if (!city) {
          return res
            .status(404)
            .json({ error: "city not found or unauthorized" });
        }

        const { name, nights, notes } = req.body || {};
        const sets = [];
        const params = [];

        if (typeof name !== "undefined") {
          if (!name || !String(name).trim()) {
            return res.status(400).json({ error: "city name required" });
          }
          sets.push("name = ?");
          params.push(String(name).trim());
        }

        if (typeof nights !== "undefined") {
          let n = Number(nights);
          if (!Number.isFinite(n) || n < 0) {
            return res
              .status(400)
              .json({ error: "nights must be a non-negative number" });
          }
          sets.push("nights = ?");
          params.push(n);
        }

        if (typeof notes !== "undefined") {
          sets.push("notes = ?");
          params.push(
            typeof notes === "string" && notes.trim() !== "" ? notes : null,
          );
        }

        if (sets.length === 0) {
          return res.status(400).json({ error: "no fields to update" });
        }

        const sql = `UPDATE cities SET ${sets.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
        params.push(cityId);
        await run(sql, params);

        const updatedCity = await get(
          `SELECT id, name, nights, notes, sort_order, trip_id FROM cities WHERE id = ?`,
          [cityId],
        );

        return res.json({ ok: true, city: updatedCity });
      } catch (e) {
        console.error(e);
        return res.status(500).json({ error: "server error" });
      }
    },
  );

  // Update cities order in a trip. The sortOrder is provided in the body as an array of objects with city ID and sortOrder.
  app.put("/api/trips/:tripId/cities", csrfProtection, async (req, res) => {
    try {
      console.log("Reordering cities with data:", req.body);
      const s = await getSession(req);
      if (!s) return res.status(401).json({ error: "not authenticated" });

      const tripId = parseInt(req.params.tripId, 10);
      if (!tripId || !Number.isInteger(tripId)) {
        return res.status(400).json({ error: "invalid trip id" });
      }

      // Verify the trip belongs to the current user
      const trip = await get(
        `SELECT id FROM trips WHERE id = ? AND user_id = ?`,
        [tripId, s.user.id],
      );
      if (!trip) {
        return res
          .status(404)
          .json({ error: "trip not found or unauthorized" });
      }

      const sortOrder = req.body.sortOrder || [];
      if (!Array.isArray(sortOrder)) {
        return res.status(400).json({ error: "invalid sortOrder format" });
      }

      // Update each city's sort order
      for (const { id, index } of sortOrder) {
        const cityId = parseInt(id, 10);
        if (!cityId || !Number.isInteger(cityId)) {
          return res.status(400).json({ error: "invalid city id" });
        }

        // Verify the city belongs to the trip
        const city = await get(
          `SELECT id FROM cities WHERE id = ? AND trip_id = ?`,
          [cityId, tripId],
        );
        if (!city) {
          return res
            .status(404)
            .json({ error: "city not found or unauthorized" });
        }

        await run(`UPDATE cities SET sort_order = ? WHERE id = ?`, [
          index,
          cityId,
        ]);
      }

      return res.json({ ok: true });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "server error" });
    }
  });

  // Delete a city in a trip
  app.delete(
    "/api/trips/:id/cities/:cityId",
    csrfProtection,
    async (req, res) => {
      try {
        const s = await getSession(req);
        if (!s) return res.status(401).json({ error: "not authenticated" });

        const tripId = parseInt(req.params.id, 10);
        if (!tripId || !Number.isInteger(tripId)) {
          return res.status(400).json({ error: "invalid trip id" });
        }

        // Verify the trip belongs to the current user
        const trip = await get(
          `SELECT id FROM trips WHERE id = ? AND user_id = ?`,
          [tripId, s.user.id],
        );
        if (!trip) {
          return res
            .status(404)
            .json({ error: "trip not found or unauthorized" });
        }

        const cityId = parseInt(req.params.cityId, 10);
        if (!cityId || !Number.isInteger(cityId)) {
          return res.status(400).json({ error: "invalid city id" });
        }

        // Verify the city belongs to the trip
        const city = await get(
          `SELECT id, name, nights, notes, sort_order, trip_id FROM cities WHERE id = ? AND trip_id = ?`,
          [cityId, tripId],
        );
        if (!city) {
          return res
            .status(404)
            .json({ error: "city not found or unauthorized" });
        }

        await run(`DELETE FROM cities WHERE id = ?`, [cityId]);

        return res.json({ ok: true });
      } catch (e) {
        console.error(e);
        return res.status(500).json({ error: "server error" });
      }
    },
  );
}

export default { registerCityRoutes };
