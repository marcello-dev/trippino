-- Migration: Index foreign key columns
-- Date: 2026-10-12
-- Description: Speed up per-user and per-trip lookups and ON DELETE CASCADE

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_trips_user_id ON trips(user_id);
CREATE INDEX IF NOT EXISTS idx_cities_trip_id ON cities(trip_id);
CREATE INDEX IF NOT EXISTS idx_transportation_trip_id ON transportation(trip_id);
CREATE INDEX IF NOT EXISTS idx_transportation_from_city_id ON transportation(from_city_id);
CREATE INDEX IF NOT EXISTS idx_transportation_to_city_id ON transportation(to_city_id);
