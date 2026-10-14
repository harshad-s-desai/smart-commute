const express = require('express');
const router = express.Router();
const db = require('../database/init');

/**
 * Haversine formula to compute distance in km
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
 * GET /api/transit/compare
 * Compare rideshare, public transit, and private transport options
 */
router.get('/compare', async (req, res, next) => {
    try {
        const { origin_lat, origin_lng, dest_lat, dest_lng } = req.query;

        if (!origin_lat || !origin_lng || !dest_lat || !dest_lng) {
            return res.status(400).json({ error: 'origin_lat, origin_lng, dest_lat, and dest_lng are required.' });
        }

        const oLat = parseFloat(origin_lat);
        const oLng = parseFloat(origin_lng);
        const dLat = parseFloat(dest_lat);
        const dLng = parseFloat(dest_lng);

        if (isNaN(oLat) || isNaN(oLng) || isNaN(dLat) || isNaN(dLng)) {
            return res.status(400).json({ error: 'Coordinates must be valid numbers.' });
        }

        // Distance in km (straight line * 1.25 road winding factor)
        const straightDistance = haversineDistance(oLat, oLng, dLat, dLng);
        const roadDistance = parseFloat((straightDistance * 1.25).toFixed(2));
        const effectiveDist = Math.max(roadDistance, 1.0); // minimum 1 km

        // Base car driving time in minutes (estimated at average city speed of 25 km/h in Kolhapur)
        const baseCarTimeMin = Math.max(Math.round((effectiveDist / 25) * 60), 6);

        // 1. Rideshare matching from DB within 3km of origin and destination
        const allActiveRides = await db.prepare(`
            SELECT r.*, u.name as driver_name, u.mobile as driver_mobile, u.gender as driver_gender, u.is_verified as driver_verified
            FROM rides r
            JOIN users u ON r.user_id = u.id
            WHERE r.status = 'active' AND r.available_seats > 0
        `).all();

const { evaluateCorridorMatch } = require('./rides');

        const matchingRides = allActiveRides.filter(ride => {
            const seekerPickup = { lat: oLat, lng: oLng };
            const seekerDropoff = { lat: dLat, lng: dLng };
            return !!evaluateCorridorMatch(ride, seekerPickup, seekerDropoff, {
                maxPickupRadius: 3.5,
                maxCrossTrack: 2.8,
                maxDetourKm: 5.0
            });
        });

        let rideshareAvgCost = 0;
        let rideshareAvgTime = baseCarTimeMin;

        if (matchingRides.length > 0) {
            const sumCost = matchingRides.reduce((acc, r) => acc + r.fare_per_seat, 0);
            rideshareAvgCost = Math.round(sumCost / matchingRides.length);
        } else {
            // Estimated typical carpool fare based on distance: ~₹4/km + base ₹15
            rideshareAvgCost = Math.max(Math.round(15 + effectiveDist * 4), 20);
        }

        const rideshare = {
            available: matchingRides.length > 0,
            rides: matchingRides,
            avg_cost: rideshareAvgCost,
            avg_time: rideshareAvgTime
        };

        // 2. Public Transit Options
        // Bus: ₹2/km (min ₹10), 1.5x car time, every 15-20 min
        const busCost = Math.max(Math.round(effectiveDist * 2), 10);
        const busTime = Math.round(baseCarTimeMin * 1.5);

        // Auto: ₹15 base + ₹12/km, 1.1x car time
        const autoCost = Math.round(15 + (effectiveDist * 12));
        const autoTime = Math.round(baseCarTimeMin * 1.1);

        // Shared Auto: ~₹10 base + ₹4/km
        const sharedAutoCost = Math.max(Math.round(10 + (effectiveDist * 4)), 15);
        const sharedAutoTime = Math.round(baseCarTimeMin * 1.2);

        const publicOptions = [
            {
                type: 'bus',
                name: 'KMT City Bus',
                cost: busCost,
                time: busTime,
                frequency: 'Every 15-20 min',
                co2_savings_kg: parseFloat((effectiveDist * 0.12).toFixed(2)),
                notes: 'Kolhapur Municipal Transport standard city service'
            },
            {
                type: 'shared_auto',
                name: 'Shared Auto-rickshaw',
                cost: sharedAutoCost,
                time: sharedAutoTime,
                frequency: 'Every 5-10 min',
                co2_savings_kg: parseFloat((effectiveDist * 0.08).toFixed(2)),
                notes: 'High-frequency shared transit on major roads'
            }
        ];

        const publicAvgCost = Math.round((busCost + sharedAutoCost) / 2);
        const publicAvgTime = Math.round((busTime + sharedAutoTime) / 2);

        const publicTransit = {
            options: publicOptions,
            avg_cost: publicAvgCost,
            avg_time: publicAvgTime
        };

        // 3. Private Transport
        // Private Cab/Taxi: ₹50 base + ₹15/km
        const cabCost = Math.round(50 + (effectiveDist * 15));
        const cabTime = baseCarTimeMin;

        const privateTransport = {
            cost: cabCost,
            time: cabTime,
            taxi: {
                name: 'Private Cab (Ola/Taxi)',
                cost: cabCost,
                time: cabTime
            },
            auto: {
                name: 'Private Auto-rickshaw',
                cost: autoCost,
                time: autoTime
            }
        };

        res.json({
            distance_km: effectiveDist,
            rideshare,
            public: publicTransit,
            private: privateTransport
        });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/transit/route
 * Proxy to OSRM router for route geometry, distance, and duration with resilient fallback
 */
router.get('/route', async (req, res, next) => {
    try {
        const { start_lat, start_lng, end_lat, end_lng } = req.query;

        if (!start_lat || !start_lng || !end_lat || !end_lng) {
            return res.status(400).json({ error: 'start_lat, start_lng, end_lat, and end_lng are required.' });
        }

        const sLat = parseFloat(start_lat);
        const sLng = parseFloat(start_lng);
        const eLat = parseFloat(end_lat);
        const eLng = parseFloat(end_lng);

        if (isNaN(sLat) || isNaN(sLng) || isNaN(eLat) || isNaN(eLng)) {
            return res.status(400).json({ error: 'Coordinates must be valid numbers.' });
        }

        // Try calling project OSRM public API with timeout
        try {
            const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${sLng},${sLat};${eLng},${eLat}?overview=full&geometries=geojson`;
            const osrmRes = await fetch(osrmUrl, { signal: AbortSignal.timeout(3500) });

            if (osrmRes.ok) {
                const data = await osrmRes.json();
                if (data.routes && data.routes.length > 0) {
                    const primary = data.routes[0];
                    return res.json({
                        route_geometry: primary.geometry,
                        distance_km: parseFloat((primary.distance / 1000).toFixed(2)),
                        duration_min: Math.max(1, Math.round(primary.duration / 60))
                    });
                }
            }
        } catch (fetchErr) {
            console.warn('OSRM request timed out or failed, using geometric fallback calculation:', fetchErr.message);
        }

        // Robust Geometric Fallback if OSRM is unreachable
        const straightDist = haversineDistance(sLat, sLng, eLat, eLng);
        const roadDist = parseFloat((straightDist * 1.25).toFixed(2));
        const estimatedDuration = Math.max(Math.round((roadDist / 25) * 60), 4);

        // Simple GeoJSON LineString geometry
        const fallbackGeometry = {
            type: 'LineString',
            coordinates: [
                [sLng, sLat],
                [(sLng + eLng) / 2 + 0.001, (sLat + eLat) / 2 - 0.001],
                [eLng, eLat]
            ]
        };

        return res.json({
            route_geometry: fallbackGeometry,
            distance_km: roadDist,
            duration_min: estimatedDuration,
            fallback: true
        });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/transit/stations
 * Return all registered Kolhapur stations
 */
router.get('/stations', async (req, res, next) => {
    try {
        const stations = await db.prepare('SELECT * FROM stations ORDER BY name ASC').all();
        res.json({ stations });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/transit/stations/search
 * Search stations by name substring
 */
router.get('/stations/search', async (req, res, next) => {
    try {
        const query = req.query.q || '';
        const stations = await db.prepare('SELECT * FROM stations WHERE name ILIKE ? ORDER BY name ASC').all(`%${query}%`);
        res.json({ stations });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
