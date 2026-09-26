DROP INDEX "pools_single_active_per_vehicle";--> statement-breakpoint
ALTER TABLE "pools" ALTER COLUMN "vehicle_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pools" ALTER COLUMN "driver_id" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "pools_single_accepted_per_driver" ON "pools" USING btree ("driver_id") WHERE "pools"."driver_id" is not null and "pools"."status" not in ('COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE UNIQUE INDEX "pools_single_accepted_per_vehicle" ON "pools" USING btree ("vehicle_id") WHERE "pools"."vehicle_id" is not null and "pools"."status" not in ('COMPLETED', 'CANCELLED');--> statement-breakpoint
ALTER TABLE "pools" ADD CONSTRAINT "pools_assignment_consistent" CHECK (("pools"."driver_id" is null) = ("pools"."vehicle_id" is null));--> statement-breakpoint
ALTER TABLE "pools" ADD CONSTRAINT "pools_driver_implies_accepted" CHECK ("pools"."driver_id" is null or "pools"."accepted_at" is not null);