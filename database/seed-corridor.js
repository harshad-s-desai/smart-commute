const db = require('./init');

async function seedCorridorRides() {
    try {
        const today = new Date().toISOString().split('T')[0];
        const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
        const dayAfter = new Date(Date.now() + 172800000).toISOString().split('T')[0];

        const dates = [today, tomorrow, dayAfter, '2026-10-14', '2026-10-15', '2026-10-16'];

        for (const date of dates) {
            const existing = await db.prepare(
                "SELECT id FROM rides WHERE origin_name LIKE '%Hockey%' AND destination_name LIKE '%KIT%' AND date = ?"
            ).get(date);

            if (!existing) {
                await db.prepare(`
                    INSERT INTO rides (
                        user_id, origin_name, origin_lat, origin_lng,
                        destination_name, destination_lat, destination_lng,
                        date, time, vehicle_type, available_seats,
                        fare_per_seat, notes, gender_preference, status
                    ) VALUES (
                        2, 'Hockey Stadium', 16.6927, 74.2274,
                        'KIT College of Engineering', 16.6735, 74.2479,
                        ?, '08:30', 'car', 3,
                        35, 'Passing via Rajarampuri & RK Nagar corridor towards KIT Campus. AC car, extra luggage space.', 'any', 'active'
                    )
                `).run(date);
                console.log(`[Seed Corridor] Added Hockey Stadium -> KIT College for ${date}`);
            } else {
                console.log(`[Seed Corridor] Already exists for ${date}`);
            }
        }
        console.log('[Seed Corridor] Done.');
        process.exit(0);
    } catch (err) {
        console.error('[Seed Corridor Error]:', err);
        process.exit(1);
    }
}

seedCorridorRides();
