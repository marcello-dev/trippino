/**
 * City API Tests
 * Tests for city CRUD operations and sort order management
 */

import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import {
  createTestDatabase,
  initTestDatabase,
  createTestUser,
  createTestSession,
  createTestTrip,
  createTestCity,
  cleanupDatabase
} from './helpers.js';

let app;
let db;
let run, get, all;

describe('City API', () => {
  beforeEach(async () => {
    const testDb = createTestDatabase();
    db = testDb.db;
    run = testDb.run;
    get = testDb.get;
    all = testDb.all;
    
    await initTestDatabase(run);
    
    app = express();
    app.use(express.json());
    app.use(cookieParser());
    
    const COOKIE_NAME = 'trippino_sid';
    
    async function getSession(req) {
      const sid = req.cookies[COOKIE_NAME];
      if (!sid) return null;
      
      const session = await get(`SELECT * FROM sessions WHERE sid = ?`, [sid]);
      if (!session) return null;
      
      const user = await get(
        `SELECT id, email, verified FROM users WHERE id = ?`,
        [session.user_id]
      );
      
      return user || null;
    }
    
    async function verifyTripOwnership(tripId, userId) {
      const trip = await get(
        `SELECT * FROM trips WHERE id = ? AND user_id = ?`,
        [tripId, userId]
      );
      return !!trip;
    }
    
    // POST /api/trips/:id/cities - Create city
    app.post('/api/trips/:id/cities', async (req, res) => {
      try {
        const user = await getSession(req);
        if (!user) {
          return res.status(401).json({ error: 'Not authenticated' });
        }
        
        const isOwner = await verifyTripOwnership(req.params.id, user.id);
        if (!isOwner) {
          return res.status(404).json({ error: 'Trip not found' });
        }
        
        const { name, nights, notes } = req.body;
        
        if (!name || nights === undefined) {
          return res.status(400).json({ error: 'Name and nights required' });
        }
        
        if (nights < 1) {
          return res.status(400).json({ error: 'Nights must be at least 1' });
        }
        
        // Get max sort_order
        const maxSortOrder = await get(
          `SELECT MAX(sort_order) as max FROM cities WHERE trip_id = ?`,
          [req.params.id]
        );
        
        const sortOrder = (maxSortOrder.max ?? -1) + 1;
        
        const result = await run(
          `INSERT INTO cities (name, nights, notes, sort_order, trip_id) 
           VALUES (?, ?, ?, ?, ?)`,
          [name, nights, notes || '', sortOrder, req.params.id]
        );
        
        res.json({ ok: true, id: result.lastID, sort_order: sortOrder });
      } catch (error) {
        res.status(500).json({ error: 'Server error' });
      }
    });
    
    // PUT /api/trips/:tripId/cities/:cityId - Update city
    app.put('/api/trips/:tripId/cities/:cityId', async (req, res) => {
      try {
        const user = await getSession(req);
        if (!user) {
          return res.status(401).json({ error: 'Not authenticated' });
        }
        
        const isOwner = await verifyTripOwnership(req.params.tripId, user.id);
        if (!isOwner) {
          return res.status(404).json({ error: 'Trip not found' });
        }
        
        const city = await get(
          `SELECT * FROM cities WHERE id = ? AND trip_id = ?`,
          [req.params.cityId, req.params.tripId]
        );
        
        if (!city) {
          return res.status(404).json({ error: 'City not found' });
        }
        
        const { name, nights, notes } = req.body;
        
        if (!name && nights === undefined && notes === undefined) {
          return res.status(400).json({ error: 'Nothing to update' });
        }
        
        if (nights !== undefined && nights < 1) {
          return res.status(400).json({ error: 'Nights must be at least 1' });
        }
        
        const updates = [];
        const params = [];
        
        if (name !== undefined) {
          updates.push('name = ?');
          params.push(name);
        }
        
        if (nights !== undefined) {
          updates.push('nights = ?');
          params.push(nights);
        }
        
        if (notes !== undefined) {
          updates.push('notes = ?');
          params.push(notes);
        }
        
        updates.push('updated_at = CURRENT_TIMESTAMP');
        params.push(req.params.cityId);
        
        await run(
          `UPDATE cities SET ${updates.join(', ')} WHERE id = ?`,
          params
        );
        
        res.json({ ok: true });
      } catch (error) {
        res.status(500).json({ error: 'Server error' });
      }
    });
    
    // PUT /api/trips/:tripId/cities - Batch update sort order
    app.put('/api/trips/:tripId/cities', async (req, res) => {
      try {
        const user = await getSession(req);
        if (!user) {
          return res.status(401).json({ error: 'Not authenticated' });
        }
        
        const isOwner = await verifyTripOwnership(req.params.tripId, user.id);
        if (!isOwner) {
          return res.status(404).json({ error: 'Trip not found' });
        }
        
        const { sortOrder } = req.body;
        
        if (!Array.isArray(sortOrder) || sortOrder.length === 0) {
          return res.status(400).json({ error: 'Invalid sortOrder array' });
        }
        
        // Verify all cities belong to this trip
        const cityIds = sortOrder.map(so => so.id);
        const cities = await all(
          `SELECT id FROM cities WHERE id IN (${cityIds.map(() => '?').join(',')}) AND trip_id = ?`,
          [...cityIds, req.params.tripId]
        );
        
        if (cities.length !== cityIds.length) {
          return res.status(400).json({ error: 'Invalid city IDs' });
        }
        
        // Update sort orders
        for (let i = 0; i < sortOrder.length; i++) {
          await run(
            `UPDATE cities SET sort_order = ? WHERE id = ?`,
            [i, sortOrder[i].id]
          );
        }
        
        res.json({ ok: true });
      } catch (error) {
        res.status(500).json({ error: 'Server error' });
      }
    });
    
    // DELETE /api/trips/:id/cities/:cityId - Delete city
    app.delete('/api/trips/:id/cities/:cityId', async (req, res) => {
      try {
        const user = await getSession(req);
        if (!user) {
          return res.status(401).json({ error: 'Not authenticated' });
        }
        
        const isOwner = await verifyTripOwnership(req.params.id, user.id);
        if (!isOwner) {
          return res.status(404).json({ error: 'Trip not found' });
        }
        
        const city = await get(
          `SELECT * FROM cities WHERE id = ? AND trip_id = ?`,
          [req.params.cityId, req.params.id]
        );
        
        if (!city) {
          return res.status(404).json({ error: 'City not found' });
        }
        
        await run(
          `DELETE FROM cities WHERE id = ?`,
          [req.params.cityId]
        );
        
        res.json({ ok: true });
      } catch (error) {
        res.status(500).json({ error: 'Server error' });
      }
    });
  });
  
  afterEach(async () => {
    await cleanupDatabase(db);
  });
  
  describe('POST /api/trips/:id/cities', () => {
    it('should create a city with auto sort order', async () => {
      const user = await createTestUser(run);
      const sid = await createTestSession(run, user.id);
      const trip = await createTestTrip(run, user.id);
      
      const response = await request(app)
        .post(`/api/trips/${trip.id}/cities`)
        .set('Cookie', `trippino_sid=${sid}`)
        .send({
          name: 'Paris',
          nights: 3,
          notes: 'Visit Eiffel Tower'
        });
      
      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
      expect(response.body.id).toBeDefined();
      expect(response.body.sort_order).toBe(0);
      
      const city = await get(`SELECT * FROM cities WHERE id = ?`, [response.body.id]);
      expect(city.name).toBe('Paris');
      expect(city.nights).toBe(3);
      expect(city.sort_order).toBe(0);
    });
    
    it('should increment sort order for multiple cities', async () => {
      const user = await createTestUser(run);
      const sid = await createTestSession(run, user.id);
      const trip = await createTestTrip(run, user.id);
      
      const res1 = await request(app)
        .post(`/api/trips/${trip.id}/cities`)
        .set('Cookie', `trippino_sid=${sid}`)
        .send({ name: 'City 1', nights: 2 });
      
      const res2 = await request(app)
        .post(`/api/trips/${trip.id}/cities`)
        .set('Cookie', `trippino_sid=${sid}`)
        .send({ name: 'City 2', nights: 3 });
      
      expect(res1.body.sort_order).toBe(0);
      expect(res2.body.sort_order).toBe(1);
    });
    
    it('should require authentication', async () => {
      const user = await createTestUser(run);
      const trip = await createTestTrip(run, user.id);
      
      const response = await request(app)
        .post(`/api/trips/${trip.id}/cities`)
        .send({ name: 'City', nights: 2 });
      
      expect(response.status).toBe(401);
    });
    
    it('should validate trip ownership', async () => {
      const user1 = await createTestUser(run, 'user1@example.com');
      const user2 = await createTestUser(run, 'user2@example.com');
      const sid1 = await createTestSession(run, user1.id);
      const trip2 = await createTestTrip(run, user2.id);
      
      const response = await request(app)
        .post(`/api/trips/${trip2.id}/cities`)
        .set('Cookie', `trippino_sid=${sid1}`)
        .send({ name: 'City', nights: 2 });
      
      expect(response.status).toBe(404);
    });
    
    it('should validate required fields', async () => {
      const user = await createTestUser(run);
      const sid = await createTestSession(run, user.id);
      const trip = await createTestTrip(run, user.id);
      
      const response = await request(app)
        .post(`/api/trips/${trip.id}/cities`)
        .set('Cookie', `trippino_sid=${sid}`)
        .send({ name: 'City' }); // Missing nights
      
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('required');
    });
    
    it('should validate nights minimum', async () => {
      const user = await createTestUser(run);
      const sid = await createTestSession(run, user.id);
      const trip = await createTestTrip(run, user.id);
      
      const response = await request(app)
        .post(`/api/trips/${trip.id}/cities`)
        .set('Cookie', `trippino_sid=${sid}`)
        .send({ name: 'City', nights: 0 });
      
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('at least 1');
    });
  });
  
  describe('PUT /api/trips/:tripId/cities/:cityId', () => {
    it('should update city name', async () => {
      const user = await createTestUser(run);
      const sid = await createTestSession(run, user.id);
      const trip = await createTestTrip(run, user.id);
      const city = await createTestCity(run, trip.id, 'Old Name');
      
      const response = await request(app)
        .put(`/api/trips/${trip.id}/cities/${city.id}`)
        .set('Cookie', `trippino_sid=${sid}`)
        .send({ name: 'New Name' });
      
      expect(response.status).toBe(200);
      
      const updated = await get(`SELECT * FROM cities WHERE id = ?`, [city.id]);
      expect(updated.name).toBe('New Name');
    });
    
    it('should update city nights', async () => {
      const user = await createTestUser(run);
      const sid = await createTestSession(run, user.id);
      const trip = await createTestTrip(run, user.id);
      const city = await createTestCity(run, trip.id, 'City', 2);
      
      const response = await request(app)
        .put(`/api/trips/${trip.id}/cities/${city.id}`)
        .set('Cookie', `trippino_sid=${sid}`)
        .send({ nights: 5 });
      
      expect(response.status).toBe(200);
      
      const updated = await get(`SELECT * FROM cities WHERE id = ?`, [city.id]);
      expect(updated.nights).toBe(5);
    });
    
    it('should update city notes', async () => {
      const user = await createTestUser(run);
      const sid = await createTestSession(run, user.id);
      const trip = await createTestTrip(run, user.id);
      const city = await createTestCity(run, trip.id);
      
      const response = await request(app)
        .put(`/api/trips/${trip.id}/cities/${city.id}`)
        .set('Cookie', `trippino_sid=${sid}`)
        .send({ notes: 'Updated notes' });
      
      expect(response.status).toBe(200);
      
      const updated = await get(`SELECT * FROM cities WHERE id = ?`, [city.id]);
      expect(updated.notes).toBe('Updated notes');
    });
    
    it('should update multiple fields at once', async () => {
      const user = await createTestUser(run);
      const sid = await createTestSession(run, user.id);
      const trip = await createTestTrip(run, user.id);
      const city = await createTestCity(run, trip.id);
      
      const response = await request(app)
        .put(`/api/trips/${trip.id}/cities/${city.id}`)
        .set('Cookie', `trippino_sid=${sid}`)
        .send({
          name: 'Updated City',
          nights: 7,
          notes: 'New notes'
        });
      
      expect(response.status).toBe(200);
      
      const updated = await get(`SELECT * FROM cities WHERE id = ?`, [city.id]);
      expect(updated.name).toBe('Updated City');
      expect(updated.nights).toBe(7);
      expect(updated.notes).toBe('New notes');
    });
    
    it('should return 404 for non-existent city', async () => {
      const user = await createTestUser(run);
      const sid = await createTestSession(run, user.id);
      const trip = await createTestTrip(run, user.id);
      
      const response = await request(app)
        .put(`/api/trips/${trip.id}/cities/99999`)
        .set('Cookie', `trippino_sid=${sid}`)
        .send({ name: 'Updated' });
      
      expect(response.status).toBe(404);
    });
    
    it('should validate trip ownership', async () => {
      const user1 = await createTestUser(run, 'user1@example.com');
      const user2 = await createTestUser(run, 'user2@example.com');
      const sid1 = await createTestSession(run, user1.id);
      const trip2 = await createTestTrip(run, user2.id);
      const city2 = await createTestCity(run, trip2.id);
      
      const response = await request(app)
        .put(`/api/trips/${trip2.id}/cities/${city2.id}`)
        .set('Cookie', `trippino_sid=${sid1}`)
        .send({ name: 'Hacked' });
      
      expect(response.status).toBe(404);
    });
    
    it('should validate nights minimum', async () => {
      const user = await createTestUser(run);
      const sid = await createTestSession(run, user.id);
      const trip = await createTestTrip(run, user.id);
      const city = await createTestCity(run, trip.id);
      
      const response = await request(app)
        .put(`/api/trips/${trip.id}/cities/${city.id}`)
        .set('Cookie', `trippino_sid=${sid}`)
        .send({ nights: 0 });
      
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('at least 1');
    });
  });
  
  describe('PUT /api/trips/:tripId/cities (batch sort order)', () => {
    it('should update sort order for multiple cities', async () => {
      const user = await createTestUser(run);
      const sid = await createTestSession(run, user.id);
      const trip = await createTestTrip(run, user.id);
      
      const city1 = await createTestCity(run, trip.id, 'City 1', 2, 0);
      const city2 = await createTestCity(run, trip.id, 'City 2', 3, 1);
      const city3 = await createTestCity(run, trip.id, 'City 3', 1, 2);
      
      // Reverse the order
      const response = await request(app)
        .put(`/api/trips/${trip.id}/cities`)
        .set('Cookie', `trippino_sid=${sid}`)
        .send({
          sortOrder: [
            { id: city3.id },
            { id: city2.id },
            { id: city1.id }
          ]
        });
      
      expect(response.status).toBe(200);
      
      const updated1 = await get(`SELECT * FROM cities WHERE id = ?`, [city1.id]);
      const updated2 = await get(`SELECT * FROM cities WHERE id = ?`, [city2.id]);
      const updated3 = await get(`SELECT * FROM cities WHERE id = ?`, [city3.id]);
      
      expect(updated3.sort_order).toBe(0);
      expect(updated2.sort_order).toBe(1);
      expect(updated1.sort_order).toBe(2);
    });
    
    it('should validate all cities belong to trip', async () => {
      const user = await createTestUser(run);
      const sid = await createTestSession(run, user.id);
      const trip1 = await createTestTrip(run, user.id);
      const trip2 = await createTestTrip(run, user.id);
      
      const city1 = await createTestCity(run, trip1.id);
      const city2 = await createTestCity(run, trip2.id); // Different trip
      
      const response = await request(app)
        .put(`/api/trips/${trip1.id}/cities`)
        .set('Cookie', `trippino_sid=${sid}`)
        .send({
          sortOrder: [
            { id: city1.id },
            { id: city2.id } // Should fail
          ]
        });
      
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid city IDs');
    });
    
    it('should require non-empty array', async () => {
      const user = await createTestUser(run);
      const sid = await createTestSession(run, user.id);
      const trip = await createTestTrip(run, user.id);
      
      const response = await request(app)
        .put(`/api/trips/${trip.id}/cities`)
        .set('Cookie', `trippino_sid=${sid}`)
        .send({ sortOrder: [] });
      
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid sortOrder');
    });
    
    it('should validate trip ownership', async () => {
      const user1 = await createTestUser(run, 'user1@example.com');
      const user2 = await createTestUser(run, 'user2@example.com');
      const sid1 = await createTestSession(run, user1.id);
      const trip2 = await createTestTrip(run, user2.id);
      const city = await createTestCity(run, trip2.id);
      
      const response = await request(app)
        .put(`/api/trips/${trip2.id}/cities`)
        .set('Cookie', `trippino_sid=${sid1}`)
        .send({ sortOrder: [{ id: city.id }] });
      
      expect(response.status).toBe(404);
    });
  });
  
  describe('DELETE /api/trips/:id/cities/:cityId', () => {
    it('should delete city', async () => {
      const user = await createTestUser(run);
      const sid = await createTestSession(run, user.id);
      const trip = await createTestTrip(run, user.id);
      const city = await createTestCity(run, trip.id);
      
      const response = await request(app)
        .delete(`/api/trips/${trip.id}/cities/${city.id}`)
        .set('Cookie', `trippino_sid=${sid}`);
      
      expect(response.status).toBe(200);
      
      const deleted = await get(`SELECT * FROM cities WHERE id = ?`, [city.id]);
      expect(deleted).toBeUndefined();
    });
    
    it('should return 404 for non-existent city', async () => {
      const user = await createTestUser(run);
      const sid = await createTestSession(run, user.id);
      const trip = await createTestTrip(run, user.id);
      
      const response = await request(app)
        .delete(`/api/trips/${trip.id}/cities/99999`)
        .set('Cookie', `trippino_sid=${sid}`);
      
      expect(response.status).toBe(404);
    });
    
    it('should validate trip ownership', async () => {
      const user1 = await createTestUser(run, 'user1@example.com');
      const user2 = await createTestUser(run, 'user2@example.com');
      const sid1 = await createTestSession(run, user1.id);
      const trip2 = await createTestTrip(run, user2.id);
      const city2 = await createTestCity(run, trip2.id);
      
      const response = await request(app)
        .delete(`/api/trips/${trip2.id}/cities/${city2.id}`)
        .set('Cookie', `trippino_sid=${sid1}`);
      
      expect(response.status).toBe(404);
      
      // Verify city still exists
      const stillExists = await get(`SELECT * FROM cities WHERE id = ?`, [city2.id]);
      expect(stillExists).toBeDefined();
    });
    
    it('should require authentication', async () => {
      const user = await createTestUser(run);
      const trip = await createTestTrip(run, user.id);
      const city = await createTestCity(run, trip.id);
      
      const response = await request(app)
        .delete(`/api/trips/${trip.id}/cities/${city.id}`);
      
      expect(response.status).toBe(401);
    });
  });
});
