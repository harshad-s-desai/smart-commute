const express = require('express');
const router = express.Router();
const db = require('../database/init');
const { auth } = require('../middleware/auth');

/**
 * PUT /api/bookings/:id/confirm
 * Confirm a booking (driver of the ride)
 */
router.put('/:id/confirm', auth, async (req, res, next) => {
    try {
        const bookingId = req.params.id;
        const booking = await db.prepare(`
            SELECT b.*, r.user_id as driver_id 
            FROM bookings b
            JOIN rides r ON b.ride_id = r.id
            WHERE b.id = ?
        `).get(bookingId);

        if (!booking) {
            return res.status(404).json({ error: 'Booking not found.' });
        }

        // Only the ride's driver (or an admin) can confirm a booking
        if (booking.driver_id !== req.user.id && req.user.is_admin !== 1) {
            return res.status(403).json({ error: 'Only the driver can confirm this booking.' });
        }

        await db.prepare("UPDATE bookings SET status = 'confirmed' WHERE id = ?").run(bookingId);
        const updated = await db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);

        res.json({ message: 'Booking confirmed successfully.', booking: updated });
    } catch (err) {
        next(err);
    }
});

/**
 * PUT /api/bookings/:id/cancel
 * DELETE /api/bookings/:id
 * Cancel a booking (by passenger or driver)
 * Passenger can only cancel if at least 5 hours remain before departure time.
 */
async function handleCancelBooking(req, res, next) {
    try {
        const bookingId = req.params.id;
        const booking = await db.prepare(`
            SELECT b.*, r.user_id as driver_id, r.date as ride_date, r.time as ride_time
            FROM bookings b
            JOIN rides r ON b.ride_id = r.id
            WHERE b.id = ?
        `).get(bookingId);

        if (!booking) {
            return res.status(404).json({ error: 'Booking not found.' });
        }

        // Must be passenger, driver, or admin
        const isPassenger = booking.passenger_id === req.user.id;
        const isDriver = booking.driver_id === req.user.id;
        const isAdmin = req.user.is_admin === 1;

        if (!isPassenger && !isDriver && !isAdmin) {
            return res.status(403).json({ error: 'Not authorized to cancel this booking.' });
        }

        if (booking.status === 'cancelled') {
            return res.status(400).json({ error: 'Booking is already cancelled.' });
        }

        // 5-Hour Cancellation Rule for passengers:
        if (isPassenger && !isAdmin) {
            const rideDateStr = String(booking.ride_date).split('T')[0];
            const rideTimeStr = String(booking.ride_time || '00:00');
            const departureDateTime = new Date(`${rideDateStr}T${rideTimeStr}:00`);
            const now = new Date();
            const diffHours = (departureDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);

            if (diffHours < 5) {
                return res.status(400).json({
                    error: `Bookings can only be cancelled at least 5 hours prior to the scheduled departure time. This ride is scheduled for ${rideDateStr} at ${rideTimeStr} (${diffHours > 0 ? diffHours.toFixed(1) + ' hours remaining' : 'departure time has passed'}).`
                });
            }
        }

        // Transaction: update status and restore seats on the ride
        await db.transaction(async (tx) => {
            await tx.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(bookingId);
            await tx.prepare(`
                UPDATE rides 
                SET available_seats = available_seats + ? 
                WHERE id = ?
            `).run(booking.seats_booked, booking.ride_id);
        });

        const updated = await db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
        res.json({ message: 'Booking cancelled successfully.', booking: updated });
    } catch (err) {
        next(err);
    }
}

router.put('/:id/cancel', auth, handleCancelBooking);
router.delete('/:id', auth, handleCancelBooking);

module.exports = router;
