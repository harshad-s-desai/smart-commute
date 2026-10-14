const jwt = require('jsonwebtoken');
const db = require('../database/init');

const JWT_SECRET = process.env.JWT_SECRET || 'smartcommute_jwt_secret_kolhapur_2026';

/**
 * Authentication middleware
 * Verifies Bearer JWT token in Authorization header and attaches user to req.user
 */
const auth = async (req, res, next) => {
    try {
        const authHeader = req.header('Authorization');
        if (!authHeader) {
            return res.status(401).json({ error: 'Access denied. No token provided.' });
        }

        const token = authHeader.startsWith('Bearer ')
            ? authHeader.slice(7).trim()
            : authHeader.trim();

        if (!token) {
            return res.status(401).json({ error: 'Access denied. Malformed token.' });
        }

        const decoded = jwt.verify(token, JWT_SECRET);
        
        // Fetch current user from database
        const user = await db.prepare(`
            SELECT id, name, email, mobile, gender, age, is_verified, is_admin, created_at 
            FROM users 
            WHERE id = ?
        `).get(decoded.id);

        if (!user) {
            return res.status(401).json({ error: 'Invalid token. User no longer exists.' });
        }

        req.user = user;
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Session expired. Please log in again.' });
        }
        return res.status(401).json({ error: 'Invalid authentication token.' });
    }
};

/**
 * Admin authorization middleware
 * Ensures user is authenticated and is_admin === 1
 */
const adminAuth = (req, res, next) => {
    auth(req, res, () => {
        if (!req.user || req.user.is_admin !== 1) {
            return res.status(403).json({ error: 'Access denied. Administrator privileges required.' });
        }
        next();
    });
};

module.exports = {
    auth,
    adminAuth,
    JWT_SECRET
};
