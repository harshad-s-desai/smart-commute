const express = require('express');
const router = express.Router();
const db = require('../database/init');
const { auth } = require('../middleware/auth');

/**
 * Haversine formula to compute distance in km between two lat/lng coordinates
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Project point P onto line segment AB in lat/lng coordinate space.
 * Returns projection parameter t (0 = at A, 1 = at B), clamped t, and projected coordinates.
 */
function projectPointOntoSegment(pLat, pLng, aLat, aLng, bLat, bLng) {
    const dLat = bLat - aLat;
    const dLng = bLng - aLng;
    const lenSq = dLat * dLat + dLng * dLng;

    if (lenSq < 1e-12) {
        return {
            t: 0,
            t_clamp: 0,
            projLat: aLat,
            projLng: aLng
        };
    }

    const t = ((pLat - aLat) * dLat + (pLng - aLng) * dLng) / lenSq;
    const t_clamp = Math.max(0, Math.min(1, t));

    return {
        t,
        t_clamp,
        projLat: aLat + t_clamp * dLat,
        projLng: aLng + t_clamp * dLng
    };
}

/**
 * Add minutes to a time string like "08:30" or "23:00" and return "08:35" or "23:05"
 */
function addMinutesToTime(timeStr, minutesToAdd) {
    if (!timeStr || !timeStr.includes(':')) return timeStr;
    const [h, m] = timeStr.split(':').map(x => parseInt(x, 10));
    if (isNaN(h) || isNaN(m)) return timeStr;

    const totalMinutes = (h * 60 + m + Math.round(minutesToAdd)) % (24 * 60);
    const finalH = Math.floor(totalMinutes / 60);
    const finalM = totalMinutes % 60;
    return `${String(finalH).padStart(2, '0')}:${String(finalM).padStart(2, '0')}`;
}

/**
 * En-Route Trajectory Corridor Matching Engine
 * Evaluates whether a driver ride (Origin O -> Destination D) serves a seeker's pickup P (and optional dropoff Q)
 */
function evaluateCorridorMatch(ride, seekerPickup, seekerDropoff = null, options = {}) {
    const {
        maxPickupRadius = 3.5,     // Max km for direct start or detour
        maxCrossTrack = 2.5,       // Max km perpendicular distance from route corridor
        maxDetourKm = 4.5          // Max extra km driver must travel
    } = options;

    const oLat = ride.origin_lat;
    const oLng = ride.origin_lng;
    const dLat = ride.destination_lat;
    const dLng = ride.destination_lng;

    // Driver's direct distance
    const driverTripDist = haversineDistance(oLat, oLng, dLat, dLng);

    // 1. Evaluate Seeker Pickup (P)
    const distOriginToP = haversineDistance(oLat, oLng, seekerPickup.lat, seekerPickup.lng);
    const distPToDest = haversineDistance(seekerPickup.lat, seekerPickup.lng, dLat, dLng);

    // Project P onto driver's route segment OD
    const pProj = projectPointOntoSegment(seekerPickup.lat, seekerPickup.lng, oLat, oLng, dLat, dLng);
    const crossTrackP = haversineDistance(seekerPickup.lat, seekerPickup.lng, pProj.projLat, pProj.projLng);

    // Detour for pickup alone: (O -> P -> D) - (O -> D)
    const detourP = Math.max(0, (distOriginToP + distPToDest) - driverTripDist);

    // Pickup Eligibility criteria:
    // a) Direct origin proximity: <= 2.5 km
    // b) En-route corridor crossing: cross-track <= maxCrossTrack AND projection parameter between -0.25 and 0.95
    // c) Low detour: detourP <= maxPickupRadius AND not past destination (pProj.t <= 0.98)
    const isDirectOrigin = distOriginToP <= 2.5;
    const isCorridorEnRoute = crossTrackP <= maxCrossTrack && pProj.t >= -0.25 && pProj.t <= 0.95;
    const isLowDetour = detourP <= maxPickupRadius && pProj.t <= 0.98;

    if (!isDirectOrigin && !isCorridorEnRoute && !isLowDetour) {
        return null; // Not along this driver's path
    }

    // 2. If Seeker provided a Dropoff (Q), evaluate dropoff along the route
    let dropoffData = null;
    let totalDetour = detourP;

    if (seekerDropoff && !isNaN(seekerDropoff.lat) && !isNaN(seekerDropoff.lng)) {
        const distDestToQ = haversineDistance(dLat, dLng, seekerDropoff.lat, seekerDropoff.lng);
        const distPToQ = haversineDistance(seekerPickup.lat, seekerPickup.lng, seekerDropoff.lat, seekerDropoff.lng);

        const qProj = projectPointOntoSegment(seekerDropoff.lat, seekerDropoff.lng, oLat, oLng, dLat, dLng);
        const crossTrackQ = haversineDistance(seekerDropoff.lat, seekerDropoff.lng, qProj.projLat, qProj.projLng);

        // Detour for both P and Q: (O -> P -> Q -> D) - (O -> D)
        totalDetour = Math.max(0, (distOriginToP + distPToQ + distDestToQ) - driverTripDist);

        // Dropoff eligibility: Seeker dropoff must be near driver destination or directly along corridor
        const isDirectDest = distDestToQ <= 2.5;
        const isCorridorDropoff = crossTrackQ <= 1.8 && qProj.t >= 0.1 && qProj.t <= 1.05;

        if (!isDirectDest && !isCorridorDropoff) {
            return null; // Driver does not go towards seeker's destination
        }

        // Hard detour limit: driver shouldn't detour excessively
        if (totalDetour > maxDetourKm) {
            return null;
        }

        // Progression check: Pickup must occur before dropoff along driver's path
        if (pProj.t >= qProj.t + 0.05) {
            return null; // Heading wrong direction along the corridor (opposite to driver)
        }

        // Direction Vector Alignment: Check if seeker's vector (P -> Q) points in same general direction as driver's vector (O -> D)
        const driverVectorLat = dLat - oLat;
        const driverVectorLng = dLng - oLng;
        const seekerVectorLat = seekerDropoff.lat - seekerPickup.lat;
        const seekerVectorLng = seekerDropoff.lng - seekerPickup.lng;

        const dotProduct = (seekerVectorLat * driverVectorLat) + (seekerVectorLng * driverVectorLng);
        const seekerMag = Math.sqrt(seekerVectorLat * seekerVectorLat + seekerVectorLng * seekerVectorLng);
        const driverMag = Math.sqrt(driverVectorLat * driverVectorLat + driverVectorLng * driverVectorLng);

        if (seekerMag > 0.001 && driverMag > 0.001) {
            const cosAngle = dotProduct / (seekerMag * driverMag);
            if (cosAngle < 0.25) {
                return null; // Opposite or perpendicular direction
            }
        }

        dropoffData = {
            dist_dest_km: parseFloat(distDestToQ.toFixed(2)),
            cross_track_km: parseFloat(crossTrackQ.toFixed(2)),
            q_progress_t: parseFloat(qProj.t_clamp.toFixed(2)),
            proj_lat: parseFloat(qProj.projLat.toFixed(5)),
            proj_lng: parseFloat(qProj.projLng.toFixed(5))
        };
    }

    // 3. Timing estimation
    // Average city speed: ~25 km/h (~2.4 minutes per km)
    const tripEstMinutes = Math.max(8, Math.round(driverTripDist * 2.4));
    const pickupMinutesOffset = Math.max(0, Math.round(pProj.t_clamp * tripEstMinutes));
    const estimatedPickupTime = addMinutesToTime(ride.time || '08:00', pickupMinutesOffset);

    // 4. Match badge & Classification
    let matchType = 'en_route';
    let matchBadge = "On Driver's Route";
    let matchDescription = `Driver passes near your pickup (${Math.round(crossTrackP * 1000)}m away)`;

    if (distOriginToP <= 0.8) {
        matchType = 'direct';
        matchBadge = 'Direct Pickup';
        matchDescription = 'Driver starts within walking distance of your location';
    } else if (pProj.t >= 0.05 && crossTrackP <= 1.8) {
        matchType = 'en_route';
        matchBadge = "On Driver's Route";
        matchDescription = `Driver passes your area at approx ${estimatedPickupTime}`;
    } else {
        matchType = 'corridor';
        matchBadge = 'Corridor Pickup';
        matchDescription = `Driver can pick you up with a minimal detour (+${detourP.toFixed(1)} km)`;
    }

    // 5. Match Quality Score (0 to 100)
    // Closer to pickup and smaller detour = higher score
    const pickupPenalty = Math.min(45, (crossTrackP * 12) + (distOriginToP * 4));
    const detourPenalty = Math.min(35, totalDetour * 8);
    const matchScore = Math.max(20, Math.round(100 - pickupPenalty - detourPenalty));

    return {
        match_type: matchType,
        match_badge: matchBadge,
        match_description: matchDescription,
        match_score: matchScore,
        origin_distance_km: parseFloat(distOriginToP.toFixed(2)),
        cross_track_km: parseFloat(crossTrackP.toFixed(2)),
        pickup_distance_km: parseFloat(Math.min(distOriginToP, crossTrackP).toFixed(2)),
        detour_km: parseFloat(totalDetour.toFixed(2)),
        progress_t: parseFloat(pProj.t_clamp.toFixed(2)),
        estimated_pickup_time: estimatedPickupTime,
        pickup_minutes_offset: pickupMinutesOffset,
        pickup_proj_lat: parseFloat(pProj.projLat.toFixed(5)),
        pickup_proj_lng: parseFloat(pProj.projLng.toFixed(5)),
        dropoff: dropoffData
    };
}

/**
 * GET /api/rides/my/offered
 * Get all rides offered by the logged-in user
 */
router.get('/my/offered', auth, async (req, res, next) => {
    try {
        const rides = await db.prepare(`
            SELECT r.*,
                   (SELECT COUNT(*) FROM bookings b WHERE b.ride_id = r.id AND b.status != 'cancelled') AS total_bookings
            FROM rides r
            WHERE r.user_id = ?
            ORDER BY r.date DESC, r.time DESC
        `).all(req.user.id);

        // Fetch bookings for each ride
        const getBookingsStmt = db.prepare(`
            SELECT b.*, u.name as passenger_name, u.mobile as passenger_mobile, u.gender as passenger_gender
            FROM bookings b
            JOIN users u ON b.passenger_id = u.id
            WHERE b.ride_id = ?
            ORDER BY b.created_at DESC
        `);

        const ridesWithBookings = [];
        for (const ride of rides) {
            const bookings = await getBookingsStmt.all(ride.id);
            ridesWithBookings.push({
                ...ride,
                bookings
            });
        }

        res.json({ rides: ridesWithBookings });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/rides/my/booked
 * Get all rides booked by the logged-in user
 */
router.get('/my/booked', auth, async (req, res, next) => {
    try {
        const bookings = await db.prepare(`
            SELECT b.id AS booking_id, b.seats_booked, b.status AS booking_status, b.created_at AS booked_at,
                   r.*,
                   u.name AS driver_name, u.mobile AS driver_mobile, u.gender AS driver_gender, u.is_verified AS driver_verified
            FROM bookings b
            JOIN rides r ON b.ride_id = r.id
            JOIN users u ON r.user_id = u.id
            WHERE b.passenger_id = ?
            ORDER BY r.date DESC, r.time DESC
        `).all(req.user.id);

        res.json({ bookings });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/rides
 * Query rides with En-Route Trajectory Corridor Matching, date, and gender filters
 */
router.get('/', async (req, res, next) => {
    try {
        const {
            origin_lat,
            origin_lng,
            dest_lat,
            dest_lng,
            date,
            gender_preference,
            vehicle_type,
            max_fare,
            radius = 3.5
        } = req.query;

        let query = `
            SELECT r.*,
                   u.name AS driver_name,
                   u.mobile AS driver_mobile,
                   u.gender AS driver_gender,
                   u.is_verified AS driver_verified
            FROM rides r
            JOIN users u ON r.user_id = u.id
            WHERE r.status = 'active' AND r.available_seats > 0
        `;
        const params = [];

        if (date) {
            query += ` AND r.date = ?`;
            params.push(date);
        }

        if (gender_preference && gender_preference !== 'any') {
            query += ` AND (r.gender_preference = 'any' OR r.gender_preference = ?)`;
            params.push(gender_preference);
        }

        if (vehicle_type) {
            query += ` AND r.vehicle_type = ?`;
            params.push(vehicle_type);
        }

        if (max_fare) {
            query += ` AND r.fare_per_seat <= ?`;
            params.push(parseFloat(max_fare));
        }

        query += ` ORDER BY r.date ASC, r.time ASC, r.fare_per_seat ASC`;

        let rawRides = await db.prepare(query).all(...params);

        const oLat = parseFloat(origin_lat);
        const oLng = parseFloat(origin_lng);
        const dLat = parseFloat(dest_lat);
        const dLng = parseFloat(dest_lng);
        const searchRadius = parseFloat(radius) || 3.5;

        let filteredRides = [];

        if (!isNaN(oLat) && !isNaN(oLng)) {
            const seekerPickup = { lat: oLat, lng: oLng };
            const seekerDropoff = (!isNaN(dLat) && !isNaN(dLng)) ? { lat: dLat, lng: dLng } : null;

            for (const ride of rawRides) {
                const matchResult = evaluateCorridorMatch(ride, seekerPickup, seekerDropoff, {
                    maxPickupRadius: searchRadius,
                    maxCrossTrack: searchRadius * 0.8,
                    maxDetourKm: searchRadius * 1.5
                });

                if (matchResult) {
                    filteredRides.push({
                        ...ride,
                        ...matchResult
                    });
                }
            }

            // Sort matched rides by match_score DESC, then fare ASC
            filteredRides.sort((a, b) => (b.match_score - a.match_score) || (a.fare_per_seat - b.fare_per_seat));
        } else {
            // No origin coordinates supplied: return all active rides
            filteredRides = rawRides.map(ride => ({
                ...ride,
                match_type: 'general',
                match_badge: 'Active Ride',
                match_description: `${ride.origin_name} to ${ride.destination_name}`,
                match_score: 80,
                estimated_pickup_time: ride.time
            }));
        }

        res.json({ rides: filteredRides });
    } catch (err) {
        next(err);
    }
});

/**
 * POST /api/rides
 * Offer a new ride
 */
router.post('/', auth, async (req, res, next) => {
    try {
        const {
            origin_name,
            origin_lat,
            origin_lng,
            destination_name,
            destination_lat,
            destination_lng,
            date,
            time,
            vehicle_type = 'car',
            available_seats = 1,
            fare_per_seat = 0,
            notes = '',
            gender_preference = 'any'
        } = req.body;

        if (!origin_name || !destination_name || origin_lat === undefined || origin_lng === undefined ||
            destination_lat === undefined || destination_lng === undefined || !date || !time) {
            return res.status(400).json({ error: 'Origin, destination, coordinates, date, and time are required.' });
        }

        const seats = parseInt(available_seats, 10);
        if (isNaN(seats) || seats < 1) {
            return res.status(400).json({ error: 'Available seats must be at least 1.' });
        }

        const fare = parseFloat(fare_per_seat);
        if (isNaN(fare) || fare < 0) {
            return res.status(400).json({ error: 'Fare per seat cannot be negative.' });
        }

        const validVehicleTypes = ['car', 'bike', 'auto'];
        if (!validVehicleTypes.includes(vehicle_type)) {
            return res.status(400).json({ error: 'Vehicle type must be car, bike, or auto.' });
        }

        const validGenderPrefs = ['any', 'male', 'female'];
        if (!validGenderPrefs.includes(gender_preference)) {
            return res.status(400).json({ error: 'Gender preference must be any, male, or female.' });
        }

        const insertStmt = db.prepare(`
            INSERT INTO rides (
                user_id, origin_name, origin_lat, origin_lng,
                destination_name, destination_lat, destination_lng,
                date, time, vehicle_type, available_seats,
                fare_per_seat, notes, gender_preference, status
            ) VALUES (
                ?, ?, ?, ?,
                ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?, 'active'
            )
        `);

        const result = await insertStmt.run(
            req.user.id,
            origin_name.trim(),
            parseFloat(origin_lat),
            parseFloat(origin_lng),
            destination_name.trim(),
            parseFloat(destination_lat),
            parseFloat(destination_lng),
            date,
            time,
            vehicle_type,
            seats,
            fare,
            notes ? notes.trim() : '',
            gender_preference
        );

        const newRide = await db.prepare('SELECT * FROM rides WHERE id = ?').get(result.lastInsertRowid);
        res.status(201).json({ ride: newRide });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/rides/:id
 * Get single ride with driver information and confirmed bookings
 */
router.get('/:id', async (req, res, next) => {
    try {
        const rideId = req.params.id;
        const ride = await db.prepare('SELECT * FROM rides WHERE id = ?').get(rideId);
        if (!ride) {
            return res.status(404).json({ error: 'Ride not found' });
        }

        const driver = await db.prepare(`
            SELECT id, name, email, mobile, gender, age, is_verified, created_at
            FROM users
            WHERE id = ?
        `).get(ride.user_id);

        const bookings = await db.prepare(`
            SELECT b.*, u.name as passenger_name, u.gender as passenger_gender
            FROM bookings b
            JOIN users u ON b.passenger_id = u.id
            WHERE b.ride_id = ?
        `).all(rideId);

        res.json({ ride, driver, bookings });
    } catch (err) {
        next(err);
    }
});

/**
 * PUT /api/rides/:id
 * Update ride details (only by driver)
 */
router.put('/:id', auth, async (req, res, next) => {
    try {
        const rideId = req.params.id;
        const ride = await db.prepare('SELECT * FROM rides WHERE id = ?').get(rideId);
        if (!ride) {
            return res.status(404).json({ error: 'Ride not found' });
        }

        if (ride.user_id !== req.user.id && req.user.is_admin !== 1) {
            return res.status(403).json({ error: 'You are not authorized to update this ride.' });
        }

        const {
            origin_name, origin_lat, origin_lng,
            destination_name, destination_lat, destination_lng,
            date, time, vehicle_type, available_seats,
            fare_per_seat, notes, gender_preference, status
        } = req.body;

        const updates = [];
        const params = [];

        if (origin_name !== undefined) { updates.push('origin_name = ?'); params.push(origin_name.trim()); }
        if (origin_lat !== undefined) { updates.push('origin_lat = ?'); params.push(parseFloat(origin_lat)); }
        if (origin_lng !== undefined) { updates.push('origin_lng = ?'); params.push(parseFloat(origin_lng)); }
        if (destination_name !== undefined) { updates.push('destination_name = ?'); params.push(destination_name.trim()); }
        if (destination_lat !== undefined) { updates.push('destination_lat = ?'); params.push(parseFloat(destination_lat)); }
        if (destination_lng !== undefined) { updates.push('destination_lng = ?'); params.push(parseFloat(destination_lng)); }
        if (date !== undefined) { updates.push('date = ?'); params.push(date); }
        if (time !== undefined) { updates.push('time = ?'); params.push(time); }
        if (vehicle_type !== undefined) { updates.push('vehicle_type = ?'); params.push(vehicle_type); }
        if (available_seats !== undefined) { updates.push('available_seats = ?'); params.push(parseInt(available_seats, 10)); }
        if (fare_per_seat !== undefined) { updates.push('fare_per_seat = ?'); params.push(parseFloat(fare_per_seat)); }
        if (notes !== undefined) { updates.push('notes = ?'); params.push(notes ? notes.trim() : ''); }
        if (gender_preference !== undefined) { updates.push('gender_preference = ?'); params.push(gender_preference); }
        if (status !== undefined) { updates.push('status = ?'); params.push(status); }

        if (updates.length > 0) {
            params.push(rideId);
            await db.prepare(`UPDATE rides SET ${updates.join(', ')} WHERE id = ?`).run(...params);
        }

        const updatedRide = await db.prepare('SELECT * FROM rides WHERE id = ?').get(rideId);
        res.json({ ride: updatedRide });
    } catch (err) {
        next(err);
    }
});

/**
 * DELETE /api/rides/:id
 * Delete or cancel a ride
 */
router.delete('/:id', auth, async (req, res, next) => {
    try {
        const rideId = req.params.id;
        const ride = await db.prepare('SELECT * FROM rides WHERE id = ?').get(rideId);
        if (!ride) {
            return res.status(404).json({ error: 'Ride not found' });
        }

        if (ride.user_id !== req.user.id && req.user.is_admin !== 1) {
            return res.status(403).json({ error: 'You are not authorized to cancel this ride.' });
        }

        await db.transaction(async (tx) => {
            await tx.prepare("UPDATE bookings SET status = 'cancelled' WHERE ride_id = ?").run(rideId);
            await tx.prepare("UPDATE rides SET status = 'cancelled' WHERE id = ?").run(rideId);
        });

        res.json({ success: true, message: 'Ride and associated bookings cancelled successfully.' });
    } catch (err) {
        next(err);
    }
});

/**
 * POST /api/rides/:id/book
 * Book seats on a ride
 */
router.post('/:id/book', auth, async (req, res, next) => {
    try {
        const rideId = req.params.id;
        const seatsRequested = parseInt(req.body.seats_booked || 1, 10);

        if (isNaN(seatsRequested) || seatsRequested < 1) {
            return res.status(400).json({ error: 'Invalid number of seats requested.' });
        }

        const ride = await db.prepare('SELECT * FROM rides WHERE id = ?').get(rideId);
        if (!ride) {
            return res.status(404).json({ error: 'Ride not found' });
        }

        if (ride.status !== 'active') {
            return res.status(400).json({ error: 'This ride is no longer active.' });
        }

        if (ride.user_id === req.user.id) {
            return res.status(400).json({ error: 'You cannot book your own offered ride.' });
        }

        // Check gender preference
        if (ride.gender_preference !== 'any' && req.user.gender !== ride.gender_preference) {
            return res.status(400).json({
                error: `This ride is reserved for ${ride.gender_preference} passengers only.`
            });
        }

        if (ride.available_seats < seatsRequested) {
            return res.status(400).json({
                error: `Only ${ride.available_seats} seat(s) currently available.`
            });
        }

        // Check if user already has an active booking for this ride
        const existingBooking = await db.prepare(`
            SELECT id FROM bookings 
            WHERE ride_id = ? AND passenger_id = ? AND status IN ('pending', 'confirmed')
        `).get(rideId, req.user.id);

        if (existingBooking) {
            return res.status(400).json({ error: 'You have already booked seats on this ride.' });
        }

        // Perform booking transaction: insert booking and decrement available_seats
        const newBookingId = await db.transaction(async (tx) => {
            const insertBooking = tx.prepare(`
                INSERT INTO bookings (ride_id, passenger_id, seats_booked, status)
                VALUES (?, ?, ?, 'confirmed')
            `);
            const bookingResult = await insertBooking.run(rideId, req.user.id, seatsRequested);

            const updateSeats = tx.prepare(`
                UPDATE rides 
                SET available_seats = available_seats - ? 
                WHERE id = ?
            `);
            await updateSeats.run(seatsRequested, rideId);

            return bookingResult.lastInsertRowid;
        });

        const booking = await db.prepare('SELECT * FROM bookings WHERE id = ?').get(newBookingId);

        res.status(201).json({
            message: 'Ride booked successfully!',
            booking
        });
    } catch (err) {
        next(err);
    }
});

router.haversineDistance = haversineDistance;
router.projectPointOntoSegment = projectPointOntoSegment;
router.evaluateCorridorMatch = evaluateCorridorMatch;
router.addMinutesToTime = addMinutesToTime;
module.exports = router;
