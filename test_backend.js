const http = require('http');

// Helper to make HTTP requests
function request(options, data = null) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                let parsed = null;
                try {
                    parsed = JSON.parse(body);
                } catch (e) {
                    parsed = body;
                }
                resolve({ statusCode: res.statusCode, headers: res.headers, data: parsed });
            });
        });
        req.on('error', reject);
        if (data) {
            req.write(typeof data === 'string' ? data : JSON.stringify(data));
        }
        req.end();
    });
}

async function runTests() {
    console.log('--- Starting Backend Verification Tests ---');

    // 1. Health check
    const health = await request({ hostname: 'localhost', port: 3000, path: '/api/health', method: 'GET' });
    console.log('1. Health check:', health.statusCode === 200 ? 'PASS' : 'FAIL', health.data);

    // 2. Stations
    const stations = await request({ hostname: 'localhost', port: 3000, path: '/api/stations', method: 'GET' });
    console.log('2. Stations count:', stations.data.stations ? stations.data.stations.length : 'FAIL');

    // 3. Stations search
    const stSearch = await request({ hostname: 'localhost', port: 3000, path: '/api/stations/search?q=KIT', method: 'GET' });
    console.log('3. Station search KIT:', stSearch.data.stations ? stSearch.data.stations[0].name : 'FAIL');

    // 4. Admin login
    const adminLogin = await request({
        hostname: 'localhost',
        port: 3000,
        path: '/api/auth/login',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    }, { email: 'admin@smartcommute.com', password: 'admin123' });
    console.log('4. Admin login:', adminLogin.statusCode === 200 ? 'PASS' : 'FAIL', adminLogin.data.user ? adminLogin.data.user.email : adminLogin.data);
    const adminToken = adminLogin.data.token;

    // 5. User login
    const userLogin = await request({
        hostname: 'localhost',
        port: 3000,
        path: '/api/auth/login',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    }, { email: 'harshad@example.com', password: 'password123' });
    console.log('5. User login:', userLogin.statusCode === 200 ? 'PASS' : 'FAIL', userLogin.data.user ? userLogin.data.user.name : userLogin.data);
    const userToken = userLogin.data.token;

    // 6. Profile GET
    const profile = await request({
        hostname: 'localhost',
        port: 3000,
        path: '/api/auth/profile',
        method: 'GET',
        headers: { 'Authorization': `Bearer ${userToken}` }
    });
    console.log('6. User profile:', profile.statusCode === 200 ? 'PASS' : 'FAIL', profile.data.user ? profile.data.user.email : profile.data);

    // 7. List rides
    const rides = await request({
        hostname: 'localhost',
        port: 3000,
        path: '/api/rides',
        method: 'GET'
    });
    console.log('7. Active rides count:', rides.data.rides ? rides.data.rides.length : 'FAIL');

    // 8. Distance filtered rides
    const distRides = await request({
        hostname: 'localhost',
        port: 3000,
        path: '/api/rides?origin_lat=16.6823&origin_lng=74.2489&dest_lat=16.6982&dest_lng=74.2330',
        method: 'GET'
    });
    console.log('8. Distance matched rides:', distRides.data.rides ? distRides.data.rides.length : 'FAIL');

    // 9. Transit compare
    const compare = await request({
        hostname: 'localhost',
        port: 3000,
        path: '/api/transit/compare?origin_lat=16.6823&origin_lng=74.2489&dest_lat=16.6982&dest_lng=74.2330',
        method: 'GET'
    });
    console.log('9. Transit compare:', compare.statusCode === 200 ? 'PASS' : 'FAIL', {
        dist: compare.data.distance_km,
        rideshare_avail: compare.data.rideshare?.available,
        rideshare_cost: compare.data.rideshare?.avg_cost,
        public_cost: compare.data.public?.avg_cost,
        private_cost: compare.data.private?.cost
    });

    // 10. Transit route
    const route = await request({
        hostname: 'localhost',
        port: 3000,
        path: '/api/transit/route?start_lat=16.6823&start_lng=74.2489&end_lat=16.6982&end_lng=74.2330',
        method: 'GET'
    });
    console.log('10. Transit route:', route.statusCode === 200 ? 'PASS' : 'FAIL', {
        dist: route.data.distance_km,
        dur: route.data.duration_min,
        hasGeometry: !!route.data.route_geometry
    });

    // 11. Admin stats
    const stats = await request({
        hostname: 'localhost',
        port: 3000,
        path: '/api/admin/stats',
        method: 'GET',
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    console.log('11. Admin stats:', stats.statusCode === 200 ? 'PASS' : 'FAIL', stats.data);

    // 12. Admin users
    const adminUsers = await request({
        hostname: 'localhost',
        port: 3000,
        path: '/api/admin/users',
        method: 'GET',
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    console.log('12. Admin users count:', adminUsers.data.users ? adminUsers.data.users.length : 'FAIL');

    // 13. Admin rides
    const adminRides = await request({
        hostname: 'localhost',
        port: 3000,
        path: '/api/admin/rides',
        method: 'GET',
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    console.log('13. Admin rides count:', adminRides.data.rides ? adminRides.data.rides.length : 'FAIL');

    // 14. Admin reports
    const adminReports = await request({
        hostname: 'localhost',
        port: 3000,
        path: '/api/admin/reports',
        method: 'GET',
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    console.log('14. Admin reports count:', adminReports.data.reports ? adminReports.data.reports.length : 'FAIL');

    // 15. Create a new ride
    const newRideRes = await request({
        hostname: 'localhost',
        port: 3000,
        path: '/api/rides',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${userToken}`
        }
    }, {
        origin_name: 'Rankala Lake',
        origin_lat: 16.6876,
        origin_lng: 74.2195,
        destination_name: 'DY Patil College',
        destination_lat: 16.6950,
        destination_lng: 74.2440,
        date: '2026-10-21',
        time: '09:00',
        vehicle_type: 'car',
        available_seats: 3,
        fare_per_seat: 45,
        notes: 'Test ride creation',
        gender_preference: 'any'
    });
    console.log('15. Create Ride:', newRideRes.statusCode === 201 ? 'PASS' : 'FAIL', newRideRes.data.ride ? newRideRes.data.ride.id : newRideRes.data);
    const createdRideId = newRideRes.data.ride?.id;

    // 16. Messages test
    // Sneha logs in
    const snehaLogin = await request({
        hostname: 'localhost',
        port: 3000,
        path: '/api/auth/login',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    }, { email: 'sneha@example.com', password: 'password123' });
    const snehaToken = snehaLogin.data.token;

    const sendMsg = await request({
        hostname: 'localhost',
        port: 3000,
        path: '/api/messages',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${snehaToken}`
        }
    }, {
        receiver_id: userLogin.data.user.id, // Harshad
        content: 'Hello Harshad, is the test ride still active?'
    });
    console.log('16. Send message:', sendMsg.statusCode === 201 ? 'PASS' : 'FAIL', sendMsg.data.message ? sendMsg.data.message.content : sendMsg.data);

    // Get messages
    const getMsgs = await request({
        hostname: 'localhost',
        port: 3000,
        path: `/api/messages/${userLogin.data.user.id}`,
        method: 'GET',
        headers: { 'Authorization': `Bearer ${snehaToken}` }
    });
    console.log('17. Get conversation:', getMsgs.statusCode === 200 ? 'PASS' : 'FAIL', getMsgs.data.messages ? getMsgs.data.messages.length : 'FAIL');

    // 18. Booking test: Sneha books Harshad's new ride
    const bookRes = await request({
        hostname: 'localhost',
        port: 3000,
        path: `/api/rides/${createdRideId}/book`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${snehaToken}`
        }
    }, { seats_booked: 1 });
    console.log('18. Book ride:', bookRes.statusCode === 201 ? 'PASS' : 'FAIL', bookRes.data.booking ? bookRes.data.booking.id : bookRes.data);
    const bookingId = bookRes.data.booking?.id;

    // 19. My Booked
    const myBooked = await request({
        hostname: 'localhost',
        port: 3000,
        path: '/api/rides/my/booked',
        method: 'GET',
        headers: { 'Authorization': `Bearer ${snehaToken}` }
    });
    console.log('19. My Booked count:', myBooked.data.bookings ? myBooked.data.bookings.length : 'FAIL');

    // 20. Confirm booking by driver (Harshad)
    const confirmBooking = await request({
        hostname: 'localhost',
        port: 3000,
        path: `/api/bookings/${bookingId}/confirm`,
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${userToken}` }
    });
    console.log('20. Confirm booking:', confirmBooking.statusCode === 200 ? 'PASS' : 'FAIL', confirmBooking.data.booking?.status);

    // 21. Cancel booking
    const cancelBooking = await request({
        hostname: 'localhost',
        port: 3000,
        path: `/api/bookings/${bookingId}/cancel`,
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${snehaToken}` }
    });
    console.log('21. Cancel booking:', cancelBooking.statusCode === 200 ? 'PASS' : 'FAIL', cancelBooking.data.booking?.status);

    console.log('--- All Backend Tests Finished ---');
    process.exit(0);
}

runTests().catch(err => {
    console.error('Test execution error:', err);
    process.exit(1);
});
