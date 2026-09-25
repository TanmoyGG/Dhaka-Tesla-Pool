ALTER TYPE "public"."user_role" ADD VALUE 'ADMIN';--> statement-breakpoint
ALTER TABLE "sessions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "sessions" CASCADE;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "clerk_user_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_clerk_user_id_unique" UNIQUE("clerk_user_id");