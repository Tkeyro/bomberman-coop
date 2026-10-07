CREATE TABLE `bm_rooms` (
  `code` text PRIMARY KEY NOT NULL,
  `host_member_id` text NOT NULL,
  `mode` text NOT NULL,
  `world` integer NOT NULL,
  `slots` integer NOT NULL,
  `patch_revision` text NOT NULL,
  `rom_hash` text NOT NULL,
  `status` text NOT NULL,
  `generation` integer DEFAULT 0 NOT NULL,
  `checkpoint_json` text,
  `start_id` text,
  `started_at` integer,
  `created_at` integer NOT NULL,
  `expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `bm_rooms_expiry_idx` ON `bm_rooms` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `bm_members` (
  `id` text PRIMARY KEY NOT NULL,
  `room_code` text NOT NULL REFERENCES `bm_rooms`(`code`) ON DELETE CASCADE,
  `player_id` text NOT NULL,
  `name` text NOT NULL,
  `color` text NOT NULL,
  `ready` integer DEFAULT 0 NOT NULL,
  `token_hash` text NOT NULL,
  `joined_at` integer NOT NULL,
  `last_seen` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bm_members_player_idx` ON `bm_members` (`room_code`,`player_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `bm_members_token_idx` ON `bm_members` (`token_hash`);
--> statement-breakpoint
CREATE TABLE `bm_signals` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `room_code` text NOT NULL REFERENCES `bm_rooms`(`code`) ON DELETE CASCADE,
  `from_player_id` text NOT NULL,
  `to_player_id` text NOT NULL,
  `payload_json` text NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `bm_signals_recipient_idx` ON `bm_signals` (`room_code`,`to_player_id`,`id`);
--> statement-breakpoint
CREATE INDEX `bm_signals_expiry_idx` ON `bm_signals` (`room_code`,`created_at`);
