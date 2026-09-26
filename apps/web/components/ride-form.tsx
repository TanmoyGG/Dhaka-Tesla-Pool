"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { describeApiError } from "@/lib/api";
import { useCreateRide, useZones } from "@/lib/queries";
import type { RideView } from "@/lib/types";

const rideFormSchema = z
  .object({
    pickupZoneId: z.string().min(1, "Pickup zone is required"),
    destinationZoneId: z.string().min(1, "Destination zone is required"),
    requestedSeats: z
      .number({ invalid_type_error: "Seats are required" })
      .int()
      .min(1, "Book at least 1 seat")
      .max(3, "A Tesla has only 3 seats"),
  })
  .superRefine((values, ctx) => {
    if (
      values.pickupZoneId &&
      values.destinationZoneId &&
      values.pickupZoneId === values.destinationZoneId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["destinationZoneId"],
        message: "Destination must differ from the pickup zone",
      });
    }
  });

type RideFormValues = z.infer<typeof rideFormSchema>;

const EMPTY_VALUES: RideFormValues = {
  pickupZoneId: "",
  destinationZoneId: "",
  requestedSeats: 1,
};

export function RideForm({ onBooked }: { onBooked: (ride: RideView) => void }) {
  const zones = useZones();
  const createRide = useCreateRide();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    getValues,
    watch,
    formState: { errors },
  } = useForm<RideFormValues>({
    resolver: zodResolver(rideFormSchema),
    defaultValues: EMPTY_VALUES,
    mode: "onSubmit",
  });

  const pickup = watch("pickupZoneId");

  // If the destination is the same zone as the pickup, clear it automatically
  // so the form cannot silently submit an identical route (mirrors the backend
  // rule pickup != destination).
  useEffect(() => {
    if (pickup && getValues("destinationZoneId") === pickup) {
      setValue("destinationZoneId", "", { shouldValidate: true });
    }
  }, [pickup, getValues, setValue]);

  function onSubmit(values: RideFormValues) {
    setServerError(null);
    createRide.mutateAsync(
      {
        pickupZoneId: values.pickupZoneId,
        destinationZoneId: values.destinationZoneId,
        requestedSeats: values.requestedSeats,
      },
      {
        onSuccess: (ride) => {
          onBooked(ride);
          reset(EMPTY_VALUES);
        },
        onError: () => {
          // Handled in the try/catch below (mutateAsync rejects).
        },
      },
    ).catch((err: unknown) => {
      setServerError(describeApiError(err));
    });
  }

  if (zones.isLoading) {
    return <p className="text-muted">Loading zones…</p>;
  }

  if (zones.isError) {
    return (
      <p className="error-text">
        Could not load zones: {describeApiError(zones.error)}
      </p>
    );
  }

  return (
    <form className="card" onSubmit={handleSubmit(onSubmit)} noValidate>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="pickupZoneId">Pickup zone</label>
          <select
            id="pickupZoneId"
            {...register("pickupZoneId")}
            defaultValue=""
          >
            <option value="" disabled>
              Select pickup…
            </option>
            {zones.data?.map((zone) => (
              <option key={zone.id} value={zone.id}>
                {zone.name}
              </option>
            ))}
          </select>
          {errors.pickupZoneId && (
            <p className="error-text">{errors.pickupZoneId.message}</p>
          )}
        </div>

        <div className="field">
          <label htmlFor="destinationZoneId">Destination zone</label>
          <select
            id="destinationZoneId"
            {...register("destinationZoneId")}
            defaultValue=""
          >
            <option value="" disabled>
              Select destination…
            </option>
            {zones.data?.map((zone) => (
              <option key={zone.id} value={zone.id}>
                {zone.name}
              </option>
            ))}
          </select>
          {errors.destinationZoneId && (
            <p className="error-text">{errors.destinationZoneId.message}</p>
          )}
        </div>

        <div className="field">
          <label htmlFor="requestedSeats">Seats</label>
          <select
            id="requestedSeats"
            {...register("requestedSeats", { valueAsNumber: true })}
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
          </select>
          {errors.requestedSeats && (
            <p className="error-text">{errors.requestedSeats.message}</p>
          )}
        </div>
      </div>

      {serverError && <p className="error-text">{serverError}</p>}

      <button
        type="submit"
        className="btn btn-primary"
        disabled={createRide.isPending}
      >
        {createRide.isPending ? "Booking…" : "Book ride"}
      </button>
    </form>
  );
}