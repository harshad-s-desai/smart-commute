-- ====================================================================
-- SMART COMMUTE - MULTIMODAL TRANSIT & RIDE MATCHING ENGINE
-- PostgreSQL Database Schema (schema.sql)
-- ====================================================================

-- 1. USERS TABLE
-- Stores credentials and user profile information
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    mobile VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    gender VARCHAR(20) CHECK (gender IN ('male', 'female', 'other')),
    age INTEGER,
    is_verified INTEGER DEFAULT 0,
    is_admin INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. STATIONS TABLE
-- 30 Pre-configured Kolhapur transit points, colleges, and landmarks
CREATE TABLE IF NOT EXISTS stations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    type VARCHAR(50) CHECK (type IN ('college', 'school', 'bus_stop', 'landmark', 'area', 'transport_hub')),
    city VARCHAR(100) DEFAULT 'Kolhapur'
);

-- 3. RIDES TABLE
-- Peer-to-peer rides offered by verified commuters
CREATE TABLE IF NOT EXISTS rides (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    origin_name VARCHAR(255) NOT NULL,
    origin_lat DOUBLE PRECISION NOT NULL,
    origin_lng DOUBLE PRECISION NOT NULL,
    destination_name VARCHAR(255) NOT NULL,
    destination_lat DOUBLE PRECISION NOT NULL,
    destination_lng DOUBLE PRECISION NOT NULL,
    date VARCHAR(50) NOT NULL,
    time VARCHAR(50) NOT NULL,
    vehicle_type VARCHAR(20) CHECK (vehicle_type IN ('car', 'bike', 'auto')) DEFAULT 'car',
    available_seats INTEGER DEFAULT 1,
    fare_per_seat DOUBLE PRECISION DEFAULT 0,
    notes TEXT,
    gender_preference VARCHAR(20) CHECK (gender_preference IN ('any', 'male', 'female')) DEFAULT 'any',
    status VARCHAR(20) CHECK (status IN ('active', 'completed', 'cancelled')) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. BOOKINGS TABLE
-- Ride matching & seat reservations made by seekers
CREATE TABLE IF NOT EXISTS bookings (
    id SERIAL PRIMARY KEY,
    ride_id INTEGER NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
    passenger_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seats_booked INTEGER DEFAULT 1,
    status VARCHAR(20) CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed')) DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. MESSAGES TABLE
-- Direct messaging between commuters (e.g. pickup coordination)
CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ride_id INTEGER REFERENCES rides(id) ON DELETE SET NULL,
    content TEXT NOT NULL,
    is_read INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. REPORTS TABLE
-- Trust & safety incident reports submitted to the administrator
CREATE TABLE IF NOT EXISTS reports (
    id SERIAL PRIMARY KEY,
    reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reported_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ride_id INTEGER REFERENCES rides(id) ON DELETE SET NULL,
    reason VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(20) CHECK (status IN ('pending', 'reviewed', 'resolved')) DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- INDEXES FOR PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_rides_date ON rides(date);
CREATE INDEX IF NOT EXISTS idx_rides_status ON rides(status);
CREATE INDEX IF NOT EXISTS idx_rides_user_id ON rides(user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_ride_id ON bookings(ride_id);
CREATE INDEX IF NOT EXISTS idx_bookings_passenger_id ON bookings(passenger_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(sender_id, receiver_id);
