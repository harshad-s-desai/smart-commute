const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

// Ensure database and initial tables/seed data are loaded
const db = require('./database/init');

const authRoutes = require('./routes/auth');
const ridesRoutes = require('./routes/rides');
const transitRoutes = require('./routes/transit');
const adminRoutes = require('./routes/admin');
const messagesRoutes = require('./routes/messages');
const bookingsRoutes = require('./routes/bookings');
const reportsRoutes = require('./routes/reports');
const feedbackRoutes = require('./routes/feedback');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files from /public
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/rides', ridesRoutes);
app.use('/api/transit', transitRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/bookings', bookingsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/feedback', feedbackRoutes);

// Support top-level /api/stations endpoints as per spec
app.get('/api/stations', async (req, res, next) => {
    try {
        const stations = await db.prepare('SELECT * FROM stations ORDER BY name ASC').all();
        res.json({ stations });
    } catch (err) {
        next(err);
    }
});

app.get('/api/stations/search', async (req, res, next) => {
    try {
        const query = req.query.q || '';
        const stations = await db.prepare('SELECT * FROM stations WHERE name ILIKE ? ORDER BY name ASC').all(`%${query}%`);
        res.json({ stations });
    } catch (err) {
        next(err);
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', database: 'postgresql', timestamp: new Date().toISOString() });
});

// 404 handler for unknown API routes
app.use('/api/*', (req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Fallback to index.html for client-side routing if requested
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Centralized error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled Server Error:', err);
    const status = err.status || 500;
    res.status(status).json({
        error: err.message || 'Internal Server Error'
    });
});

// Start the server
if (process.env.NODE_ENV !== 'test') {
    app.listen(PORT, () => {
        console.log(`Smart Commute server (PostgreSQL) is running on http://localhost:${PORT}`);
    });
}

module.exports = app;
