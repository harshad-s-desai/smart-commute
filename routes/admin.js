const express = require('express');
const router = express.Router();
const db = require('../database/init');
const { adminAuth } = require('../middleware/auth');

// Apply admin authentication to all routes in this router
router.use(adminAuth);

/**
 * GET /api/admin/stats
 * Summary statistics for the admin dashboard
 */
router.get('/stats', async (req, res, next) => {
    try {
        const totalUsers = (await db.prepare('SELECT COUNT(*) as count FROM users').get()).count;
        const verifiedUsers = (await db.prepare('SELECT COUNT(*) as count FROM users WHERE is_verified = 1').get()).count;
        const activeRides = (await db.prepare("SELECT COUNT(*) as count FROM rides WHERE status = 'active'").get()).count;
        const totalRides = (await db.prepare('SELECT COUNT(*) as count FROM rides').get()).count;
        const totalBookings = (await db.prepare('SELECT COUNT(*) as count FROM bookings').get()).count;
        const confirmedBookings = (await db.prepare("SELECT COUNT(*) as count FROM bookings WHERE status = 'confirmed'").get()).count;
        const totalReports = (await db.prepare('SELECT COUNT(*) as count FROM reports').get()).count;
        const pendingReports = (await db.prepare("SELECT COUNT(*) as count FROM reports WHERE status = 'pending'").get()).count;

        res.json({
            total_users: parseInt(totalUsers, 10),
            verified_users: parseInt(verifiedUsers, 10),
            active_rides: parseInt(activeRides, 10),
            total_rides: parseInt(totalRides, 10),
            total_bookings: parseInt(totalBookings, 10),
            confirmed_bookings: parseInt(confirmedBookings, 10),
            total_reports: parseInt(totalReports, 10),
            pending_reports: parseInt(pendingReports, 10)
        });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/admin/users
 * List all registered users
 */
router.get('/users', async (req, res, next) => {
    try {
        const users = await db.prepare(`
            SELECT id, name, email, mobile, gender, age, is_verified, is_admin, created_at,
                   (SELECT COUNT(*) FROM rides WHERE user_id = users.id) as rides_offered,
                   (SELECT COUNT(*) FROM bookings WHERE passenger_id = users.id) as rides_booked
            FROM users
            ORDER BY created_at DESC
        `).all();

        res.json({ users });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/admin/rides
 * List all rides with driver details and booking count
 */
router.get('/rides', async (req, res, next) => {
    try {
        const rides = await db.prepare(`
            SELECT r.*,
                   u.name as driver_name,
                   u.email as driver_email,
                   u.mobile as driver_mobile,
                   u.gender as driver_gender,
                   u.is_verified as driver_verified,
                   (SELECT COUNT(*) FROM bookings b WHERE b.ride_id = r.id) as total_bookings
            FROM rides r
            JOIN users u ON r.user_id = u.id
            ORDER BY r.date DESC, r.time DESC
        `).all();

        res.json({ rides });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/admin/reports
 * List all safety/user reports with reporter and reported user details
 */
router.get('/reports', async (req, res, next) => {
    try {
        const reports = await db.prepare(`
            SELECT rep.*,
                   u1.name as reporter_name,
                   u1.email as reporter_email,
                   u2.name as reported_name,
                   u2.email as reported_email,
                   r.origin_name,
                   r.destination_name,
                   r.date as ride_date
            FROM reports rep
            JOIN users u1 ON rep.reporter_id = u1.id
            JOIN users u2 ON rep.reported_user_id = u2.id
            LEFT JOIN rides r ON rep.ride_id = r.id
            ORDER BY rep.created_at DESC
        `).all();

        res.json({ reports });
    } catch (err) {
        next(err);
    }
});

/**
 * PUT /api/admin/users/:id/verify
 * Toggle or set verified status for a user
 */
router.put('/users/:id/verify', async (req, res, next) => {
    try {
        const userId = req.params.id;
        const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found.' });
        }

        const newStatus = user.is_verified === 1 ? 0 : 1;
        await db.prepare('UPDATE users SET is_verified = ? WHERE id = ?').run(newStatus, userId);

        const updatedUser = await db.prepare(`
            SELECT id, name, email, mobile, gender, age, is_verified, is_admin, created_at 
            FROM users 
            WHERE id = ?
        `).get(userId);

        res.json({
            message: `User ${newStatus === 1 ? 'verified' : 'unverified'} successfully.`,
            user: updatedUser
        });
    } catch (err) {
        next(err);
    }
});

/**
 * PUT /api/admin/users/:id/ban
 * Ban and delete a user and their associated relations
 */
router.put('/users/:id/ban', async (req, res, next) => {
    try {
        const userId = parseInt(req.params.id, 10);
        const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found.' });
        }

        if (user.is_admin === 1) {
            return res.status(400).json({ error: 'Cannot ban or delete an administrator account.' });
        }

        await db.transaction(async (tx) => {
            // Delete messages involving this user
            await tx.prepare('DELETE FROM messages WHERE sender_id = ? OR receiver_id = ?').run(userId, userId);
            
            // Delete reports involving this user
            await tx.prepare('DELETE FROM reports WHERE reporter_id = ? OR reported_user_id = ?').run(userId, userId);

            // Delete bookings made by this user
            await tx.prepare('DELETE FROM bookings WHERE passenger_id = ?').run(userId);

            // Cancel or delete rides created by this user and their bookings
            const userRides = await tx.prepare('SELECT id FROM rides WHERE user_id = ?').all(userId);
            for (const r of userRides) {
                await tx.prepare('DELETE FROM bookings WHERE ride_id = ?').run(r.id);
            }
            await tx.prepare('DELETE FROM rides WHERE user_id = ?').run(userId);

            // Delete user record
            await tx.prepare('DELETE FROM users WHERE id = ?').run(userId);
        });

        res.json({ success: true, message: `User ${user.name} banned and removed successfully.` });
    } catch (err) {
        next(err);
    }
});

/**
 * PUT /api/admin/reports/:id
 * Update report status ('pending', 'reviewed', 'resolved')
 */
router.put('/reports/:id', async (req, res, next) => {
    try {
        const reportId = req.params.id;
        const { status } = req.body;

        const validStatuses = ['pending', 'reviewed', 'resolved'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: 'Invalid status. Must be pending, reviewed, or resolved.' });
        }

        const report = await db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId);
        if (!report) {
            return res.status(404).json({ error: 'Report not found.' });
        }

        await db.prepare('UPDATE reports SET status = ? WHERE id = ?').run(status, reportId);
        const updatedReport = await db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId);

        res.json({
            message: 'Report status updated successfully.',
            report: updatedReport
        });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/admin/transit
 * List all public transit routes with summary counts
 */
router.get('/transit', async (req, res, next) => {
    try {
        const routes = await db.prepare(`
            SELECT * FROM public_transit_routes 
            ORDER BY is_active DESC, transit_mode ASC, id ASC
        `).all();

        res.json({ routes });
    } catch (err) {
        next(err);
    }
});

/**
 * POST /api/admin/transit
 * Create a new public transit route
 */
router.post('/transit', async (req, res, next) => {
    try {
        const {
            transit_mode = 'kmt_bus',
            operator_name,
            route_number,
            route_name,
            origin_name,
            origin_lat = 16.6982,
            origin_lng = 74.2330,
            destination_name,
            destination_lat = 16.6823,
            destination_lng = 74.2489,
            stops = '',
            first_departure = '06:00',
            last_departure = '22:30',
            frequency_mins = 15,
            estimated_duration_min = 20,
            fare_inr = 12.00,
            is_active = true
        } = req.body;

        if (!route_name || !origin_name || !destination_name) {
            return res.status(400).json({ error: 'Route name, origin name, and destination name are required.' });
        }

        const operator = operator_name || (
            transit_mode === 'kmt_bus' ? 'KMT (Kolhapur Municipal Transport)' :
            transit_mode === 'msrtc_bus' ? 'MSRTC State Transport' :
            transit_mode === 'train' ? 'Indian Railways' : 'Kolhapur Auto Rickshaw'
        );

        const result = await db.prepare(`
            INSERT INTO public_transit_routes (
                transit_mode, operator_name, route_number, route_name,
                origin_name, origin_lat, origin_lng, destination_name,
                destination_lat, destination_lng, stops, first_departure,
                last_departure, frequency_mins, estimated_duration_min, fare_inr, is_active
            ) VALUES (
                ?, ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?, ?, ?
            )
        `).run(
            transit_mode,
            operator,
            route_number ? route_number.trim() : '',
            route_name.trim(),
            origin_name.trim(),
            parseFloat(origin_lat) || 16.6982,
            parseFloat(origin_lng) || 74.2330,
            destination_name.trim(),
            parseFloat(destination_lat) || 16.6823,
            parseFloat(destination_lng) || 74.2489,
            stops ? stops.trim() : '',
            first_departure,
            last_departure,
            parseInt(frequency_mins, 10) || 15,
            parseInt(estimated_duration_min, 10) || 20,
            parseFloat(fare_inr) || 12.00,
            is_active === false || is_active === 'false' ? false : true
        );

        const newRoute = await db.prepare('SELECT * FROM public_transit_routes WHERE id = ?').get(result.lastInsertRowid);
        res.status(201).json({ message: 'Transit route created successfully.', route: newRoute });
    } catch (err) {
        next(err);
    }
});

/**
 * PUT /api/admin/transit/:id
 * Update an existing public transit route
 */
router.put('/transit/:id', async (req, res, next) => {
    try {
        const routeId = req.params.id;
        const existing = await db.prepare('SELECT * FROM public_transit_routes WHERE id = ?').get(routeId);
        if (!existing) {
            return res.status(404).json({ error: 'Transit route not found.' });
        }

        const {
            transit_mode,
            operator_name,
            route_number,
            route_name,
            origin_name,
            origin_lat,
            origin_lng,
            destination_name,
            destination_lat,
            destination_lng,
            stops,
            first_departure,
            last_departure,
            frequency_mins,
            estimated_duration_min,
            fare_inr,
            is_active
        } = req.body;

        await db.prepare(`
            UPDATE public_transit_routes SET
                transit_mode = COALESCE(?, transit_mode),
                operator_name = COALESCE(?, operator_name),
                route_number = COALESCE(?, route_number),
                route_name = COALESCE(?, route_name),
                origin_name = COALESCE(?, origin_name),
                origin_lat = COALESCE(?, origin_lat),
                origin_lng = COALESCE(?, origin_lng),
                destination_name = COALESCE(?, destination_name),
                destination_lat = COALESCE(?, destination_lat),
                destination_lng = COALESCE(?, destination_lng),
                stops = COALESCE(?, stops),
                first_departure = COALESCE(?, first_departure),
                last_departure = COALESCE(?, last_departure),
                frequency_mins = COALESCE(?, frequency_mins),
                estimated_duration_min = COALESCE(?, estimated_duration_min),
                fare_inr = COALESCE(?, fare_inr),
                is_active = COALESCE(?, is_active),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(
            transit_mode !== undefined ? transit_mode : null,
            operator_name !== undefined ? operator_name : null,
            route_number !== undefined ? route_number : null,
            route_name !== undefined ? route_name : null,
            origin_name !== undefined ? origin_name : null,
            origin_lat !== undefined ? parseFloat(origin_lat) : null,
            origin_lng !== undefined ? parseFloat(origin_lng) : null,
            destination_name !== undefined ? destination_name : null,
            destination_lat !== undefined ? parseFloat(destination_lat) : null,
            destination_lng !== undefined ? parseFloat(destination_lng) : null,
            stops !== undefined ? stops : null,
            first_departure !== undefined ? first_departure : null,
            last_departure !== undefined ? last_departure : null,
            frequency_mins !== undefined ? parseInt(frequency_mins, 10) : null,
            estimated_duration_min !== undefined ? parseInt(estimated_duration_min, 10) : null,
            fare_inr !== undefined ? parseFloat(fare_inr) : null,
            is_active !== undefined ? (is_active === true || is_active === 'true' || is_active === 1) : null,
            routeId
        );

        const updated = await db.prepare('SELECT * FROM public_transit_routes WHERE id = ?').get(routeId);
        res.json({ message: 'Transit route updated successfully.', route: updated });
    } catch (err) {
        next(err);
    }
});

/**
 * DELETE /api/admin/transit/:id
 * Delete a public transit route
 */
router.delete('/transit/:id', async (req, res, next) => {
    try {
        const routeId = req.params.id;
        const existing = await db.prepare('SELECT * FROM public_transit_routes WHERE id = ?').get(routeId);
        if (!existing) {
            return res.status(404).json({ error: 'Transit route not found.' });
        }

        await db.prepare('DELETE FROM public_transit_routes WHERE id = ?').run(routeId);
        res.json({ success: true, message: `Transit route ${existing.route_name} deleted successfully.` });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
