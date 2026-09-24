CREATE TYPE "public"."pool_member_status" AS ENUM('ACTIVE', 'LEFT');--> statement-breakpoint
CREATE TYPE "public"."ride_status" AS ENUM('REQUESTED', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('PASSENGER', 'DRIVER');--> statement-breakpoint
CREATE TABLE "fares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ride_request_id" uuid NOT NULL,
	"base_fare_paisa" integer NOT NULL,
	"distance_charge_paisa" integer NOT NULL,
	"pool_discount_paisa" integer NOT NULL,
	"final_fare_paisa" integer NOT NULL,
	"currency" char(3) DEFAULT 'BDT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fares_one_per_ride_request" UNIQUE("ride_request_id"),
	CONSTRAINT "fares_monetary_non_negative" CHECK ("fares"."base_fare_paisa" >= 0 and "fares"."distance_charge_paisa" >= 0 and "fares"."pool_discount_paisa" >= 0 and "fares"."final_fare_paisa" >= 0),
	CONSTRAINT "fares_final_equals_formula" CHECK ("fares"."final_fare_paisa" = "fares"."base_fare_paisa" + "fares"."distance_charge_paisa" - "fares"."pool_discount_paisa"),
	CONSTRAINT "fares_currency_format" CHECK (length("fares"."currency") = 3 and "fares"."currency" = upper("fares"."currency"))
);
--> statement-breakpoint
CREATE TABLE "pool_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pool_id" uuid NOT NULL,
	"ride_request_id" uuid NOT NULL,
	"passenger_id" uuid NOT NULL,
	"seats" integer NOT NULL,
	"status" "pool_member_status" DEFAULT 'ACTIVE' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	CONSTRAINT "pool_members_pool_request_unique" UNIQUE("pool_id","ride_request_id"),
	CONSTRAINT "pool_members_seats_positive" CHECK ("pool_members"."seats" > 0),
	CONSTRAINT "pool_members_left_timestamp" CHECK (("pool_members"."status" = 'LEFT') = ("pool_members"."left_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "pools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"status" "ride_status" DEFAULT 'REQUESTED' NOT NULL,
	"capacity_snapshot" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "pools_capacity_snapshot_positive" CHECK ("pools"."capacity_snapshot" > 0),
	CONSTRAINT "pools_started_timestamp" CHECK ("pools"."started_at" is null or "pools"."status" in ('STARTED', 'COMPLETED')),
	CONSTRAINT "pools_complete_timestamp" CHECK (("pools"."status" = 'COMPLETED') = ("pools"."completed_at" is not null)),
	CONSTRAINT "pools_complete_requires_started" CHECK ("pools"."status" <> 'COMPLETED' or "pools"."started_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "ride_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"passenger_id" uuid NOT NULL,
	"pickup_zone_id" uuid NOT NULL,
	"destination_zone_id" uuid NOT NULL,
	"requested_seats" integer NOT NULL,
	"status" "ride_status" DEFAULT 'REQUESTED' NOT NULL,
	"pool_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "ride_requests_seats_positive" CHECK ("ride_requests"."requested_seats" > 0),
	CONSTRAINT "ride_requests_pickup_ne_destination" CHECK ("ride_requests"."pickup_zone_id" <> "ride_requests"."destination_zone_id"),
	CONSTRAINT "ride_requests_cancel_timestamp" CHECK (("ride_requests"."status" = 'CANCELLED') = ("ride_requests"."cancelled_at" is not null)),
	CONSTRAINT "ride_requests_complete_timestamp" CHECK (("ride_requests"."status" = 'COMPLETED') = ("ride_requests"."completed_at" is not null)),
	CONSTRAINT "ride_requests_single_terminal" CHECK ("ride_requests"."cancelled_at" is null or "ride_requests"."completed_at" is null),
	CONSTRAINT "ride_requests_pool_requires_matched" CHECK ("ride_requests"."pool_id" is null or "ride_requests"."status" <> 'REQUESTED')
);
--> statement-breakpoint
CREATE TABLE "ride_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ride_request_id" uuid NOT NULL,
	"from_status" "ride_status",
	"status" "ride_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ride_status_history_no_same_transition" CHECK ("ride_status_history"."from_status" is null or "ride_status_history"."from_status" <> "ride_status_history"."status")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'PASSENGER' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_name_not_empty" CHECK (length(btrim("users"."name")) > 0),
	CONSTRAINT "users_email_lowercase" CHECK ("users"."email" = lower("users"."email"))
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"name" text NOT NULL,
	"capacity" integer NOT NULL,
	"is_online" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_name_not_empty" CHECK (length(btrim("vehicles"."name")) > 0),
	CONSTRAINT "vehicles_capacity_positive" CHECK ("vehicles"."capacity" > 0)
);
--> statement-breakpoint
CREATE TABLE "zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "zones_name_unique" UNIQUE("name"),
	CONSTRAINT "zones_name_not_empty" CHECK (length(btrim("zones"."name")) > 0),
	CONSTRAINT "zones_latitude_range" CHECK ("zones"."latitude" between -90 and 90),
	CONSTRAINT "zones_longitude_range" CHECK ("zones"."longitude" between -180 and 180)
);
--> statement-breakpoint
ALTER TABLE "fares" ADD CONSTRAINT "fares_ride_request_id_ride_requests_id_fk" FOREIGN KEY ("ride_request_id") REFERENCES "public"."ride_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_members" ADD CONSTRAINT "pool_members_pool_id_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."pools"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_members" ADD CONSTRAINT "pool_members_ride_request_id_ride_requests_id_fk" FOREIGN KEY ("ride_request_id") REFERENCES "public"."ride_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_members" ADD CONSTRAINT "pool_members_passenger_id_users_id_fk" FOREIGN KEY ("passenger_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pools" ADD CONSTRAINT "pools_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pools" ADD CONSTRAINT "pools_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_passenger_id_users_id_fk" FOREIGN KEY ("passenger_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_pickup_zone_id_zones_id_fk" FOREIGN KEY ("pickup_zone_id") REFERENCES "public"."zones"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_destination_zone_id_zones_id_fk" FOREIGN KEY ("destination_zone_id") REFERENCES "public"."zones"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_pool_id_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."pools"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_status_history" ADD CONSTRAINT "ride_status_history_ride_request_id_ride_requests_id_fk" FOREIGN KEY ("ride_request_id") REFERENCES "public"."ride_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pool_members_one_active_per_request" ON "pool_members" USING btree ("ride_request_id") WHERE "pool_members"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "pool_members_pool_status_idx" ON "pool_members" USING btree ("pool_id","status");--> statement-breakpoint
CREATE INDEX "pool_members_ride_request_idx" ON "pool_members" USING btree ("ride_request_id");--> statement-breakpoint
CREATE INDEX "pool_members_passenger_idx" ON "pool_members" USING btree ("passenger_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pools_single_active_per_vehicle" ON "pools" USING btree ("vehicle_id") WHERE "pools"."status" not in ('COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE INDEX "pools_vehicle_idx" ON "pools" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "pools_driver_idx" ON "pools" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "pools_status_idx" ON "pools" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ride_requests_passenger_history_idx" ON "ride_requests" USING btree ("passenger_id","created_at");--> statement-breakpoint
CREATE INDEX "ride_requests_status_idx" ON "ride_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ride_requests_pool_idx" ON "ride_requests" USING btree ("pool_id");--> statement-breakpoint
CREATE INDEX "ride_status_history_transitions_idx" ON "ride_status_history" USING btree ("ride_request_id","created_at");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "vehicles_driver_id_idx" ON "vehicles" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "vehicles_is_online_idx" ON "vehicles" USING btree ("is_online") WHERE "vehicles"."is_online";