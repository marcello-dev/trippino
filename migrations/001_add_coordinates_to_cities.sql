-- Migration: Add coordinates to cities table
-- Date: 2025-11-11
-- Description: Add latitude and longitude columns to the cities table to store location data from TomTom API

ALTER TABLE cities ADD COLUMN latitude REAL;
ALTER TABLE cities ADD COLUMN longitude REAL;

-- Create an index for spatial queries (optional but recommended for performance)
CREATE INDEX IF NOT EXISTS idx_cities_coordinates ON cities(latitude, longitude);