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

module.exports = router;
