// Transportation routes: manage transportation between consecutive cities in a trip

function registerTransportationRoutes(app, deps) {
  const { csrfProtection, getSession, run, get, all } = deps;

  // Upsert transportation from one city to the next within a trip
  app.put(
    "/api/trips/:tripId/cities/:fromCityId/transportation",
    csrfProtection,
    async (req, res) => {
      try {
        const s = await getSession(req);
        if (!s) return res.status(401).json({ error: "not authenticated" });

        const tripId = parseInt(req.params.tripId, 10);
        const fromCityId = parseInt(req.params.fromCityId, 10);
        const { toCityId, mode, notes } = req.body || {};

        if (!tripId || !Number.isInteger(tripId)) {
          return res.status(400).json({ error: "invalid trip id" });
        }
        if (!fromCityId || !Number.isInteger(fromCityId)) {
          return res.status(400).json({ error: "invalid from city id" });
        }
        const toId = parseInt(toCityId, 10);
        if (!toId || !Number.isInteger(toId)) {
          return res.status(400).json({ error: "invalid to city id" });
        }
        if (!mode || typeof mode !== "string") {
          return res.status(400).json({ error: "mode is required" });
        }

        const allowedModes = new Set([
          "flight",
          "car",
          "train",
          "public_transport",
          "motorbike",
          "boat",
          "bike",
          "walk",
        ]);
        if (!allowedModes.has(mode)) {
          return res.status(400).json({ error: "invalid mode" });
        }

        // Verify trip ownership
        const trip = await get(
          `SELECT id FROM trips WHERE id = ? AND user_id = ?`,
          [tripId, s.user.id],
        );
        if (!trip) {
          return res
            .status(404)
            .json({ error: "trip not found or unauthorized" });
        }

        // Verify cities belong to this trip and are consecutive
        const cities = await all(
          `SELECT id, sort_order FROM cities WHERE trip_id = ? ORDER BY sort_order ASC, id ASC`,
          [tripId],
        );
        const fromIdx = cities.findIndex((c) => c.id === fromCityId);
        if (fromIdx === -1) {
          return res.status(404).json({ error: "from city not found" });
        }
        const nextCity = cities[fromIdx + 1];
        if (!nextCity || nextCity.id !== toId) {
          return res.status(400).json({
            error:
              "transportation can only be set to the next city in the trip",
          });
        }

        const cleanNotes = typeof notes === "string" ? notes.trim() : null;

        // Upsert transportation row
        const existing = await get(
          `SELECT id FROM transportation WHERE trip_id = ? AND from_city_id = ? AND to_city_id = ?`,
          [tripId, fromCityId, toId],
        );

        if (existing) {
          await run(
            `UPDATE transportation SET mode = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [mode, cleanNotes, existing.id],
          );
        } else {
          await run(
            `INSERT INTO transportation(trip_id, from_city_id, to_city_id, mode, notes) VALUES (?,?,?,?,?)`,
            [tripId, fromCityId, toId, mode, cleanNotes],
          );
        }

        const saved = await get(
          `SELECT id, trip_id, from_city_id, to_city_id, mode, notes FROM transportation WHERE trip_id = ? AND from_city_id = ? AND to_city_id = ?`,
          [tripId, fromCityId, toId],
        );
        return res.json({ ok: true, transportation: saved });
      } catch (e) {
        console.error(e);
        return res.status(500).json({ error: "server error" });
      }
    },
  );

  // Delete transportation between fromCity and its next city
  app.delete(
    "/api/trips/:tripId/cities/:fromCityId/transportation",
    csrfProtection,
    async (req, res) => {
      try {
        const s = await getSession(req);
        if (!s) return res.status(401).json({ error: "not authenticated" });

        const tripId = parseInt(req.params.tripId, 10);
        const fromCityId = parseInt(req.params.fromCityId, 10);
        if (!tripId || !Number.isInteger(tripId)) {
          return res.status(400).json({ error: "invalid trip id" });
        }
        if (!fromCityId || !Number.isInteger(fromCityId)) {
          return res.status(400).json({ error: "invalid from city id" });
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

        // Determine next city to know which transportation row to delete
        const cities = await all(
          `SELECT id, sort_order FROM cities WHERE trip_id = ? ORDER BY sort_order ASC, id ASC`,
          [tripId],
        );
        const fromIdx = cities.findIndex((c) => c.id === fromCityId);
        if (fromIdx === -1) {
          return res.status(404).json({ error: "from city not found" });
        }
        const nextCity = cities[fromIdx + 1];
        if (!nextCity) {
          return res.status(400).json({ error: "no next city for this leg" });
        }

        await run(
          `DELETE FROM transportation WHERE trip_id = ? AND from_city_id = ? AND to_city_id = ?`,
          [tripId, fromCityId, nextCity.id],
        );
        return res.json({ ok: true });
      } catch (e) {
        console.error(e);
        return res.status(500).json({ error: "server error" });
      }
    },
  );
}

export default registerTransportationRoutes;
