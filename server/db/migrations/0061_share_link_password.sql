ALTER TABLE "canvases" ADD COLUMN "link_password" text;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "link_canvas_id" text;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "link_key" text;