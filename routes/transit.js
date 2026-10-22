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
 * Compute the next departure time and timetable string
 */
function computeNextDeparture(firstDep = '06:00', lastDep = '22:30', freqMins = 15, refDate = new Date()) {
    const parseTime = (tStr) => {
        const [h, m] = (tStr || '00:00').split(':').map(Number);
        return (h || 0) * 60 + (m || 0);
    };

    const firstMins = parseTime(firstDep);
    const lastMins = parseTime(lastDep);
    const nowMins = refDate.getHours() * 60 + refDate.getMinutes();

    let nextMins = firstMins;
    if (nowMins > lastMins) {
        nextMins = firstMins;
    } else if (nowMins <= firstMins) {
        nextMins = firstMins;
    } else {
        const elapsed = nowMins - firstMins;
        const cycles = Math.ceil(elapsed / Math.max(1, freqMins));
        nextMins = firstMins + (cycles * freqMins);
        if (nextMins > lastMins) nextMins = firstMins;
    }

    const nH = Math.floor(nextMins / 60) % 24;
    const nM = nextMins % 60;
    const period = nH >= 12 ? 'PM' : 'AM';
    const dH = nH % 12 === 0 ? 12 : nH % 12;
    const formatted = `${String(dH).padStart(2, '0')}:${String(nM).padStart(2, '0')} ${period}`;

    return {
        next_departure_time: formatted,
        first_departure: firstDep,
        last_departure: lastDep,
        frequency_text: `Every ${freqMins} mins`,
        operating_hours: `${firstDep} - ${lastDep}`
    };
}

/**
 * GET /api/transit/routes
 * Get all active public transit routes
 */
router.get('/routes', async (req, res, next) => {
    try {
        const { mode } = req.query;
        let sql = 'SELECT * FROM public_transit_routes WHERE is_active = TRUE';
        const params = [];
        if (mode) {
            sql += ' AND transit_mode = ?';
            params.push(mode);
        }
        sql += ' ORDER BY transit_mode ASC, id ASC';
        const routes = await db.prepare(sql).all(...params);
        res.json({ routes });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/transit/compare
 * Compare rideshare, public transit, and private transport options with real DB public transit data
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

        // Base car driving time in minutes
        // City (<= 15 km): ~25 km/h average with traffic lights and stops
        // Suburban (15–50 km): ~45 km/h average mix of city + highway
        // Highway (> 50 km): ~65 km/h average on state/national highway
        let carAvgSpeed;
        if (effectiveDist <= 15) {
            carAvgSpeed = 25;
        } else if (effectiveDist <= 50) {
            carAvgSpeed = 45;
        } else {
            carAvgSpeed = 65;
        }
        const baseCarTimeMin = Math.max(Math.round((effectiveDist / carAvgSpeed) * 60), 6);

        // 1. Rideshare matching from DB
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
                maxPickupRadius: 0.8,
                maxCrossTrack: 0.85,
                maxDetourKm: 1.2
            });
        });

        let rideshareAvgCost = 0;
        let rideshareAvgTime = baseCarTimeMin;

        if (matchingRides.length > 0) {
            const sumCost = matchingRides.reduce((acc, r) => acc + r.fare_per_seat, 0);
            rideshareAvgCost = Math.round(sumCost / matchingRides.length);
        } else {
            rideshareAvgCost = 0; // Explicitly 0 if no shared ride is available
        }

        const rideshare = {
            available: matchingRides.length > 0,
            count: matchingRides.length,
            rides: matchingRides,
            avg_cost: rideshareAvgCost,
            avg_time: rideshareAvgTime
        };

        // 2. Real Public Transit from Database
        const dbTransitRoutes = await db.prepare(`
            SELECT * FROM public_transit_routes WHERE is_active = TRUE
        `).all();

        const scoredRoutes = dbTransitRoutes.map(tr => {
            const distOrigin = haversineDistance(oLat, oLng, tr.origin_lat, tr.origin_lng);
            const distDest = haversineDistance(dLat, dLng, tr.destination_lat, tr.destination_lng);
            
            // Check reverse orientation as buses/trains travel round-trip
            const distReverseOrigin = haversineDistance(oLat, oLng, tr.destination_lat, tr.destination_lng);
            const distReverseDest = haversineDistance(dLat, dLng, tr.origin_lat, tr.origin_lng);

            const isDirect = (distOrigin <= 2.2 && distDest <= 2.2);
            const isReverseDirect = (distReverseOrigin <= 2.2 && distReverseDest <= 2.2);
            const totalDistScore = Math.min(distOrigin + distDest, distReverseOrigin + distReverseDest);

            const departureData = computeNextDeparture(tr.first_departure, tr.last_departure, tr.frequency_mins);

            return {
                ...tr,
                fare_inr: parseFloat(tr.fare_inr),
                score: parseFloat(totalDistScore.toFixed(2)),
                is_match: isDirect || isReverseDirect || totalDistScore <= 3.8,
                next_departure_time: departureData.next_departure_time,
                frequency_text: departureData.frequency_text,
                operating_hours: departureData.operating_hours
            };
        }).sort((a, b) => a.score - b.score);

        // Pick top matched routes (or best nearest if general)
        const matchedPublicRoutes = scoredRoutes.filter(r => r.is_match);
        const primaryRoute = matchedPublicRoutes.length > 0 ? matchedPublicRoutes[0] : scoredRoutes[0];

        // Determine if the matched DB route is actually realistic for the search distance.
        // A "city route" stored in DB (e.g. 2.5 km KMT bus) should NOT be used verbatim
        // for a 70 km inter-city search. We consider a DB route realistic only if:
        //   - It actually matched closely (score < 4 km combined end-point proximity), OR
        //   - Its stored duration is within 3× of what a bus would take at the search distance
        const isDbRouteRealistic = primaryRoute &&
            primaryRoute.score < 4.0 &&
            Math.abs(primaryRoute.estimated_duration_min - Math.round((effectiveDist / 22) * 60)) < Math.round((effectiveDist / 22) * 60) * 2.5;

        let busCost, busTime, busFrequency, busNextDeparture, busRouteName, busOperator;

        if (isDbRouteRealistic) {
            // DB-matched city route — use stored values directly
            busCost = Math.round(primaryRoute.fare_inr);
            busTime = primaryRoute.estimated_duration_min;
            busFrequency = primaryRoute.frequency_text;
            busNextDeparture = primaryRoute.next_departure_time;
            busRouteName = `${primaryRoute.route_number || ''} ${primaryRoute.route_name}`.trim();
            busOperator = primaryRoute.operator_name;
        } else {
            // No closely matched DB route — compute realistic fares by distance:
            //   0–5 km   → KMT city bus   : ₹10 flat
            //   5–15 km  → KMT/suburban   : ₹1.8/km  (~₹9–27)
            //  15–50 km  → MSRTC suburban  : ₹1.9/km  (~₹28–95)
            //  50–200 km → MSRTC long-dist : ₹2.2/km  (~₹110–440)
            // Speed assumptions: city bus 22 km/h, MSRTC 50 km/h, long-dist 60 km/h
            if (effectiveDist <= 5) {
                busCost = 10;
                busTime = Math.max(10, Math.round((effectiveDist / 22) * 60));
                busFrequency = 'Every 10-15 mins';
                busNextDeparture = primaryRoute ? primaryRoute.next_departure_time : 'In ~8 mins';
                busRouteName = primaryRoute ? `${primaryRoute.route_number || ''} ${primaryRoute.route_name}`.trim() : 'KMT City Bus';
                busOperator = primaryRoute ? primaryRoute.operator_name : 'Kolhapur Municipal Transport (KMT)';
            } else if (effectiveDist <= 15) {
                busCost = Math.max(12, Math.round(effectiveDist * 1.8));
                busTime = Math.max(15, Math.round((effectiveDist / 22) * 60));
                busFrequency = 'Every 15-20 mins';
                busNextDeparture = primaryRoute ? primaryRoute.next_departure_time : 'In ~12 mins';
                busRouteName = primaryRoute ? `${primaryRoute.route_number || ''} ${primaryRoute.route_name}`.trim() : 'KMT City Bus';
                busOperator = primaryRoute ? primaryRoute.operator_name : 'Kolhapur Municipal Transport (KMT)';
            } else if (effectiveDist <= 50) {
                busCost = Math.round(effectiveDist * 1.9);
                busTime = Math.max(20, Math.round((effectiveDist / 45) * 60));
                busFrequency = 'Every 30-60 mins';
                busNextDeparture = 'Check bus stand';
                busRouteName = `MSRTC Suburban (Est. ${effectiveDist.toFixed(0)} km)`;
                busOperator = 'Maharashtra State Road Transport (MSRTC)';
            } else {
                // Long-distance inter-city: MSRTC Express / Semi-luxury
                busCost = Math.round(effectiveDist * 2.2);
                busTime = Math.max(30, Math.round((effectiveDist / 58) * 60));
                busFrequency = 'Every 1-2 hrs';
                busNextDeparture = 'Check CBS Bus Stand';
                busRouteName = `MSRTC Express (Est. ${effectiveDist.toFixed(0)} km)`;
                busOperator = 'Maharashtra State Road Transport (MSRTC)';
            }
        }

        const publicTransit = {
            has_db_route: Boolean(primaryRoute),
            primary_route: primaryRoute,
            matched_routes: matchedPublicRoutes.slice(0, 4),
            route_name: busRouteName,
            operator_name: busOperator,
            next_departure: busNextDeparture,
            frequency: busFrequency,
            stops: primaryRoute && primaryRoute.stops ? primaryRoute.stops : 'Major city stops',
            avg_cost: busCost,
            avg_time: busTime,
            co2_savings_kg: parseFloat((effectiveDist * 0.12).toFixed(2))
        };

        // 3. Private Transport Options (Auto & Taxi)
        // Auto-rickshaw operates within city limits (practical up to ~15 km)
        // For >15 km, show "Not available" with a note; still compute for display
        // Auto: ₹15 base + ₹12/km (city metered rate)
        const autoCost = Math.round(15 + (effectiveDist * 12));
        // Auto speed ~22 km/h in city, not practical for highway
        const autoTime = Math.round((effectiveDist / 22) * 60);
        const autoAvailable = effectiveDist <= 18;

        // Private Cab/Taxi: realistic highway vs city rate
        // City (<15 km): ₹50 base + ₹15/km at 28 km/h avg
        // Highway (>15 km): ₹100 base + ₹13/km at 65 km/h avg
        let cabCost, cabTime;
        if (effectiveDist <= 15) {
            cabCost = Math.round(50 + (effectiveDist * 15));
            cabTime = Math.max(8, Math.round((effectiveDist / 28) * 60));
        } else {
            cabCost = Math.round(100 + (effectiveDist * 13));
            cabTime = Math.max(15, Math.round((effectiveDist / 62) * 60));
        }

        const privateTransport = {
            cost: autoAvailable ? autoCost : cabCost,
            time: autoAvailable ? autoTime : cabTime,
            auto: {
                name: autoAvailable ? 'City Auto-Rickshaw' : 'Auto-Rickshaw (City only)',
                cost: autoAvailable ? autoCost : null,
                time: autoAvailable ? autoTime : null,
                availability: autoAvailable ? 'Instant at Stand / On-Demand' : 'Not practical for this distance'
            },
            taxi: {
                name: effectiveDist <= 15 ? 'City Cab (Ola/Uber)' : 'Outstation Cab / Taxi',
                cost: cabCost,
                time: cabTime,
                availability: effectiveDist <= 15 ? 'App On-Demand' : 'Pre-book recommended'
            }
        };

        res.json({
            distance_km: effectiveDist,
            has_active_rides: matchingRides.length > 0,
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
