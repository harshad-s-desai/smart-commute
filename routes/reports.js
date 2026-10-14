const express = require('express');
const router = express.Router();
const db = require('../database/init');
const { auth } = require('../middleware/auth');

/**
 * POST /api/reports
 * Submit a report against a user or ride
 */
router.post('/', auth, async (req, res, next) => {
    try {
        const { reported_user_id, ride_id = null, reason, description = '' } = req.body;

        if (!reported_user_id || !reason) {
            return res.status(400).json({ error: 'reported_user_id and reason are required.' });
        }

        const reportedUser = await db.prepare('SELECT id FROM users WHERE id = ?').get(reported_user_id);
        if (!reportedUser) {
            return res.status(404).json({ error: 'Reported user not found.' });
        }

        const insertStmt = db.prepare(`
            INSERT INTO reports (reporter_id, reported_user_id, ride_id, reason, description, status)
            VALUES (?, ?, ?, ?, ?, 'pending')
        `);

        const result = await insertStmt.run(
            req.user.id,
            parseInt(reported_user_id, 10),
            ride_id ? parseInt(ride_id, 10) : null,
            reason.trim(),
            description ? description.trim() : ''
        );

        const newReport = await db.prepare('SELECT * FROM reports WHERE id = ?').get(result.lastInsertRowid);
        res.status(201).json({ message: 'Report submitted successfully.', report: newReport });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
