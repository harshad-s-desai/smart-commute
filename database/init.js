const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');

dotenv.config();

// PostgreSQL Connection Pool configuration
const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432', 10),
    database: process.env.PGDATABASE || 'smart_commute',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
});

pool.on('error', (err) => {
    console.error('Unexpected error on idle PostgreSQL client:', err);
});

/**
 * Automatically converts SQLite-style '?' placeholders into PostgreSQL '$1, $2, ...' placeholders
 */
function convertPlaceholders(sql) {
    if (!sql.includes('?')) return sql;
    let index = 1;
    return sql.replace(/\?/g, () => `$${index++}`);
}

/**
 * Execute raw query with parameterized arguments
 */
async function query(sql, params = []) {
    const formattedSql = convertPlaceholders(sql);
    const flatParams = Array.isArray(params) ? params : [params];
    return await pool.query(formattedSql, flatParams);
}

/**
 * Return single row or null
 */
async function get(sql, params = []) {
    const res = await query(sql, params);
    return res.rows[0] || null;
}

/**
 * Return all rows
 */
async function all(sql, params = []) {
    const res = await query(sql, params);
    return res.rows;
}

/**
 * Execute INSERT/UPDATE/DELETE query and return { rowCount, lastInsertRowid, rows }
 */
async function run(sql, params = []) {
    let finalSql = sql.trim();
    if (/^INSERT\s+INTO/i.test(finalSql) && !/RETURNING/i.test(finalSql)) {
        finalSql += ' RETURNING id';
    }
    const res = await query(finalSql, params);
    const lastInsertRowid = res.rows && res.rows[0] ? res.rows[0].id : null;
    return {
        rowCount: res.rowCount,
        lastInsertRowid,
        rows: res.rows
    };
}

/**
 * Prepared statement simulation matching sqlite3 API:
 * db.prepare(sql).get(...args)
 * db.prepare(sql).all(...args)
 * db.prepare(sql).run(...args)
 */
function prepare(sql) {
    return {
        get: async (...args) => {
            const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
            return await get(sql, params);
        },
        all: async (...args) => {
            const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
            return await all(sql, params);
        },
        run: async (...args) => {
            const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
            return await run(sql, params);
        }
    };
}

/**
 * Transaction helper for atomic operations
 */
async function transaction(callback) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const txDb = {
            query: async (sql, params = []) => {
                const formattedSql = convertPlaceholders(sql);
                const flatParams = Array.isArray(params) ? params : [params];
                return await client.query(formattedSql, flatParams);
            },
            get: async (sql, params = []) => {
                const formattedSql = convertPlaceholders(sql);
                const flatParams = Array.isArray(params) ? params : [params];
                const res = await client.query(formattedSql, flatParams);
                return res.rows[0] || null;
            },
            all: async (sql, params = []) => {
                const formattedSql = convertPlaceholders(sql);
                const flatParams = Array.isArray(params) ? params : [params];
                const res = await client.query(formattedSql, flatParams);
                return res.rows;
            },
            run: async (sql, params = []) => {
                let finalSql = sql.trim();
                if (/^INSERT\s+INTO/i.test(finalSql) && !/RETURNING/i.test(finalSql)) {
                    finalSql += ' RETURNING id';
                }
                const formattedSql = convertPlaceholders(finalSql);
                const flatParams = Array.isArray(params) ? params : [params];
                const res = await client.query(formattedSql, flatParams);
                return {
                    rowCount: res.rowCount,
                    lastInsertRowid: res.rows && res.rows[0] ? res.rows[0].id : null,
                    rows: res.rows
                };
            },
            prepare: function (sql) {
                return {
                    get: async (...args) => {
                        const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
                        return await this.get(sql, params);
                    },
                    all: async (...args) => {
                        const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
                        return await this.all(sql, params);
                    },
                    run: async (...args) => {
                        const params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
                        return await this.run(sql, params);
                    }
                };
            }
        };

        const result = await callback(txDb);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

// Kolhapur Stations (30) as required by project specification
const KOLHAPUR_STATIONS = [
    { name: "KIT College of Engineering", lat: 16.6735, lng: 74.2479, type: "college" },
    { name: "DY Patil College", lat: 16.6950, lng: 74.2440, type: "college" },
    { name: "Shivaji University", lat: 16.6823, lng: 74.2489, type: "college" },
    { name: "Rajaram College", lat: 16.6987, lng: 74.2315, type: "college" },
    { name: "Vivekanand College", lat: 16.7041, lng: 74.2264, type: "college" },
    { name: "Bharati Vidyapeeth", lat: 16.6654, lng: 74.2569, type: "college" },
    { name: "Government Polytechnic", lat: 16.6920, lng: 74.2350, type: "college" },
    { name: "Willingdon College", lat: 16.6990, lng: 74.2290, type: "college" },
    { name: "Chh. Shahu Central Library", lat: 16.6965, lng: 74.2310, type: "landmark" },
    { name: "Hockey Stadium", lat: 16.6927, lng: 74.2274, type: "landmark" },
    { name: "RK Nagar", lat: 16.7069, lng: 74.2193, type: "area" },
    { name: "Rankala Lake", lat: 16.6876, lng: 74.2195, type: "landmark" },
    { name: "Mahalaxmi Temple", lat: 16.6992, lng: 74.2268, type: "landmark" },
    { name: "CBS (Central Bus Stand)", lat: 16.6982, lng: 74.2330, type: "transport_hub" },
    { name: "Kolhapur Railway Station", lat: 16.6889, lng: 74.2355, type: "transport_hub" },
    { name: "Shahupuri", lat: 16.6960, lng: 74.2403, type: "area" },
    { name: "Rajarampuri", lat: 16.7025, lng: 74.2329, type: "area" },
    { name: "Tarabai Park", lat: 16.6899, lng: 74.2297, type: "area" },
    { name: "Dabholkar Corner", lat: 16.6972, lng: 74.2348, type: "landmark" },
    { name: "Bindu Chowk", lat: 16.6995, lng: 74.2288, type: "landmark" },
    { name: "Nagala Park", lat: 16.7017, lng: 74.2186, type: "area" },
    { name: "Laxmipuri", lat: 16.6940, lng: 74.2367, type: "area" },
    { name: "Sykes Extension", lat: 16.7052, lng: 74.2313, type: "area" },
    { name: "Kalamba", lat: 16.6759, lng: 74.2241, type: "area" },
    { name: "Morewadi", lat: 16.6612, lng: 74.2528, type: "area" },
    { name: "Uchgaon", lat: 16.6558, lng: 74.2654, type: "area" },
    { name: "Shiroli MIDC", lat: 16.6884, lng: 74.3167, type: "area" },
    { name: "Kadamwadi", lat: 16.7102, lng: 74.2245, type: "area" },
    { name: "New Palace", lat: 16.6937, lng: 74.2253, type: "landmark" },
    { name: "Kolhapur Airport", lat: 16.6640, lng: 74.2894, type: "transport_hub" }
];

/**
 * Initialize PostgreSQL tables and seed data
 */
async function initializeDatabase() {
    try {
        // Create tables
        await pool.query(`
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

            CREATE TABLE IF NOT EXISTS bookings (
                id SERIAL PRIMARY KEY,
                ride_id INTEGER NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
                passenger_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                seats_booked INTEGER DEFAULT 1,
                status VARCHAR(20) CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed')) DEFAULT 'pending',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS stations (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                lat DOUBLE PRECISION NOT NULL,
                lng DOUBLE PRECISION NOT NULL,
                type VARCHAR(50) CHECK (type IN ('college', 'school', 'bus_stop', 'landmark', 'area', 'transport_hub')),
                city VARCHAR(100) DEFAULT 'Kolhapur'
            );

            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                ride_id INTEGER REFERENCES rides(id) ON DELETE SET NULL,
                content TEXT NOT NULL,
                is_read INTEGER DEFAULT 0,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );

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

            CREATE TABLE IF NOT EXISTS feedback (
                id SERIAL PRIMARY KEY,
                ride_id INTEGER NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
                booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
                giver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                giver_role VARCHAR(20) CHECK (giver_role IN ('passenger', 'driver')),
                rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
                comment TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS public_transit_routes (
                id SERIAL PRIMARY KEY,
                transit_mode VARCHAR(50) NOT NULL, -- 'kmt_bus', 'msrtc_bus', 'train', 'shared_auto', 'city_auto'
                operator_name VARCHAR(100) NOT NULL,
                route_number VARCHAR(50),
                route_name VARCHAR(255) NOT NULL,
                origin_name VARCHAR(255) NOT NULL,
                origin_lat DOUBLE PRECISION NOT NULL,
                origin_lng DOUBLE PRECISION NOT NULL,
                destination_name VARCHAR(255) NOT NULL,
                destination_lat DOUBLE PRECISION NOT NULL,
                destination_lng DOUBLE PRECISION NOT NULL,
                stops TEXT,
                first_departure VARCHAR(10) NOT NULL DEFAULT '06:00',
                last_departure VARCHAR(10) NOT NULL DEFAULT '22:30',
                frequency_mins INTEGER NOT NULL DEFAULT 15,
                estimated_duration_min INTEGER NOT NULL DEFAULT 20,
                fare_inr NUMERIC(8,2) NOT NULL DEFAULT 12.00,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Migration: Ensure intermediate boarding columns exist on bookings table
        await pool.query(`
            ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pickup_location VARCHAR(255);
            ALTER TABLE bookings ADD COLUMN IF NOT EXISTS dropoff_location VARCHAR(255);
            ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pickup_lat DOUBLE PRECISION;
            ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pickup_lng DOUBLE PRECISION;
            ALTER TABLE bookings ADD COLUMN IF NOT EXISTS dropoff_lat DOUBLE PRECISION;
            ALTER TABLE bookings ADD COLUMN IF NOT EXISTS dropoff_lng DOUBLE PRECISION;
            ALTER TABLE bookings ADD COLUMN IF NOT EXISTS is_intermediate BOOLEAN DEFAULT FALSE;
        `);

        // Check & Seed Stations
        const stationRes = await pool.query('SELECT COUNT(*) as count FROM stations');
        if (parseInt(stationRes.rows[0].count, 10) === 0) {
            for (const s of KOLHAPUR_STATIONS) {
                await pool.query(
                    'INSERT INTO stations (name, lat, lng, type, city) VALUES ($1, $2, $3, $4, $5)',
                    [s.name, s.lat, s.lng, s.type, 'Kolhapur']
                );
            }
            console.log(`[PostgreSQL] Seeded ${KOLHAPUR_STATIONS.length} Kolhapur stations.`);
        }

        // Check & Seed Users
        const userRes = await pool.query('SELECT COUNT(*) as count FROM users');
        if (parseInt(userRes.rows[0].count, 10) === 0) {
            const defaultPasswordHash = bcrypt.hashSync('password123', 10);
            const adminPasswordHash = bcrypt.hashSync('admin123', 10);

            const usersToSeed = [
                {
                    name: 'System Administrator',
                    email: 'admin@smartcommute.com',
                    mobile: '9876543210',
                    password: adminPasswordHash,
                    gender: 'other',
                    age: 30,
                    is_verified: 1,
                    is_admin: 1
                },
                {
                    name: 'Sachin Patil',
                    email: 'sachin.patil@kolhapur.in',
                    mobile: '9822012345',
                    password: defaultPasswordHash,
                    gender: 'male',
                    age: 22,
                    is_verified: 1,
                    is_admin: 0
                },
                {
                    name: 'Sneha Kulkarni',
                    email: 'sneha@example.com',
                    mobile: '9822023456',
                    password: defaultPasswordHash,
                    gender: 'female',
                    age: 21,
                    is_verified: 1,
                    is_admin: 0
                },
                {
                    name: 'Rohan Deshmukh',
                    email: 'rohan@example.com',
                    mobile: '9822034567',
                    password: defaultPasswordHash,
                    gender: 'male',
                    age: 24,
                    is_verified: 1,
                    is_admin: 0
                },
                {
                    name: 'Ananya Shinde',
                    email: 'ananya@example.com',
                    mobile: '9822045678',
                    password: defaultPasswordHash,
                    gender: 'female',
                    age: 23,
                    is_verified: 1,
                    is_admin: 0
                },
                {
                    name: 'Amit Joshi',
                    email: 'amit@example.com',
                    mobile: '9822056789',
                    password: defaultPasswordHash,
                    gender: 'male',
                    age: 26,
                    is_verified: 1,
                    is_admin: 0
                },
                {
                    name: 'Pooja Jadhav',
                    email: 'pooja@example.com',
                    mobile: '9822067890',
                    password: defaultPasswordHash,
                    gender: 'female',
                    age: 20,
                    is_verified: 1,
                    is_admin: 0
                },
                {
                    name: 'Vikram Bhosale',
                    email: 'vikram@example.com',
                    mobile: '9822078901',
                    password: defaultPasswordHash,
                    gender: 'male',
                    age: 28,
                    is_verified: 0,
                    is_admin: 0
                },
                {
                    name: 'Priyanka Chavan',
                    email: 'priyanka@example.com',
                    mobile: '9822089012',
                    password: defaultPasswordHash,
                    gender: 'female',
                    age: 22,
                    is_verified: 1,
                    is_admin: 0
                }
            ];

            for (const u of usersToSeed) {
                await pool.query(`
                    INSERT INTO users (name, email, mobile, password, gender, age, is_verified, is_admin)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                `, [u.name, u.email, u.mobile, u.password, u.gender, u.age, u.is_verified, u.is_admin]);
            }
            console.log(`[PostgreSQL] Seeded ${usersToSeed.length} sample users.`);
        }

        // Check & Seed Rides
        const rideRes = await pool.query('SELECT COUNT(*) as count FROM rides');
        if (parseInt(rideRes.rows[0].count, 10) === 0) {
            const stationsList = (await pool.query('SELECT name, lat, lng FROM stations')).rows;
            const stMap = {};
            stationsList.forEach(s => { stMap[s.name] = s; });

            const usersList = (await pool.query('SELECT id, email FROM users')).rows;
            const uMap = {};
            usersList.forEach(u => { uMap[u.email] = u.id; });

            const ridesToSeed = [
                {
                    user_id: uMap['sachin.patil@kolhapur.in'],
                    origin_name: 'Shivaji University',
                    origin_lat: stMap['Shivaji University'].lat,
                    origin_lng: stMap['Shivaji University'].lng,
                    destination_name: 'CBS (Central Bus Stand)',
                    destination_lat: stMap['CBS (Central Bus Stand)'].lat,
                    destination_lng: stMap['CBS (Central Bus Stand)'].lng,
                    date: '2026-10-15',
                    time: '08:30',
                    vehicle_type: 'car',
                    available_seats: 2,
                    fare_per_seat: 40,
                    notes: 'Daily college commute, AC car. Music on the way!',
                    gender_preference: 'any',
                    status: 'active'
                },
                {
                    user_id: uMap['sneha@example.com'],
                    origin_name: 'DY Patil College',
                    origin_lat: stMap['DY Patil College'].lat,
                    origin_lng: stMap['DY Patil College'].lng,
                    destination_name: 'Rajarampuri',
                    destination_lat: stMap['Rajarampuri'].lat,
                    destination_lng: stMap['Rajarampuri'].lng,
                    date: '2026-10-15',
                    time: '09:00',
                    vehicle_type: 'bike',
                    available_seats: 1,
                    fare_per_seat: 25,
                    notes: 'Scooter ride for female students/commuters.',
                    gender_preference: 'female',
                    status: 'active'
                },
                {
                    user_id: uMap['rohan@example.com'],
                    origin_name: 'KIT College of Engineering',
                    origin_lat: stMap['KIT College of Engineering'].lat,
                    origin_lng: stMap['KIT College of Engineering'].lng,
                    destination_name: 'Rankala Lake',
                    destination_lat: stMap['Rankala Lake'].lat,
                    destination_lng: stMap['Rankala Lake'].lng,
                    date: '2026-10-15',
                    time: '17:30',
                    vehicle_type: 'car',
                    available_seats: 2,
                    fare_per_seat: 50,
                    notes: 'Heading towards Rankala for evening walk. Clean Swift Dzire.',
                    gender_preference: 'any',
                    status: 'active'
                },
                {
                    user_id: uMap['ananya@example.com'],
                    origin_name: 'Rajaram College',
                    origin_lat: stMap['Rajaram College'].lat,
                    origin_lng: stMap['Rajaram College'].lng,
                    destination_name: 'Dabholkar Corner',
                    destination_lat: stMap['Dabholkar Corner'].lat,
                    destination_lng: stMap['Dabholkar Corner'].lng,
                    date: '2026-10-16',
                    time: '08:45',
                    vehicle_type: 'car',
                    available_seats: 2,
                    fare_per_seat: 30,
                    notes: 'Women only ride. Safe and quiet drive in Hyundai i20.',
                    gender_preference: 'female',
                    status: 'active'
                },
                {
                    user_id: uMap['amit@example.com'],
                    origin_name: 'CBS (Central Bus Stand)',
                    origin_lat: stMap['CBS (Central Bus Stand)'].lat,
                    origin_lng: stMap['CBS (Central Bus Stand)'].lng,
                    destination_name: 'Shiroli MIDC',
                    destination_lat: stMap['Shiroli MIDC'].lat,
                    destination_lng: stMap['Shiroli MIDC'].lng,
                    date: '2026-10-16',
                    time: '09:15',
                    vehicle_type: 'car',
                    available_seats: 4,
                    fare_per_seat: 60,
                    notes: 'Office commute to MIDC. Punctual departure.',
                    gender_preference: 'any',
                    status: 'active'
                },
                {
                    user_id: uMap['pooja@example.com'],
                    origin_name: 'Vivekanand College',
                    origin_lat: stMap['Vivekanand College'].lat,
                    origin_lng: stMap['Vivekanand College'].lng,
                    destination_name: 'RK Nagar',
                    destination_lat: stMap['RK Nagar'].lat,
                    destination_lng: stMap['RK Nagar'].lng,
                    date: '2026-10-16',
                    time: '16:00',
                    vehicle_type: 'auto',
                    available_seats: 2,
                    fare_per_seat: 35,
                    notes: 'Shared rickshaw ride after afternoon practicals.',
                    gender_preference: 'any',
                    status: 'active'
                },
                {
                    user_id: uMap['vikram@example.com'],
                    origin_name: 'Kolhapur Railway Station',
                    origin_lat: stMap['Kolhapur Railway Station'].lat,
                    origin_lng: stMap['Kolhapur Railway Station'].lng,
                    destination_name: 'Bharati Vidyapeeth',
                    destination_lat: stMap['Bharati Vidyapeeth'].lat,
                    destination_lng: stMap['Bharati Vidyapeeth'].lng,
                    date: '2026-10-17',
                    time: '10:00',
                    vehicle_type: 'car',
                    available_seats: 3,
                    fare_per_seat: 45,
                    notes: 'Direct ride from Railway station to university campus.',
                    gender_preference: 'any',
                    status: 'active'
                },
                {
                    user_id: uMap['priyanka@example.com'],
                    origin_name: 'Tarabai Park',
                    origin_lat: stMap['Tarabai Park'].lat,
                    origin_lng: stMap['Tarabai Park'].lng,
                    destination_name: 'Kolhapur Airport',
                    destination_lat: stMap['Kolhapur Airport'].lat,
                    destination_lng: stMap['Kolhapur Airport'].lng,
                    date: '2026-10-17',
                    time: '14:00',
                    vehicle_type: 'car',
                    available_seats: 2,
                    fare_per_seat: 90,
                    notes: 'Catching afternoon flight, spacious boot for luggage.',
                    gender_preference: 'female',
                    status: 'active'
                },
                {
                    user_id: uMap['sachin.patil@kolhapur.in'],
                    origin_name: 'RK Nagar',
                    origin_lat: stMap['RK Nagar'].lat,
                    origin_lng: stMap['RK Nagar'].lng,
                    destination_name: 'Mahalaxmi Temple',
                    destination_lat: stMap['Mahalaxmi Temple'].lat,
                    destination_lng: stMap['Mahalaxmi Temple'].lng,
                    date: '2026-10-18',
                    time: '11:00',
                    vehicle_type: 'bike',
                    available_seats: 1,
                    fare_per_seat: 30,
                    notes: 'Visiting temple for darshan. Quick bike ride.',
                    gender_preference: 'male',
                    status: 'active'
                },
                {
                    user_id: uMap['rohan@example.com'],
                    origin_name: 'Willingdon College',
                    origin_lat: stMap['Willingdon College'].lat,
                    origin_lng: stMap['Willingdon College'].lng,
                    destination_name: 'Laxmipuri',
                    destination_lat: stMap['Laxmipuri'].lat,
                    destination_lng: stMap['Laxmipuri'].lng,
                    date: '2026-10-18',
                    time: '18:00',
                    vehicle_type: 'car',
                    available_seats: 3,
                    fare_per_seat: 35,
                    notes: 'Heading towards market for shopping.',
                    gender_preference: 'any',
                    status: 'active'
                },
                {
                    user_id: uMap['amit@example.com'],
                    origin_name: 'Kalamba',
                    origin_lat: stMap['Kalamba'].lat,
                    origin_lng: stMap['Kalamba'].lng,
                    destination_name: 'CBS (Central Bus Stand)',
                    destination_lat: stMap['CBS (Central Bus Stand)'].lat,
                    destination_lng: stMap['CBS (Central Bus Stand)'].lng,
                    date: '2026-10-19',
                    time: '08:15',
                    vehicle_type: 'car',
                    available_seats: 3,
                    fare_per_seat: 40,
                    notes: 'Early morning commute, stopovers near Rankala allowed.',
                    gender_preference: 'any',
                    status: 'active'
                },
                {
                    user_id: uMap['sneha@example.com'],
                    origin_name: 'Shahupuri',
                    origin_lat: stMap['Shahupuri'].lat,
                    origin_lng: stMap['Shahupuri'].lng,
                    destination_name: 'Shivaji University',
                    destination_lat: stMap['Shivaji University'].lat,
                    destination_lng: stMap['Shivaji University'].lng,
                    date: '2026-10-20',
                    time: '09:30',
                    vehicle_type: 'car',
                    available_seats: 2,
                    fare_per_seat: 35,
                    notes: 'Female pool to University campus. Comfortable hatchback.',
                    gender_preference: 'female',
                    status: 'active'
                }
            ];

            for (const r of ridesToSeed) {
                await pool.query(`
                    INSERT INTO rides (
                        user_id, origin_name, origin_lat, origin_lng,
                        destination_name, destination_lat, destination_lng,
                        date, time, vehicle_type, available_seats,
                        fare_per_seat, notes, gender_preference, status
                    ) VALUES (
                        $1, $2, $3, $4,
                        $5, $6, $7,
                        $8, $9, $10, $11,
                        $12, $13, $14, $15
                    )
                `, [
                    r.user_id, r.origin_name, r.origin_lat, r.origin_lng,
                    r.destination_name, r.destination_lat, r.destination_lng,
                    r.date, r.time, r.vehicle_type, r.available_seats,
                    r.fare_per_seat, r.notes, r.gender_preference, r.status
                ]);
            }
            console.log(`[PostgreSQL] Seeded ${ridesToSeed.length} sample rides.`);

            // Seed Sample Bookings
            const firstRide = (await pool.query('SELECT id FROM rides WHERE origin_name = $1', ['Shivaji University'])).rows[0];
            const fourthRide = (await pool.query('SELECT id FROM rides WHERE origin_name = $1', ['Rajaram College'])).rows[0];
            const thirdRide = (await pool.query('SELECT id FROM rides WHERE origin_name = $1', ['KIT College of Engineering'])).rows[0];

            if (firstRide && uMap['ananya@example.com']) {
                await pool.query('INSERT INTO bookings (ride_id, passenger_id, seats_booked, status) VALUES ($1, $2, $3, $4)', [firstRide.id, uMap['ananya@example.com'], 1, 'confirmed']);
            }
            if (fourthRide && uMap['pooja@example.com']) {
                await pool.query('INSERT INTO bookings (ride_id, passenger_id, seats_booked, status) VALUES ($1, $2, $3, $4)', [fourthRide.id, uMap['pooja@example.com'], 1, 'confirmed']);
            }
            if (thirdRide && uMap['sneha@example.com']) {
                await pool.query('INSERT INTO bookings (ride_id, passenger_id, seats_booked, status) VALUES ($1, $2, $3, $4)', [thirdRide.id, uMap['sneha@example.com'], 1, 'pending']);
            }

            // Seed Sample Messages
            if (firstRide && uMap['ananya@example.com'] && uMap['sachin.patil@kolhapur.in']) {
                await pool.query(`
                    INSERT INTO messages (sender_id, receiver_id, ride_id, content, is_read)
                    VALUES ($1, $2, $3, $4, 1), ($2, $1, $3, $5, 1)
                `, [
                    uMap['ananya@example.com'],
                    uMap['sachin.patil@kolhapur.in'],
                    firstRide.id,
                    'Hi Sachin, will you be picking up near the university main gate?',
                    'Yes Ananya! I will be near the main entrance arch by 8:25 AM.'
                ]);
            }

            // Seed Sample Report
            if (uMap['sneha@example.com'] && uMap['vikram@example.com']) {
                await pool.query(`
                    INSERT INTO reports (reporter_id, reported_user_id, ride_id, reason, description, status)
                    VALUES ($1, $2, NULL, $3, $4, 'pending')
                `, [
                    uMap['sneha@example.com'],
                    uMap['vikram@example.com'],
                    'Unresponsive Driver',
                    'Driver was uncontactable and cancelled ride without notification.'
                ]);
            }
            console.log('[PostgreSQL] Seeded sample bookings, messages, and reports.');
        }

        // Check & Seed Public Transit Routes (Multi-Modal Transit real data)
        const transitCountRes = await pool.query('SELECT COUNT(*) as count FROM public_transit_routes');
        if (parseInt(transitCountRes.rows[0].count, 10) === 0) {
            const transitRoutesToSeed = [
                {
                    transit_mode: 'kmt_bus',
                    operator_name: 'KMT (Kolhapur Municipal Transport)',
                    route_number: 'Route 1',
                    route_name: 'CBS ⇄ Shivaji University',
                    origin_name: 'CBS (Central Bus Stand)',
                    origin_lat: 16.6982,
                    origin_lng: 74.2330,
                    destination_name: 'Shivaji University',
                    destination_lat: 16.6823,
                    destination_lng: 74.2489,
                    stops: 'CBS, Dabholkar Corner, Station Road, Shahupuri, Rajarampuri, Cyber College, Shivaji University',
                    first_departure: '06:00',
                    last_departure: '22:30',
                    frequency_mins: 12,
                    estimated_duration_min: 20,
                    fare_inr: 12.00
                },
                {
                    transit_mode: 'kmt_bus',
                    operator_name: 'KMT (Kolhapur Municipal Transport)',
                    route_number: 'Route 2',
                    route_name: 'CBS ⇄ Rankala Lake',
                    origin_name: 'CBS (Central Bus Stand)',
                    origin_lat: 16.6982,
                    origin_lng: 74.2330,
                    destination_name: 'Rankala Lake',
                    destination_lat: 16.6876,
                    destination_lng: 74.2195,
                    stops: 'CBS, Venus Corner, Bindu Chowk, Mahalaxmi Temple, CPR Hospital, Rankala Stand',
                    first_departure: '06:15',
                    last_departure: '22:00',
                    frequency_mins: 15,
                    estimated_duration_min: 18,
                    fare_inr: 10.00
                },
                {
                    transit_mode: 'kmt_bus',
                    operator_name: 'KMT (Kolhapur Municipal Transport)',
                    route_number: 'Route 3',
                    route_name: 'CBS ⇄ Shiroli MIDC',
                    origin_name: 'CBS (Central Bus Stand)',
                    origin_lat: 16.6982,
                    origin_lng: 74.2330,
                    destination_name: 'Shiroli MIDC',
                    destination_lat: 16.6884,
                    destination_lng: 74.3167,
                    stops: 'CBS, Kawala Naka, Tarabai Park, Shiroli Phata, Shiroli MIDC',
                    first_departure: '06:30',
                    last_departure: '21:45',
                    frequency_mins: 20,
                    estimated_duration_min: 30,
                    fare_inr: 18.00
                },
                {
                    transit_mode: 'kmt_bus',
                    operator_name: 'KMT (Kolhapur Municipal Transport)',
                    route_number: 'Route 4',
                    route_name: 'Railway Station ⇄ KIT College',
                    origin_name: 'Kolhapur Railway Station',
                    origin_lat: 16.6889,
                    origin_lng: 74.2355,
                    destination_name: 'KIT College of Engineering',
                    destination_lat: 16.6735,
                    destination_lng: 74.2479,
                    stops: 'Kolhapur Railway Station, Dabholkar Corner, Shivaji University, Morewadi, Gokul Shirgaon, KIT College',
                    first_departure: '06:45',
                    last_departure: '21:30',
                    frequency_mins: 15,
                    estimated_duration_min: 28,
                    fare_inr: 15.00
                },
                {
                    transit_mode: 'kmt_bus',
                    operator_name: 'KMT (Kolhapur Municipal Transport)',
                    route_number: 'Route 5',
                    route_name: 'CBS ⇄ Kalamba Lake',
                    origin_name: 'CBS (Central Bus Stand)',
                    origin_lat: 16.6982,
                    origin_lng: 74.2330,
                    destination_name: 'Kalamba',
                    destination_lat: 16.6759,
                    destination_lng: 74.2241,
                    stops: 'CBS, Rankala Stand, Hockey Stadium, Sambhajinagar, Kalamba Lake',
                    first_departure: '06:30',
                    last_departure: '21:00',
                    frequency_mins: 20,
                    estimated_duration_min: 22,
                    fare_inr: 12.00
                },
                {
                    transit_mode: 'kmt_bus',
                    operator_name: 'KMT (Kolhapur Municipal Transport)',
                    route_number: 'Route 6',
                    route_name: 'CBS ⇄ New Palace & CPR',
                    origin_name: 'CBS (Central Bus Stand)',
                    origin_lat: 16.6982,
                    origin_lng: 74.2330,
                    destination_name: 'New Palace',
                    destination_lat: 16.6937,
                    destination_lng: 74.2253,
                    stops: 'CBS, Dabholkar Corner, Collector Office, Raman Mala, New Palace',
                    first_departure: '07:00',
                    last_departure: '21:30',
                    frequency_mins: 15,
                    estimated_duration_min: 15,
                    fare_inr: 10.00
                },
                {
                    transit_mode: 'kmt_bus',
                    operator_name: 'KMT (Kolhapur Municipal Transport)',
                    route_number: 'Route 7',
                    route_name: 'Rankala Lake ⇄ Kolhapur Airport',
                    origin_name: 'Rankala Lake',
                    origin_lat: 16.6876,
                    origin_lng: 74.2195,
                    destination_name: 'Kolhapur Airport',
                    destination_lat: 16.6640,
                    destination_lng: 74.2894,
                    stops: 'Rankala Stand, Bindu Chowk, Rajarampuri, Shivaji University, Ujalaiwadi, Kolhapur Airport',
                    first_departure: '06:00',
                    last_departure: '20:30',
                    frequency_mins: 30,
                    estimated_duration_min: 40,
                    fare_inr: 25.00
                },
                {
                    transit_mode: 'kmt_bus',
                    operator_name: 'KMT (Kolhapur Municipal Transport)',
                    route_number: 'Route 8',
                    route_name: 'CBS ⇄ Gandhinagar & Uchgaon',
                    origin_name: 'CBS (Central Bus Stand)',
                    origin_lat: 16.6982,
                    origin_lng: 74.2330,
                    destination_name: 'Uchgaon',
                    destination_lat: 16.6558,
                    destination_lng: 74.2654,
                    stops: 'CBS, Station Road, Shahupuri, Market Yard, Gandhinagar Phata, Uchgaon',
                    first_departure: '06:30',
                    last_departure: '22:00',
                    frequency_mins: 15,
                    estimated_duration_min: 25,
                    fare_inr: 14.00
                },
                {
                    transit_mode: 'kmt_bus',
                    operator_name: 'KMT (Kolhapur Municipal Transport)',
                    route_number: 'Route 9',
                    route_name: 'Vivekanand College ⇄ RK Nagar',
                    origin_name: 'Vivekanand College',
                    origin_lat: 16.7041,
                    origin_lng: 74.2264,
                    destination_name: 'RK Nagar',
                    destination_lat: 16.7069,
                    destination_lng: 74.2193,
                    stops: 'Vivekanand College, Nagala Park, Tarabai Park, Station Road, RK Nagar',
                    first_departure: '07:00',
                    last_departure: '21:00',
                    frequency_mins: 20,
                    estimated_duration_min: 24,
                    fare_inr: 14.00
                },
                {
                    transit_mode: 'kmt_bus',
                    operator_name: 'KMT (Kolhapur Municipal Transport)',
                    route_number: 'Route 10',
                    route_name: 'DY Patil College ⇄ Rajarampuri',
                    origin_name: 'DY Patil College',
                    origin_lat: 16.6950,
                    origin_lng: 74.2440,
                    destination_name: 'Rajarampuri',
                    destination_lat: 16.7025,
                    destination_lng: 74.2329,
                    stops: 'DY Patil College, Kasaba Bawada, CPR, Dabholkar Corner, Rajarampuri',
                    first_departure: '07:00',
                    last_departure: '21:30',
                    frequency_mins: 15,
                    estimated_duration_min: 22,
                    fare_inr: 12.00
                },
                {
                    transit_mode: 'msrtc_bus',
                    operator_name: 'MSRTC State Transport',
                    route_number: 'MSRTC-01',
                    route_name: 'Kolhapur CBS ⇄ Ichalkaranji Stand',
                    origin_name: 'CBS (Central Bus Stand)',
                    origin_lat: 16.6982,
                    origin_lng: 74.2330,
                    destination_name: 'Shiroli MIDC',
                    destination_lat: 16.6884,
                    destination_lng: 74.3167,
                    stops: 'CBS, Kawala Naka, Shiroli Naka, Hatkanangale, Ichalkaranji',
                    first_departure: '05:30',
                    last_departure: '23:00',
                    frequency_mins: 15,
                    estimated_duration_min: 45,
                    fare_inr: 35.00
                },
                {
                    transit_mode: 'train',
                    operator_name: 'Indian Railways (Central Railway)',
                    route_number: 'DEMU 07384',
                    route_name: 'CSMT Kolhapur ⇄ Miraj Junction',
                    origin_name: 'Kolhapur Railway Station',
                    origin_lat: 16.6889,
                    origin_lng: 74.2355,
                    destination_name: 'Shiroli MIDC',
                    destination_lat: 16.6884,
                    destination_lng: 74.3167,
                    stops: 'Kolhapur CSMT, Valivade, Rukadi, Hatkanangale, Nimshirgaon, Jaysingpur, Miraj Jn',
                    first_departure: '06:15',
                    last_departure: '21:10',
                    frequency_mins: 60,
                    estimated_duration_min: 40,
                    fare_inr: 15.00
                },
                {
                    transit_mode: 'shared_auto',
                    operator_name: 'Kolhapur Auto Rickshaw Union',
                    route_number: 'Auto-Share 1',
                    route_name: 'CBS Stand ⇄ Rajarampuri',
                    origin_name: 'CBS (Central Bus Stand)',
                    origin_lat: 16.6982,
                    origin_lng: 74.2330,
                    destination_name: 'Rajarampuri',
                    destination_lat: 16.7025,
                    destination_lng: 74.2329,
                    stops: 'CBS Stand, Station Road, Shahupuri, Rajarampuri Janta Chowk',
                    first_departure: '06:00',
                    last_departure: '23:30',
                    frequency_mins: 5,
                    estimated_duration_min: 12,
                    fare_inr: 15.00
                },
                {
                    transit_mode: 'shared_auto',
                    operator_name: 'Kolhapur Auto Rickshaw Union',
                    route_number: 'Auto-Share 2',
                    route_name: 'Railway Station ⇄ Shivaji University',
                    origin_name: 'Kolhapur Railway Station',
                    origin_lat: 16.6889,
                    origin_lng: 74.2355,
                    destination_name: 'Shivaji University',
                    destination_lat: 16.6823,
                    destination_lng: 74.2489,
                    stops: 'Station Stand, Dabholkar Corner, Cyber Chowk, Shivaji University Gate',
                    first_departure: '06:00',
                    last_departure: '23:30',
                    frequency_mins: 5,
                    estimated_duration_min: 14,
                    fare_inr: 20.00
                }
            ];

            for (const r of transitRoutesToSeed) {
                await pool.query(`
                    INSERT INTO public_transit_routes (
                        transit_mode, operator_name, route_number, route_name,
                        origin_name, origin_lat, origin_lng, destination_name,
                        destination_lat, destination_lng, stops, first_departure,
                        last_departure, frequency_mins, estimated_duration_min, fare_inr, is_active
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, true)
                `, [
                    r.transit_mode, r.operator_name, r.route_number, r.route_name,
                    r.origin_name, r.origin_lat, r.origin_lng, r.destination_name,
                    r.destination_lat, r.destination_lng, r.stops, r.first_departure,
                    r.last_departure, r.frequency_mins, r.estimated_duration_min, r.fare_inr
                ]);
            }
            console.log(`[PostgreSQL] Seeded ${transitRoutesToSeed.length} real Kolhapur public transit routes.`);
        }

        console.log('[PostgreSQL] Database tables and seed data ready.');
    } catch (err) {
        console.error('[PostgreSQL] Database initialization error:', err);
        throw err;
    }
}

// Export database wrapper and initialization promise
const db = {
    pool,
    query,
    get,
    all,
    run,
    prepare,
    transaction,
    initializeDatabase,
    initPromise: initializeDatabase()
};

module.exports = db;
