const express = require('express');
const router = express.Router();
const db = require('../database/init');
const { auth } = require('../middleware/auth');

// All message endpoints require authentication
router.use(auth);

/**
 * GET /api/messages
 * Get list of conversations for current user
 */
router.get('/', async (req, res, next) => {
    try {
        const currentUserId = req.user.id;

        // Fetch distinct users that the current user has chatted with
        const conversations = await db.prepare(`
            SELECT 
                u.id as other_user_id,
                u.name as other_user_name,
                u.gender as other_user_gender,
                m.content as last_message,
                m.created_at as last_message_time,
                (SELECT COUNT(*) FROM messages WHERE sender_id = u.id AND receiver_id = ? AND is_read = 0) as unread_count
            FROM messages m
            JOIN users u ON (CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END) = u.id
            WHERE m.id IN (
                SELECT MAX(id)
                FROM messages
                WHERE sender_id = ? OR receiver_id = ?
                GROUP BY CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END
            )
            ORDER BY m.created_at DESC
        `).all(currentUserId, currentUserId, currentUserId, currentUserId, currentUserId);

        res.json({ conversations });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/messages/:userId
 * Get chat history between current user and specified user
 */
router.get('/:userId', async (req, res, next) => {
    try {
        const otherUserId = parseInt(req.params.userId, 10);
        const currentUserId = req.user.id;

        if (isNaN(otherUserId)) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }

        // Mark incoming messages as read
        await db.prepare(`
            UPDATE messages
            SET is_read = 1
            WHERE sender_id = ? AND receiver_id = ? AND is_read = 0
        `).run(otherUserId, currentUserId);

        // Fetch messages
        const messages = await db.prepare(`
            SELECT m.*,
                   s.name as sender_name,
                   r.name as receiver_name
            FROM messages m
            JOIN users s ON m.sender_id = s.id
            JOIN users r ON m.receiver_id = r.id
            WHERE (m.sender_id = ? AND m.receiver_id = ?)
               OR (m.sender_id = ? AND m.receiver_id = ?)
            ORDER BY m.created_at ASC
        `).all(currentUserId, otherUserId, otherUserId, currentUserId);

        res.json({ messages });
    } catch (err) {
        next(err);
    }
});

/**
 * POST /api/messages
 * Send a new direct message
 */
router.post('/', async (req, res, next) => {
    try {
        const { receiver_id, ride_id = null, content } = req.body;

        if (!receiver_id || !content || !content.trim()) {
            return res.status(400).json({ error: 'receiver_id and message content are required.' });
        }

        const receiver = await db.prepare('SELECT id FROM users WHERE id = ?').get(receiver_id);
        if (!receiver) {
            return res.status(404).json({ error: 'Receiver user not found.' });
        }

        if (parseInt(receiver_id, 10) === req.user.id) {
            return res.status(400).json({ error: 'Cannot send message to yourself.' });
        }

        const insertStmt = db.prepare(`
            INSERT INTO messages (sender_id, receiver_id, ride_id, content, is_read)
            VALUES (?, ?, ?, ?, 0)
        `);

        const result = await insertStmt.run(
            req.user.id,
            parseInt(receiver_id, 10),
            ride_id ? parseInt(ride_id, 10) : null,
            content.trim()
        );

        const newMessage = await db.prepare(`
            SELECT m.*,
                   s.name as sender_name,
                   r.name as receiver_name
            FROM messages m
            JOIN users s ON m.sender_id = s.id
            JOIN users r ON m.receiver_id = r.id
            WHERE m.id = ?
        `).get(result.lastInsertRowid);

        res.status(201).json({ message: newMessage });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
