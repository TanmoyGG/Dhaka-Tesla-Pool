"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { describeApiError } from "@/lib/api";
import { FareBreakdown } from "@/components/fare-breakdown";
import { FormField } from "@/components/form-field";
import { useCreateRide, useEstimateRide, useZones } from "@/lib/queries";
import type { RideView } from "@/lib/types";

const MAX_SEATS = 3;

const rideFormSchema = z
  .object({
    pickupZoneId: z.string().min(1, "Pickup zone is required"),
    destinationZoneId: z.string().min(1, "Destination zone is required"),
    requestedSeats: z
      .number({ invalid_type_error: "Seats are required" })
      .int()
      .min(1, "Book at least 1 seat")
      .max(MAX_SEATS, `A Tesla has only ${MAX_SEATS} seats`),
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

  const watched = watch();

  // If the destination is the same zone as the pickup, clear it automatically
  // so the form cannot silently submit an identical route (mirrors the backend
  // rule pickup != destination).
  useEffect(() => {
    if (watched.pickupZoneId && getValues("destinationZoneId") === watched.pickupZoneId) {
      setValue("destinationZoneId", "", { shouldValidate: true });
    }
  }, [watched.pickupZoneId, getValues, setValue]);

  // The estimate input is only "active" once the form is complete enough:
  // both zones chosen, seats in range, distinct route.
  const estimateInput = useMemo(() => {
    if (
      !watched.pickupZoneId ||
      !watched.destinationZoneId ||
      watched.pickupZoneId === watched.destinationZoneId ||
      typeof watched.requestedSeats !== "number" ||
      watched.requestedSeats < 1 ||
      watched.requestedSeats > MAX_SEATS
    ) {
      return null;
    }
    return {
      pickupZoneId: watched.pickupZoneId,
      destinationZoneId: watched.destinationZoneId,
      requestedSeats: watched.requestedSeats,
    };
  }, [watched.pickupZoneId, watched.destinationZoneId, watched.requestedSeats]);

  const estimate = useEstimateRide(estimateInput);

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
        <FormField id="pickupZoneId" label="Pickup zone" error={errors.pickupZoneId?.message}>
          <select id="pickupZoneId" {...register("pickupZoneId")} defaultValue="">
            <option value="" disabled>
              Select pickup…
            </option>
            {zones.data?.map((zone) => (
              <option key={zone.id} value={zone.id}>
                {zone.name}
              </option>
            ))}
          </select>
        </FormField>

        <FormField id="destinationZoneId" label="Destination zone" error={errors.destinationZoneId?.message}>
          <select id="destinationZoneId" {...register("destinationZoneId")} defaultValue="">
            <option value="" disabled>
              Select destination…
            </option>
            {zones.data?.map((zone) => (
              <option key={zone.id} value={zone.id}>
                {zone.name}
              </option>
            ))}
          </select>
        </FormField>

        <FormField id="requestedSeats" label="Seats" error={errors.requestedSeats?.message}>
          <select id="requestedSeats" {...register("requestedSeats", { valueAsNumber: true })} defaultValue={1}>
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
          </select>
        </FormField>
      </div>

      {estimateInput && estimate.isPending && (
        <p className="text-muted">Estimating your fare…</p>
      )}
      {estimateInput && estimate.isError && (
        <p className="error-text">
          Could not load the fare estimate: {describeApiError(estimate.error)}
        </p>
      )}
      {estimateInput && estimate.data && (
        <section aria-label="Fare estimate">
          <h3>Estimated fare</h3>
          <FareBreakdown fare={estimate.data} />
          <p className="text-small text-muted">
            This assumes you ride alone. When a second passenger joins your
            pool, a 25% pool discount applies to everyone on board.
          </p>
        </section>
      )}

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