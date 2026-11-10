CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`updated` integer NOT NULL,
	`snapshot` text NOT NULL
);
