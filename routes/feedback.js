const express = require('express');
const router = express.Router();
const db = require('../database/init');
const { auth } = require('../middleware/auth');

/**
 * POST /api/feedback
 * Submit feedback / rating for a ride
 */
router.post('/', auth, async (req, res, next) => {
    try {
        const { ride_id, booking_id, to_user_id, rating, comment } = req.body;

        const rateVal = parseInt(rating, 10);
        if (isNaN(rateVal) || rateVal < 1 || rateVal > 5) {
            return res.status(400).json({ error: 'Rating must be an integer between 1 and 5 stars.' });
        }

        if (!ride_id) {
            return res.status(400).json({ error: 'Ride ID is required.' });
        }

        const ride = await db.prepare('SELECT * FROM rides WHERE id = ?').get(ride_id);
        if (!ride) {
            return res.status(404).json({ error: 'Ride not found.' });
        }

        // Determine giver role and target receiver
        let receiverId = to_user_id;
        let giverRole = 'passenger';

        if (ride.user_id === req.user.id) {
            // Giver is the driver rating a passenger
            giverRole = 'driver';
            if (!receiverId) {
                return res.status(400).json({ error: 'Passenger receiver ID is required.' });
            }
        } else {
            // Giver is a passenger rating the driver
            giverRole = 'passenger';
            receiverId = ride.user_id;
        }

        // Check if user already submitted feedback for this ride & receiver
        const existing = await db.prepare(`
            SELECT id FROM feedback 
            WHERE ride_id = ? AND giver_id = ? AND receiver_id = ?
        `).get(ride_id, req.user.id, receiverId);

        if (existing) {
            // Update existing feedback
            await db.prepare(`
                UPDATE feedback 
                SET rating = ?, comment = ?, created_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(rateVal, (comment || '').trim(), existing.id);

            return res.json({ message: 'Feedback updated successfully!', rating: rateVal });
        }

        // Insert new feedback
        const result = await db.prepare(`
            INSERT INTO feedback (ride_id, booking_id, giver_id, receiver_id, giver_role, rating, comment)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
            ride_id,
            booking_id || null,
            req.user.id,
            receiverId,
            giverRole,
            rateVal,
            (comment || '').trim()
        );

        res.status(201).json({
            message: 'Thank you for your feedback! Rating recorded.',
            feedback_id: result.lastInsertRowid,
            rating: rateVal
        });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/feedback/ride/:rideId
 * Get all feedback for a given ride
 */
router.get('/ride/:rideId', async (req, res, next) => {
    try {
        const feedbackList = await db.prepare(`
            SELECT f.*, 
                   giver.name as giver_name, giver.gender as giver_gender,
                   receiver.name as receiver_name
            FROM feedback f
            JOIN users giver ON f.giver_id = giver.id
            JOIN users receiver ON f.receiver_id = receiver.id
            WHERE f.ride_id = ?
            ORDER BY f.created_at DESC
        `).all(req.params.rideId);

        res.json({ feedback: feedbackList });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/feedback/user/:userId
 * Get reviews and average rating for a user
 */
router.get('/user/:userId', async (req, res, next) => {
    try {
        const reviews = await db.prepare(`
            SELECT f.*, 
                   giver.name as giver_name, giver.gender as giver_gender,
                   r.origin_name, r.destination_name, r.date
            FROM feedback f
            JOIN users giver ON f.giver_id = giver.id
            JOIN rides r ON f.ride_id = r.id
            WHERE f.receiver_id = ?
            ORDER BY f.created_at DESC
        `).all(req.params.userId);

        const stats = await db.prepare(`
            SELECT COUNT(*) as total_reviews, AVG(rating) as avg_rating
            FROM feedback
            WHERE receiver_id = ?
        `).get(req.params.userId);

        res.json({
            reviews,
            total_reviews: parseInt(stats.total_reviews || 0, 10),
            avg_rating: stats.avg_rating ? parseFloat(Number(stats.avg_rating).toFixed(1)) : 5.0
        });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
