const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../database/init');
const { auth, JWT_SECRET } = require('../middleware/auth');

/**
 * Generate JWT token for user
 */
function generateToken(user) {
    return jwt.sign(
        { id: user.id, email: user.email, is_admin: user.is_admin },
        JWT_SECRET,
        { expiresIn: '7d' }
    );
}

/**
 * POST /api/auth/register
 * Register a new user
 */
router.post('/register', async (req, res, next) => {
    try {
        const { name, email, mobile, password, gender = 'other', age = null } = req.body;

        // Basic validation
        if (!name || !email || !mobile || !password) {
            return res.status(400).json({ error: 'Name, email, mobile, and password are required.' });
        }

        const trimmedEmail = email.trim().toLowerCase();
        const trimmedMobile = mobile.trim();

        // Email format validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(trimmedEmail)) {
            return res.status(400).json({ error: 'Invalid email address format.' });
        }

        // Gender validation
        const validGenders = ['male', 'female', 'other'];
        const userGender = validGenders.includes(gender) ? gender : 'other';

        // Check if email or mobile is already in use
        const existingEmail = await db.prepare('SELECT id FROM users WHERE email = ?').get(trimmedEmail);
        if (existingEmail) {
            return res.status(400).json({ error: 'An account with this email already exists.' });
        }

        const existingMobile = await db.prepare('SELECT id FROM users WHERE mobile = ?').get(trimmedMobile);
        if (existingMobile) {
            return res.status(400).json({ error: 'An account with this mobile number already exists.' });
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Insert new user
        const insertStmt = db.prepare(`
            INSERT INTO users (name, email, mobile, password, gender, age, is_verified, is_admin)
            VALUES (?, ?, ?, ?, ?, ?, 0, 0)
        `);

        const result = await insertStmt.run(name.trim(), trimmedEmail, trimmedMobile, hashedPassword, userGender, age ? parseInt(age, 10) : null);

        const newUser = await db.prepare(`
            SELECT id, name, email, mobile, gender, age, is_verified, is_admin, created_at
            FROM users
            WHERE id = ?
        `).get(result.lastInsertRowid);

        const token = generateToken(newUser);

        return res.status(201).json({
            token,
            user: newUser
        });
    } catch (err) {
        next(err);
    }
});

/**
 * POST /api/auth/login
 * Log in with email and password
 */
router.post('/login', async (req, res, next) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required.' });
        }

        const trimmedEmail = email.trim().toLowerCase();

        const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(trimmedEmail);
        if (!user) {
            return res.status(400).json({ error: 'Invalid email or password.' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ error: 'Invalid email or password.' });
        }

        const token = generateToken(user);

        const userSafe = {
            id: user.id,
            name: user.name,
            email: user.email,
            mobile: user.mobile,
            gender: user.gender,
            age: user.age,
            is_verified: user.is_verified,
            is_admin: user.is_admin,
            created_at: user.created_at
        };

        return res.json({
            token,
            user: userSafe
        });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/auth/profile
 * Get authenticated user profile
 */
router.get('/profile', auth, (req, res) => {
    res.json({ user: req.user });
});

/**
 * PUT /api/auth/profile
 * Update authenticated user profile
 */
router.put('/profile', auth, async (req, res, next) => {
    try {
        const { name, mobile, age, gender } = req.body;

        const updates = [];
        const params = [];

        if (name !== undefined) {
            updates.push('name = ?');
            params.push(name.trim());
        }

        if (mobile !== undefined) {
            const trimmedMobile = mobile.trim();
            // Check uniqueness if changed
            const existing = await db.prepare('SELECT id FROM users WHERE mobile = ? AND id != ?').get(trimmedMobile, req.user.id);
            if (existing) {
                return res.status(400).json({ error: 'Mobile number is already registered by another account.' });
            }
            updates.push('mobile = ?');
            params.push(trimmedMobile);
        }

        if (age !== undefined) {
            updates.push('age = ?');
            params.push(age ? parseInt(age, 10) : null);
        }

        if (gender !== undefined) {
            const validGenders = ['male', 'female', 'other'];
            if (!validGenders.includes(gender)) {
                return res.status(400).json({ error: 'Gender must be male, female, or other.' });
            }
            updates.push('gender = ?');
            params.push(gender);
        }

        if (updates.length > 0) {
            params.push(req.user.id);
            const query = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
            await db.prepare(query).run(...params);
        }

        const updatedUser = await db.prepare(`
            SELECT id, name, email, mobile, gender, age, is_verified, is_admin, created_at
            FROM users
            WHERE id = ?
        `).get(req.user.id);

        res.json({ user: updatedUser });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
