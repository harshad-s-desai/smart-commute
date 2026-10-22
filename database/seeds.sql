-- ====================================================================
-- SMART COMMUTE - SEED DATA FOR POSTGRESQL (seeds.sql)
-- ====================================================================

-- 1. INSERT STATIONS (Colleges, Transport Hubs, Landmarks in Kolhapur)
INSERT INTO stations (name, lat, lng, type, city) VALUES
('KIT College of Engineering', 16.6735, 74.2479, 'college', 'Kolhapur'),
('DY Patil College', 16.6950, 74.2440, 'college', 'Kolhapur'),
('Shivaji University', 16.6823, 74.2489, 'college', 'Kolhapur'),
('Rajaram College', 16.6987, 74.2315, 'college', 'Kolhapur'),
('Vivekanand College', 16.7041, 74.2264, 'college', 'Kolhapur'),
('Bharati Vidyapeeth', 16.6654, 74.2569, 'college', 'Kolhapur'),
('Government Polytechnic', 16.6920, 74.2350, 'college', 'Kolhapur'),
('Willingdon College', 16.6990, 74.2290, 'college', 'Kolhapur'),
('Chh. Shahu Central Library', 16.6965, 74.2310, 'landmark', 'Kolhapur'),
('Hockey Stadium', 16.6927, 74.2274, 'landmark', 'Kolhapur'),
('RK Nagar', 16.7069, 74.2193, 'area', 'Kolhapur'),
('Rankala Lake', 16.6876, 74.2195, 'landmark', 'Kolhapur'),
('Mahalaxmi Temple', 16.6992, 74.2268, 'landmark', 'Kolhapur'),
('CBS (Central Bus Stand)', 16.6982, 74.2330, 'transport_hub', 'Kolhapur'),
('Kolhapur Railway Station', 16.6889, 74.2355, 'transport_hub', 'Kolhapur'),
('Shahupuri', 16.6960, 74.2403, 'area', 'Kolhapur'),
('Rajarampuri', 16.7025, 74.2329, 'area', 'Kolhapur'),
('Tarabai Park', 16.6899, 74.2297, 'area', 'Kolhapur'),
('Dabholkar Corner', 16.6972, 74.2348, 'landmark', 'Kolhapur'),
('Bindu Chowk', 16.6995, 74.2288, 'landmark', 'Kolhapur'),
('Nagala Park', 16.7017, 74.2186, 'area', 'Kolhapur'),
('Laxmipuri', 16.6940, 74.2367, 'area', 'Kolhapur'),
('Sykes Extension', 16.7052, 74.2313, 'area', 'Kolhapur'),
('Kalamba', 16.6759, 74.2241, 'area', 'Kolhapur'),
('Morewadi', 16.6612, 74.2528, 'area', 'Kolhapur'),
('Uchgaon', 16.6558, 74.2654, 'area', 'Kolhapur'),
('Shiroli MIDC', 16.6884, 74.3167, 'area', 'Kolhapur'),
('Kadamwadi', 16.7102, 74.2245, 'area', 'Kolhapur'),
('New Palace', 16.6937, 74.2253, 'landmark', 'Kolhapur'),
('Kolhapur Airport', 16.6640, 74.2894, 'transport_hub', 'Kolhapur')
ON CONFLICT DO NOTHING;
