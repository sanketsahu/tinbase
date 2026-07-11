-- ============================================================================
-- seed.sql — tinbase dev demo data
--
-- Standalone: inserts auth users directly (fixed UUIDs) so a fresh boot works
-- without any script. Every insert is idempotent (ON CONFLICT DO NOTHING /
-- guarded DO blocks), so re-running the file is harmless.
--
-- Passwords: every demo user signs in with `password123`. The stored hash uses
-- tinbase's `pbkdf2$<iters>$<salthex>$<hashhex>` format (src/auth/password.ts).
-- The verifier reads the iteration count from the stored string, so this seed
-- uses iterations=1 — PBKDF2-HMAC-SHA256 with c=1 is a single HMAC round,
-- which pgcrypto can compute right here: DK = HMAC(password, salt || int32be(1)).
-- (1 iteration is fine for throwaway local demo credentials.)
--
-- Fixed UUID ranges: users 0000…-01..08, orgs 1000…-01..03, orders 2000…-01..25.
-- ============================================================================

-- ── Auth users (8, password123; barbara is unverified) ──────────────────────

with pw as (
  select 'pbkdf2$1$5eedba5e5eedba5e5eedba5e5eedba5e$' ||
         encode(
           extensions.hmac(
             decode('5eedba5e5eedba5e5eedba5e5eedba5e', 'hex') || decode('00000001', 'hex'),
             convert_to('password123', 'utf8'),
             'sha256'
           ),
           'hex'
         ) as hash
)
insert into auth.users
  (id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, last_sign_in_at)
select
  v.id::uuid,
  'authenticated',
  'authenticated',
  v.email,
  pw.hash,
  case when v.confirmed then now() - (v.days_ago || ' days')::interval end,
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', v.full_name),
  now() - (v.days_ago || ' days')::interval,
  case when v.confirmed then now() - ((v.days_ago / 10) || ' days')::interval end
from (values
  ('00000000-0000-4000-8000-000000000001', 'ada@example.com',       'Ada Lovelace',        true,  240),
  ('00000000-0000-4000-8000-000000000002', 'grace@example.com',     'Grace Hopper',        true,  220),
  ('00000000-0000-4000-8000-000000000003', 'alan@example.com',      'Alan Turing',         true,  200),
  ('00000000-0000-4000-8000-000000000004', 'linus@example.com',     'Linus Torvalds',      true,  180),
  ('00000000-0000-4000-8000-000000000005', 'margaret@example.com',  'Margaret Hamilton',   true,  150),
  ('00000000-0000-4000-8000-000000000006', 'katherine@example.com', 'Katherine Johnson',   true,  120),
  ('00000000-0000-4000-8000-000000000007', 'dennis@example.com',    'Dennis Ritchie',      true,   90),
  ('00000000-0000-4000-8000-000000000008', 'barbara@example.com',   'Barbara Liskov',      false,  14)
) as v(id, email, full_name, confirmed, days_ago)
cross join pw
on conflict (id) do nothing;

-- Matching email identities (what GoTrue creates on signup)
insert into auth.identities (user_id, provider, provider_id, identity_data)
select u.id, 'email', u.id::text,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', u.email_confirmed_at is not null)
from auth.users u
where u.email like '%@example.com'
on conflict (provider, provider_id) do nothing;

-- ── Profiles ─────────────────────────────────────────────────────────────────

insert into public.profiles (id, username, full_name, avatar_url, bio, website)
select v.id::uuid, v.username, v.full_name, v.avatar_url, v.bio, v.website
from (values
  ('00000000-0000-4000-8000-000000000001', 'ada',       'Ada Lovelace',      '/storage/v1/object/public/avatars/ada.png',      'First programmer. Notes > code.',            'https://ada.example.com'),
  ('00000000-0000-4000-8000-000000000002', 'grace',     'Grace Hopper',      '/storage/v1/object/public/avatars/grace.png',    'It''s easier to ask forgiveness than permission.', 'https://grace.example.com'),
  ('00000000-0000-4000-8000-000000000003', 'alan',      'Alan Turing',       '/storage/v1/object/public/avatars/alan.png',     'Machines can think, discuss.',               null),
  ('00000000-0000-4000-8000-000000000004', 'linus',     'Linus Torvalds',    null,                                             'Talk is cheap. Show me the code.',           'https://kernel.example.com'),
  ('00000000-0000-4000-8000-000000000005', 'margaret',  'Margaret Hamilton', '/storage/v1/object/public/avatars/margaret.png', 'Software engineering, before it had a name.', null),
  ('00000000-0000-4000-8000-000000000006', 'katherine', 'Katherine Johnson', null,                                             'Counting on it.',                            null),
  ('00000000-0000-4000-8000-000000000007', 'dennis',    'Dennis Ritchie',    null,                                             'C and Unix. You''re welcome.',               'https://bell-labs.example.com'),
  ('00000000-0000-4000-8000-000000000008', 'barbara',   'Barbara Liskov',    null,                                             'Substitutability or bust.',                  null)
) as v(id, username, full_name, avatar_url, bio, website)
on conflict (id) do nothing;

-- ── Organizations & members ──────────────────────────────────────────────────

insert into public.organizations (id, name, slug, plan)
select v.id::uuid, v.name, v.slug, v.plan
from (values
  ('10000000-0000-4000-8000-000000000001', 'Acme Robotics',    'acme-robotics',    'pro'),
  ('10000000-0000-4000-8000-000000000002', 'Northwind Traders', 'northwind-traders', 'free'),
  ('10000000-0000-4000-8000-000000000003', 'Stellar Dynamics', 'stellar-dynamics', 'enterprise')
) as v(id, name, slug, plan)
on conflict (id) do nothing;

insert into public.org_members (org_id, user_id, role)
select v.org_id::uuid, v.user_id::uuid, v.role
from (values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'owner'),
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'admin'),
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'member'),
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000008', 'member'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000004', 'owner'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000005', 'member'),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000006', 'owner'),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000007', 'admin'),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 'member')
) as v(org_id, user_id, role)
on conflict (org_id, user_id) do nothing;

-- ── Products (40; 9/18/27/36 inactive) ───────────────────────────────────────
-- Explicit ids (OVERRIDING SYSTEM VALUE) so orders/items can reference them
-- deterministically; the identity sequence is bumped at the end of this file.

insert into public.products (id, sku, name, description, price, stock, tags, attributes, active)
overriding system value
select v.id, v.sku, v.name, v.description, v.price::numeric(10,2), v.stock,
       v.tags::text[], v.attributes::jsonb, v.active
from (values
  ( 1, 'ELEC-001', 'Aurora Wireless Headphones', 'Over-ear, 40h battery, ANC.',            129.99, 42, '{electronics,audio,wireless}',      '{"color":"black","battery_hours":40,"anc":true}',            true),
  ( 2, 'ELEC-002', 'Pulse Bluetooth Speaker',    'Pocket speaker with punchy bass.',        49.90, 120, '{electronics,audio,portable}',      '{"color":"teal","waterproof":"IPX7"}',                       true),
  ( 3, 'ELEC-003', 'Nimbus 4K Webcam',           'Sharp 4K sensor, dual mics.',             89.00,  35, '{electronics,video,work}',          '{"resolution":"4k","fov_deg":90}',                           true),
  ( 4, 'ELEC-004', 'Circuit Mechanical Keyboard','Hot-swappable switches, RGB.',           119.50,  60, '{electronics,keyboard,gaming}',     '{"layout":"tkl","switch":"brown","rgb":true}',               true),
  ( 5, 'ELEC-005', 'Drift Vertical Mouse',       'Ergonomic vertical mouse.',               39.99,  85, '{electronics,ergonomic}',           '{"dpi":3200,"buttons":6}',                                   true),
  ( 6, 'ELEC-006', 'Halo Ring Light 12"',        'Bi-color ring light with tripod.',        34.00,  50, '{electronics,video,studio}',        '{"diameter_in":12,"temp_range":"3200-5600K"}',               true),
  ( 7, 'ELEC-007', 'Volt 65W GaN Charger',       'Tiny 3-port fast charger.',               45.00, 200, '{electronics,charging,travel}',     '{"watts":65,"ports":3}',                                     true),
  ( 8, 'ELEC-008', 'Echo USB Microphone',        'Cardioid condenser for streaming.',       99.00,  28, '{electronics,audio,studio}',        '{"pattern":"cardioid","sample_rate_khz":96}',                true),
  ( 9, 'ELEC-009', 'Retro Portable CD Player',   'Discontinued classic.',                   59.00,   0, '{electronics,audio,retro}',         '{"skip_protection_s":45}',                                   false),
  (10, 'ELEC-010', 'Flux Smartwatch S2',         'AMOLED, GPS, 10-day battery.',           199.00,  33, '{electronics,wearable,fitness}',    '{"display":"amoled","gps":true,"battery_days":10}',          true),
  (11, 'HOME-001', 'Ember Pour-Over Kettle',     'Gooseneck kettle, 0.9L.',                 69.00,  40, '{home,kitchen,coffee}',             '{"capacity_l":0.9,"material":"steel"}',                      true),
  (12, 'HOME-002', 'Terra Ceramic Mug Set',      'Set of 4 stoneware mugs.',                32.00,  75, '{home,kitchen}',                    '{"pieces":4,"dishwasher_safe":true}',                        true),
  (13, 'HOME-003', 'Lumen Desk Lamp',            'Dimmable, wireless charging base.',       58.00,  44, '{home,office,lighting}',            '{"lumens":800,"qi_charging":true}',                          true),
  (14, 'HOME-004', 'Cloud Weighted Blanket',     '7kg, breathable cotton.',                 89.00,  22, '{home,bedroom,sleep}',              '{"weight_kg":7,"size":"queen"}',                             true),
  (15, 'HOME-005', 'Sprout Herb Garden Kit',     'Hydroponic countertop garden.',           74.50,  31, '{home,kitchen,garden}',             '{"pods":6,"grow_light":true}',                               true),
  (16, 'HOME-006', 'Piatto Serving Board',       'Acacia wood, 45cm.',                      27.00,  90, '{home,kitchen,wood}',               '{"length_cm":45,"material":"acacia"}',                       true),
  (17, 'HOME-007', 'Nest Storage Baskets',       'Set of 3 woven baskets.',                 41.00,  55, '{home,organization}',               '{"pieces":3,"material":"seagrass"}',                         true),
  (18, 'HOME-008', 'Glow Salt Lamp',             'Seasonal item, out of rotation.',         24.00,   0, '{home,lighting,retro}',             '{"weight_kg":3}',                                            false),
  (19, 'HOME-009', 'Brew French Press 1L',       'Double-wall stainless press.',            36.00,  62, '{home,kitchen,coffee}',             '{"capacity_l":1.0,"insulated":true}',                        true),
  (20, 'HOME-010', 'Zen Diffuser',               'Ultrasonic aroma diffuser.',              29.99,  70, '{home,wellness}',                   '{"tank_ml":300,"runtime_h":10}',                             true),
  (21, 'OUTD-001', 'Summit 2P Tent',             'Lightweight 3-season tent.',             249.00,  15, '{outdoors,camping}',                '{"capacity":2,"weight_kg":1.9,"season":3}',                  true),
  (22, 'OUTD-002', 'Trail Titanium Spork',       'Ultralight camp cutlery.',                 9.50, 300, '{outdoors,camping,ultralight}',     '{"weight_g":17,"material":"titanium"}',                      true),
  (23, 'OUTD-003', 'Cascade Water Filter',       'Squeeze filter, 0.1 micron.',             39.00,  48, '{outdoors,hiking,safety}',          '{"micron":0.1,"flow_lpm":1.7}',                              true),
  (24, 'OUTD-004', 'Nomad Down Jacket',          '800-fill packable down.',                179.00,  26, '{outdoors,apparel,winter}',         '{"fill_power":800,"packable":true,"color":"forest"}',        true),
  (25, 'OUTD-005', 'Ridge Trekking Poles',       'Carbon, cork grips, pair.',               74.00,  38, '{outdoors,hiking}',                 '{"material":"carbon","weight_g":420}',                       true),
  (26, 'OUTD-006', 'Basecamp Lantern',           'Rechargeable, 400 lumens.',               33.00,  57, '{outdoors,camping,lighting}',       '{"lumens":400,"usb_c":true}',                                true),
  (27, 'OUTD-007', 'Creek Fishing Vest',         'Superseded by new model.',                54.00,   0, '{outdoors,fishing,apparel}',        '{"pockets":14}',                                             false),
  (28, 'OUTD-008', 'Glacier Insulated Bottle',   '1L, keeps cold 24h.',                     28.00, 110, '{outdoors,hydration}',              '{"capacity_l":1.0,"cold_hours":24}',                         true),
  (29, 'BOOK-001', 'The Pragmatic Seeder',       'Essays on demo data done right.',         21.00,  64, '{books,software}',                  '{"pages":248,"format":"paperback"}',                         true),
  (30, 'BOOK-002', 'SQL for Small Teams',        'Practical Postgres patterns.',            27.50,  53, '{books,software,database}',         '{"pages":312,"format":"paperback"}',                         true),
  (31, 'BOOK-003', 'Notes on Computing',         'Selected letters, annotated.',            18.00,  47, '{books,history}',                   '{"pages":190,"format":"hardcover"}',                         true),
  (32, 'BOOK-004', 'Realtime Systems Field Guide','From polling to CDC.',                   24.00,  36, '{books,software}',                  '{"pages":275,"format":"ebook"}',                             true),
  (33, 'TOYS-001', 'Orbit Marble Run',           '120-piece modular marble run.',           44.00,  29, '{toys,kids,stem}',                  '{"pieces":120,"age_min":6}',                                 true),
  (34, 'TOYS-002', 'Pixel Building Blocks',      '500 micro blocks.',                       19.99,  88, '{toys,kids,creative}',              '{"pieces":500,"age_min":8}',                                 true),
  (35, 'TOYS-003', 'Robo Coding Turtle',         'Screen-free coding toy.',                 64.00,  21, '{toys,kids,stem,electronics}',      '{"age_min":4,"programmable":true}',                          true),
  (36, 'TOYS-004', 'Retro Yo-Yo Pro',            'Awaiting restock decision.',              12.00,   0, '{toys,retro}',                      '{"bearing":"ceramic"}',                                      false),
  (37, 'OFFC-001', 'Focus Standing Desk Mat',    'Anti-fatigue, 76x45cm.',                  49.00,  41, '{office,ergonomic}',                '{"size_cm":"76x45","thickness_mm":19}',                      true),
  (38, 'OFFC-002', 'Slate Notebook A5 (3-pack)', 'Dot grid, lay-flat binding.',             16.50, 140, '{office,stationery}',               '{"pieces":3,"ruling":"dot"}',                                true),
  (39, 'OFFC-003', 'Anchor Monitor Arm',         'Gas spring, fits 17-32".',                79.00,  27, '{office,ergonomic}',                '{"max_in":32,"vesa":"75x75/100x100"}',                       true),
  (40, 'OFFC-004', 'Quill Fountain Pen',         'Fine nib, brass body.',                   38.00,  52, '{office,stationery,gift}',          '{"nib":"fine","material":"brass"}',                          true)
) as v(id, sku, name, description, price, stock, tags, attributes, active)
on conflict (id) do nothing;

-- ── Orders (25 across all users and statuses) ────────────────────────────────

insert into public.orders (id, user_id, status, shipping_address, placed_at)
select v.id::uuid, v.user_id::uuid, v.status::public.order_status,
       v.address::jsonb, now() - (v.days_ago || ' days')::interval
from (values
  ('20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'pending',   '{"line1":"12 Analytical Way","city":"London","country":"GB","postal_code":"EC1A 1AA"}',  1),
  ('20000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', 'paid',      '{"line1":"7 Compiler Ct","city":"Arlington","state":"VA","country":"US","postal_code":"22201"}', 2),
  ('20000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003', 'shipped',   '{"line1":"36 Enigma Rd","city":"Bletchley","country":"GB","postal_code":"MK3 6EB"}',      4),
  ('20000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000004', 'delivered', '{"line1":"1991 Kernel St","city":"Helsinki","country":"FI","postal_code":"00100"}',      21),
  ('20000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000005', 'delivered', '{"line1":"11 Apollo Dr","city":"Cambridge","state":"MA","country":"US","postal_code":"02139"}', 34),
  ('20000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000006', 'pending',   '{"line1":"39 Orbit Ln","city":"Hampton","state":"VA","country":"US","postal_code":"23666"}', 0),
  ('20000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000007', 'paid',      '{"line1":"8 Bell Labs Pkwy","city":"Murray Hill","state":"NJ","country":"US","postal_code":"07974"}', 3),
  ('20000000-0000-4000-8000-000000000008', '00000000-0000-4000-8000-000000000008', 'shipped',   '{"line1":"77 Abstraction Ave","city":"Cambridge","state":"MA","country":"US","postal_code":"02142"}', 5),
  ('20000000-0000-4000-8000-000000000009', '00000000-0000-4000-8000-000000000001', 'delivered', '{"line1":"12 Analytical Way","city":"London","country":"GB","postal_code":"EC1A 1AA"}',  45),
  ('20000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000002', 'cancelled', '{"line1":"7 Compiler Ct","city":"Arlington","state":"VA","country":"US","postal_code":"22201"}', 18),
  ('20000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000003', 'pending',   '{"line1":"36 Enigma Rd","city":"Bletchley","country":"GB","postal_code":"MK3 6EB"}',      1),
  ('20000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000004', 'paid',      '{"line1":"1991 Kernel St","city":"Helsinki","country":"FI","postal_code":"00100"}',       6),
  ('20000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000005', 'shipped',   '{"line1":"11 Apollo Dr","city":"Cambridge","state":"MA","country":"US","postal_code":"02139"}', 7),
  ('20000000-0000-4000-8000-000000000014', '00000000-0000-4000-8000-000000000006', 'delivered', '{"line1":"39 Orbit Ln","city":"Hampton","state":"VA","country":"US","postal_code":"23666"}', 60),
  ('20000000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-000000000007', 'cancelled', '{"line1":"8 Bell Labs Pkwy","city":"Murray Hill","state":"NJ","country":"US","postal_code":"07974"}', 25),
  ('20000000-0000-4000-8000-000000000016', '00000000-0000-4000-8000-000000000008', 'pending',   '{"line1":"77 Abstraction Ave","city":"Cambridge","state":"MA","country":"US","postal_code":"02142"}', 0),
  ('20000000-0000-4000-8000-000000000017', '00000000-0000-4000-8000-000000000001', 'paid',      '{"line1":"12 Analytical Way","city":"London","country":"GB","postal_code":"EC1A 1AA"}',   2),
  ('20000000-0000-4000-8000-000000000018', '00000000-0000-4000-8000-000000000002', 'shipped',   '{"line1":"7 Compiler Ct","city":"Arlington","state":"VA","country":"US","postal_code":"22201"}', 9),
  ('20000000-0000-4000-8000-000000000019', '00000000-0000-4000-8000-000000000003', 'delivered', '{"line1":"36 Enigma Rd","city":"Bletchley","country":"GB","postal_code":"MK3 6EB"}',      75),
  ('20000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000004', 'cancelled', '{"line1":"1991 Kernel St","city":"Helsinki","country":"FI","postal_code":"00100"}',       11),
  ('20000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000005', 'pending',   '{"line1":"11 Apollo Dr","city":"Cambridge","state":"MA","country":"US","postal_code":"02139"}', 1),
  ('20000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-000000000006', 'paid',      '{"line1":"39 Orbit Ln","city":"Hampton","state":"VA","country":"US","postal_code":"23666"}', 4),
  ('20000000-0000-4000-8000-000000000023', '00000000-0000-4000-8000-000000000007', 'shipped',   '{"line1":"8 Bell Labs Pkwy","city":"Murray Hill","state":"NJ","country":"US","postal_code":"07974"}', 8),
  ('20000000-0000-4000-8000-000000000024', '00000000-0000-4000-8000-000000000008', 'paid',      '{"line1":"77 Abstraction Ave","city":"Cambridge","state":"MA","country":"US","postal_code":"02142"}', 3),
  ('20000000-0000-4000-8000-000000000025', '00000000-0000-4000-8000-000000000001', 'delivered', '{"line1":"12 Analytical Way","city":"London","country":"GB","postal_code":"EC1A 1AA"}',  90)
) as v(id, user_id, status, address, days_ago)
on conflict (id) do nothing;

-- ── Order items (49; unit_price snapshots the current catalog price) ─────────

insert into public.order_items (id, order_id, product_id, quantity, unit_price)
overriding system value
select v.id, v.order_id::uuid, v.product_id, v.qty, p.price
from (values
  ( 1, '20000000-0000-4000-8000-000000000001',  1, 1), ( 2, '20000000-0000-4000-8000-000000000001',  5, 2),
  ( 3, '20000000-0000-4000-8000-000000000002',  3, 1), ( 4, '20000000-0000-4000-8000-000000000002',  7, 1),
  ( 5, '20000000-0000-4000-8000-000000000002', 12, 2),
  ( 6, '20000000-0000-4000-8000-000000000003',  2, 1),
  ( 7, '20000000-0000-4000-8000-000000000004',  4, 3), ( 8, '20000000-0000-4000-8000-000000000004',  8, 1),
  ( 9, '20000000-0000-4000-8000-000000000005', 10, 1), (10, '20000000-0000-4000-8000-000000000005', 11, 1),
  (11, '20000000-0000-4000-8000-000000000005', 13, 1), (12, '20000000-0000-4000-8000-000000000005', 14, 2),
  (13, '20000000-0000-4000-8000-000000000006', 15, 1),
  (14, '20000000-0000-4000-8000-000000000007', 16, 2), (15, '20000000-0000-4000-8000-000000000007', 17, 1),
  (16, '20000000-0000-4000-8000-000000000008', 19, 1), (17, '20000000-0000-4000-8000-000000000008', 20, 1),
  (18, '20000000-0000-4000-8000-000000000009', 21, 1), (19, '20000000-0000-4000-8000-000000000009', 22, 2),
  (20, '20000000-0000-4000-8000-000000000009', 23, 1),
  (21, '20000000-0000-4000-8000-000000000010', 24, 1),
  (22, '20000000-0000-4000-8000-000000000011', 25, 2), (23, '20000000-0000-4000-8000-000000000011', 26, 1),
  (24, '20000000-0000-4000-8000-000000000012', 28, 1),
  (25, '20000000-0000-4000-8000-000000000013', 29, 1), (26, '20000000-0000-4000-8000-000000000013', 30, 4),
  (27, '20000000-0000-4000-8000-000000000014', 31, 1), (28, '20000000-0000-4000-8000-000000000014', 32, 1),
  (29, '20000000-0000-4000-8000-000000000015', 33, 2),
  (30, '20000000-0000-4000-8000-000000000016', 34, 1), (31, '20000000-0000-4000-8000-000000000016', 35, 1),
  (32, '20000000-0000-4000-8000-000000000016', 38, 1),
  (33, '20000000-0000-4000-8000-000000000017', 39, 1),
  (34, '20000000-0000-4000-8000-000000000018', 40, 1), (35, '20000000-0000-4000-8000-000000000018',  1, 1),
  (36, '20000000-0000-4000-8000-000000000019',  2, 2), (37, '20000000-0000-4000-8000-000000000019',  6, 1),
  (38, '20000000-0000-4000-8000-000000000020',  7, 1),
  (39, '20000000-0000-4000-8000-000000000021',  8, 1), (40, '20000000-0000-4000-8000-000000000021', 10, 2),
  (41, '20000000-0000-4000-8000-000000000022', 11, 1), (42, '20000000-0000-4000-8000-000000000022', 12, 1),
  (43, '20000000-0000-4000-8000-000000000022', 13, 2), (44, '20000000-0000-4000-8000-000000000022', 15, 1),
  (45, '20000000-0000-4000-8000-000000000023', 16, 1),
  (46, '20000000-0000-4000-8000-000000000024', 17, 2), (47, '20000000-0000-4000-8000-000000000024', 19, 1),
  (48, '20000000-0000-4000-8000-000000000025', 20, 1), (49, '20000000-0000-4000-8000-000000000025', 22, 1)
) as v(id, order_id, product_id, qty)
join public.products p on p.id = v.product_id
on conflict (id) do nothing;

-- Backfill totals from line items using the schema's own function.
update public.orders
set total = public.order_total(id)
where total is distinct from public.order_total(id);

-- ── Posts (15: 10 published, 5 drafts) ───────────────────────────────────────

insert into public.posts (id, author_id, title, slug, content, published, view_count, created_at)
overriding system value
select v.id, v.author_id::uuid, v.title, v.slug, v.content, v.published, v.views,
       now() - (v.days_ago || ' days')::interval
from (values
  ( 1, '00000000-0000-4000-8000-000000000001', 'Notes on the Analytical Engine',        'notes-analytical-engine',      'The engine weaves algebraic patterns just as the loom weaves flowers and leaves.', true,  842, 120),
  ( 2, '00000000-0000-4000-8000-000000000002', 'Why We Built the First Compiler',       'first-compiler',               'Nobody believed a computer could write its own programs. So we made it do exactly that.', true,  671,  98),
  ( 3, '00000000-0000-4000-8000-000000000003', 'On Computable Numbers, a Retrospective','on-computable-numbers',        'A machine with a tape, a head, and a table of rules is all you ever need.', true, 1204,  90),
  ( 4, '00000000-0000-4000-8000-000000000004', 'Just a Hobby, Won''t Be Big',           'just-a-hobby',                 'I''m doing a (free) operating system. It''s just a hobby, won''t be big and professional.', true, 2310,  80),
  ( 5, '00000000-0000-4000-8000-000000000005', 'Priority Displays and Moon Landings',   'priority-displays',            'The software flagged the overload, shed low-priority tasks, and the landing proceeded.', true,  530,  72),
  ( 6, '00000000-0000-4000-8000-000000000006', 'Checking the Machine''s Arithmetic',    'checking-the-machine',         'They trusted the computer only after I confirmed its numbers by hand.', true,  418,  60),
  ( 7, '00000000-0000-4000-8000-000000000007', 'The Case for Small Sharp Tools',        'small-sharp-tools',            'Write programs that do one thing well. Write programs that work together.', true,  962,  50),
  ( 8, '00000000-0000-4000-8000-000000000001', 'Poetry and Precision',                  'poetry-and-precision',         'Imagination is the discovering faculty, pre-eminently.', true,  204,  35),
  ( 9, '00000000-0000-4000-8000-000000000004', 'Release Early, Release Often',          'release-early-release-often',  'Given enough eyeballs, all bugs are shallow — but somebody still has to merge.', true,  777,  28),
  (10, '00000000-0000-4000-8000-000000000007', 'Hello, World: an Origin Story',         'hello-world-origin',           'It started as a test phrase in a tutorial. It outlived the machine it ran on.', true, 1533,  20),
  (11, '00000000-0000-4000-8000-000000000002', 'Draft: Grace''s Guide to Nanoseconds',  'guide-to-nanoseconds',         'A nanosecond is 11.8 inches of wire. I hand them out so people stop wasting them.', false,   0,  10),
  (12, '00000000-0000-4000-8000-000000000003', 'Draft: Imitation Games',                'imitation-games',              'Can machines think? Rephrase: can machines do what we (as thinking entities) can do?', false,   0,   8),
  (13, '00000000-0000-4000-8000-000000000005', 'Draft: Engineering the Word Software',  'engineering-word-software',    'We needed a term that demanded the same rigor as hardware engineering.', false,   0,   6),
  (14, '00000000-0000-4000-8000-000000000008', 'Draft: Substitution Without Tears',     'substitution-without-tears',   'If it looks like a duck and subtypes like a duck, it must be substitutable for a duck.', false,   0,   3),
  (15, '00000000-0000-4000-8000-000000000006', 'Draft: Trajectories by Hand',           'trajectories-by-hand',         'Before the machines were trusted, the trajectories were mine.', false,   0,   1)
) as v(id, author_id, title, slug, content, published, views, days_ago)
on conflict (id) do nothing;

-- ── Comments (50, with threaded replies) ─────────────────────────────────────

insert into public.comments (id, post_id, author_id, parent_id, body, created_at)
overriding system value
select v.id, v.post_id, v.author_id::uuid, v.parent_id,
       v.body, now() - ((80 - v.id) || ' hours')::interval
from (values
  ( 1,  1, '00000000-0000-4000-8000-000000000002', null::int, 'The loom metaphor holds up remarkably well a century on.'),
  ( 2,  1, '00000000-0000-4000-8000-000000000003', 1,         'Agreed — and the tape metaphor owes it a debt.'),
  ( 3,  1, '00000000-0000-4000-8000-000000000001', 2,         'You two are making me blush.'),
  ( 4,  1, '00000000-0000-4000-8000-000000000007', null,      'Patterns woven in brass. Beautiful.'),
  ( 5,  2, '00000000-0000-4000-8000-000000000004', null,      'And now compilers compile compilers. Turtles all the way down.'),
  ( 6,  2, '00000000-0000-4000-8000-000000000002', 5,         'Bootstrapping was the whole point!'),
  ( 7,  2, '00000000-0000-4000-8000-000000000005', null,      'A-0 walked so everything else could run.'),
  ( 8,  2, '00000000-0000-4000-8000-000000000006', null,      'The skepticism you faced sounds painfully familiar.'),
  ( 9,  3, '00000000-0000-4000-8000-000000000001', null,      'The universality argument still gives me chills.'),
  (10,  3, '00000000-0000-4000-8000-000000000003', 9,         'It gave the reviewers chills too, for different reasons.'),
  (11,  3, '00000000-0000-4000-8000-000000000007', null,      'One tape to rule them all.'),
  (12,  3, '00000000-0000-4000-8000-000000000008', null,      'The halting problem section deserves its own post.'),
  (13,  3, '00000000-0000-4000-8000-000000000003', 12,        'Drafting it — see "Imitation Games".'),
  (14,  4, '00000000-0000-4000-8000-000000000002', null,      'Famous last words, Linus.'),
  (15,  4, '00000000-0000-4000-8000-000000000004', 14,        'In my defense, it WAS a hobby for at least a week.'),
  (16,  4, '00000000-0000-4000-8000-000000000007', null,      'It ran on my machine. Eventually it ran on everyone''s.'),
  (17,  4, '00000000-0000-4000-8000-000000000001', null,      'The changelog alone is a literary genre now.'),
  (18,  4, '00000000-0000-4000-8000-000000000005', 16,        'Reliability at that scale is the real story.'),
  (19,  5, '00000000-0000-4000-8000-000000000006', null,      'The 1202 alarm story never gets old.'),
  (20,  5, '00000000-0000-4000-8000-000000000005', 19,        'Neither did the software, thankfully.'),
  (21,  5, '00000000-0000-4000-8000-000000000004', null,      'Priority scheduling before it was cool.'),
  (22,  6, '00000000-0000-4000-8000-000000000005', null,      'Astronauts asking for YOUR check is the ultimate code review.'),
  (23,  6, '00000000-0000-4000-8000-000000000006', 22,        'Highest-stakes LGTM of my career.'),
  (24,  6, '00000000-0000-4000-8000-000000000001', null,      'Verification by hand — the original CI.'),
  (25,  7, '00000000-0000-4000-8000-000000000004', null,      'Pipes remain the best API ever shipped.'),
  (26,  7, '00000000-0000-4000-8000-000000000007', 25,        'Ken deserves half the credit and most of the elegance.'),
  (27,  7, '00000000-0000-4000-8000-000000000002', null,      'Small tools, big systems. Still the way.'),
  (28,  7, '00000000-0000-4000-8000-000000000008', 27,        'Composability is just substitutability for programs.'),
  (29,  7, '00000000-0000-4000-8000-000000000003', null,      'grep is a Turing machine with better ergonomics.'),
  (30,  8, '00000000-0000-4000-8000-000000000003', null,      'Science needs the discovering faculty more than ever.'),
  (31,  8, '00000000-0000-4000-8000-000000000001', 30,        'Poetical science — I stand by the term.'),
  (32,  9, '00000000-0000-4000-8000-000000000007', null,      'Merging is a social problem wearing a technical costume.'),
  (33,  9, '00000000-0000-4000-8000-000000000004', 32,        'Which is why I wrote a tool for it. Twice.'),
  (34,  9, '00000000-0000-4000-8000-000000000002', null,      'Release often, apologize occasionally.'),
  (35,  9, '00000000-0000-4000-8000-000000000006', null,      'Shallow bugs still need someone to look.'),
  (36, 10, '00000000-0000-4000-8000-000000000001', null,      'The first program anyone runs, in every language.'),
  (37, 10, '00000000-0000-4000-8000-000000000007', 36,        'It was almost "hello, world!" with different punctuation.'),
  (38, 10, '00000000-0000-4000-8000-000000000004', 37,        'The punctuation debates continue in every style guide.'),
  (39, 10, '00000000-0000-4000-8000-000000000005', null,      'Ours said GO. Less friendly, more urgent.'),
  (40, 10, '00000000-0000-4000-8000-000000000008', null,      'A perfect minimal interface: one string, one effect.'),
  (41,  1, '00000000-0000-4000-8000-000000000006', null,      'The math holds up. I checked. Twice.'),
  (42,  2, '00000000-0000-4000-8000-000000000008', 6,         'Bootstrapping compilers is my favorite induction proof.'),
  (43,  3, '00000000-0000-4000-8000-000000000002', null,      'Required reading for every engineer on my team.'),
  (44,  4, '00000000-0000-4000-8000-000000000008', 15,        'Week two: professional. Week three: kernel mailing list.'),
  (45,  5, '00000000-0000-4000-8000-000000000007', null,      'Fault tolerance as a first-class feature. Ahead of its time.'),
  (46,  6, '00000000-0000-4000-8000-000000000004', null,      'Trust, but verify. Then verify the verifier.'),
  (47,  7, '00000000-0000-4000-8000-000000000005', 25,        'Pipes are priority displays for data.'),
  (48,  8, '00000000-0000-4000-8000-000000000002', null,      'More poetry in engineering, please.'),
  (49,  9, '00000000-0000-4000-8000-000000000008', 33,        'Both tools pass the substitution test, barely.'),
  (50, 10, '00000000-0000-4000-8000-000000000006', 36,        'And the last program many machines ever ran.')
) as v(id, post_id, author_id, parent_id, body)
on conflict (id) do nothing;

-- ── Support tickets (12; mixed priority, 5 resolved) ─────────────────────────

insert into public.support_tickets (id, user_id, subject, body, priority, resolved, created_at)
overriding system value
select v.id, v.user_id::uuid, v.subject, v.body, v.priority::public.ticket_priority, v.resolved,
       now() - (v.days_ago || ' days')::interval
from (values
  ( 1, '00000000-0000-4000-8000-000000000001', 'Order stuck in pending',            'Order 2000…01 has been pending for a day — card was charged.',        'high',   false, 1),
  ( 2, '00000000-0000-4000-8000-000000000002', 'Wrong color delivered',             'Ordered teal speaker, got black. Happy to swap.',                      'medium', true,  20),
  ( 3, '00000000-0000-4000-8000-000000000003', 'Cannot update profile website',     'Saving my profile drops the website field silently.',                 'low',    true,  18),
  ( 4, '00000000-0000-4000-8000-000000000004', 'Invoice needed for order 2000…12',  'Need a VAT invoice for the Helsinki shipment.',                        'medium', false, 5),
  ( 5, '00000000-0000-4000-8000-000000000005', 'Tent pole arrived bent',            'Summit 2P main pole has a kink; requesting replacement part.',         'high',   false, 3),
  ( 6, '00000000-0000-4000-8000-000000000006', 'Password reset email delayed',      'Reset email took 30 minutes to arrive.',                               'low',    true,  15),
  ( 7, '00000000-0000-4000-8000-000000000007', 'API webhook fires twice',           'Our fulfillment webhook receives duplicate order events.',             'urgent', false, 2),
  ( 8, '00000000-0000-4000-8000-000000000008', 'Cannot verify my email',            'Verification link says expired immediately after signup.',            'urgent', false, 1),
  ( 9, '00000000-0000-4000-8000-000000000001', 'Feature request: gift wrapping',    'Would love a gift-wrap option at checkout.',                           'low',    false, 9),
  (10, '00000000-0000-4000-8000-000000000004', 'Refund not received',               'Cancelled order 2000…20 eleven days ago, no refund yet.',              'high',   true,  8),
  (11, '00000000-0000-4000-8000-000000000005', 'Duplicate charge on card',          'Two identical charges for order 2000…13.',                             'medium', true,  6),
  (12, '00000000-0000-4000-8000-000000000002', 'Dark mode for the storefront',      'My eyes at 2am would appreciate it.',                                  'medium', false, 4)
) as v(id, user_id, subject, body, priority, resolved, days_ago)
on conflict (id) do nothing;

-- ── Scheduled jobs (cron emulation) ──────────────────────────────────────────
-- cron.schedule upserts by job name, so these are idempotent.

select cron.schedule('nightly-cleanup', '0 3 * * *', 'delete from auth.one_time_tokens where expires_at < now()');
select cron.schedule('refresh-stats', '*/30 * * * *', 'update products set stock = stock');

-- ── Message queues (pgmq emulation) ──────────────────────────────────────────

select pgmq.create('emails');
select pgmq.create('image-processing');

-- Only enqueue when the queues are empty so re-running the seed doesn't
-- duplicate messages.
do $$
begin
  if not exists (select 1 from pgmq.q_emails) then
    perform pgmq.send('emails', '{"template":"welcome","to":"ada@example.com","vars":{"name":"Ada"}}'::jsonb);
    perform pgmq.send('emails', '{"template":"order_confirmation","to":"grace@example.com","order_id":"20000000-0000-4000-8000-000000000002"}'::jsonb);
    perform pgmq.send('emails', '{"template":"shipping_update","to":"alan@example.com","order_id":"20000000-0000-4000-8000-000000000003","carrier":"RoyalPost"}'::jsonb);
    perform pgmq.send('emails', '{"template":"password_changed","to":"dennis@example.com"}'::jsonb);
    perform pgmq.send('emails', '{"template":"weekly_digest","to":"margaret@example.com","posts":[5,9,10]}'::jsonb);
  end if;
  if not exists (select 1 from pgmq."q_image-processing") then
    perform pgmq.send('image-processing', '{"op":"thumbnail","bucket":"avatars","path":"ada.png","sizes":[64,128]}'::jsonb);
    perform pgmq.send('image-processing', '{"op":"thumbnail","bucket":"avatars","path":"grace.png","sizes":[64,128]}'::jsonb);
    perform pgmq.send('image-processing', '{"op":"optimize","bucket":"documents","path":"reports/q1-report.md"}'::jsonb);
  end if;
end $$;

-- ── Storage buckets ──────────────────────────────────────────────────────────
-- (Objects/bytes are uploaded by scripts/seed.ts over HTTP; buckets exist
-- either way so the storage UI has something to show on a fresh boot.)

insert into storage.buckets (id, name, public) values
  ('avatars', 'avatars', true),
  ('documents', 'documents', false)
on conflict (id) do nothing;

-- ── Bump identity sequences past the explicit ids used above ─────────────────

select setval(pg_get_serial_sequence('public.products', 'id'),        greatest((select max(id) from public.products), 1));
select setval(pg_get_serial_sequence('public.order_items', 'id'),     greatest((select max(id) from public.order_items), 1));
select setval(pg_get_serial_sequence('public.posts', 'id'),           greatest((select max(id) from public.posts), 1));
select setval(pg_get_serial_sequence('public.comments', 'id'),        greatest((select max(id) from public.comments), 1));
select setval(pg_get_serial_sequence('public.support_tickets', 'id'), greatest((select max(id) from public.support_tickets), 1));
