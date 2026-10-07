ALTER TABLE `bm_rooms` ADD COLUMN `transport` text DEFAULT 'sync' NOT NULL CHECK (`transport` IN ('sync', 'stream'));
