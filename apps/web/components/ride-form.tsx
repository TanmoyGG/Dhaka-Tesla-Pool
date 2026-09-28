"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { describeApiError } from "@/lib/api";
import { formatPaisa } from "@/lib/format";
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

// Which zones the form currently holds, lifted to the workspace page so the
// map can give visual feedback (Phase 4, docs/frontend-design.md §5.2/§8).
export interface ZoneSelection {
  pickupZoneId?: string;
  destinationZoneId?: string;
}

export function RideForm({
  onBooked,
  onSelectionChange,
}: {
  onBooked: (ride: RideView) => void;
  onSelectionChange?: (selection: ZoneSelection) => void;
}) {
  const zones = useZones();
  const createRide = useCreateRide();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
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

  // Lift the current zone selection to the workspace so the map can highlight
  // the pickup/destination pins (and fit the route once both are chosen).
  useEffect(() => {
    onSelectionChange?.({
      pickupZoneId: watched.pickupZoneId,
      destinationZoneId: watched.destinationZoneId,
    });
  }, [watched.pickupZoneId, watched.destinationZoneId, onSelectionChange]);

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

  function swapRoute() {
    const pickup = getValues("pickupZoneId");
    const destination = getValues("destinationZoneId");
    if (!pickup || !destination) return;
    setValue("pickupZoneId", destination, { shouldValidate: true });
    setValue("destinationZoneId", pickup, { shouldValidate: true });
  }

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
          // Deliberately NOT reset: resetting would lift an empty selection to
          // the workspace and wipe the booked route off the map the moment it
          // becomes active. BookingArea swaps this form for the active-ride
          // notice as soon as the query refetch lands, and the form remounts
          // fresh (EMPTY_VALUES) for the next ride.
          onBooked(ride);
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
      {/* Route: pickup → destination. Two columns on wider panels so the
          Destination label no longer wraps and knocks its select out of line. */}
      <section aria-labelledby="route-heading">
        <h2 id="route-heading" className="route-heading">
          Where to?
        </h2>
        <div className="route-grid">
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

          <FormField
            id="destinationZoneId"
            label="Destination zone"
            error={errors.destinationZoneId?.message}
          >
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
        </div>

        {watched.pickupZoneId && watched.destinationZoneId && (
          <p className="route-swap">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={swapRoute}
            >
              ⇄ Swap pickup and destination
            </button>
          </p>
        )}
      </section>

      <div className="field seats-field">
        <span className="field-label" id="seats-label">
          Seats
        </span>
        <div role="group" aria-labelledby="seats-label" className="segment">
          {[1, 2, 3].map((seats) => (
            <button
              key={seats}
              type="button"
              className="segment-option"
              aria-pressed={watched.requestedSeats === seats}
              onClick={() => setValue("requestedSeats", seats, { shouldValidate: true })}
            >
              {seats}
            </button>
          ))}
        </div>
        <p className="text-small text-muted field-hint">
          A Tesla has {MAX_SEATS} seats — book for you and your group.
        </p>
        {errors.requestedSeats?.message && (
          <p className="error-text" role="alert">
            {errors.requestedSeats.message}
          </p>
        )}
      </div>

      {estimateInput && estimate.isPending && (
        <p className="text-muted estimate-note" role="status">
          Estimating your fare…
        </p>
      )}
      {estimateInput && estimate.isError && (
        <p className="error-text">
          Could not load the fare estimate: {describeApiError(estimate.error)}
        </p>
      )}
      {estimateInput && estimate.data && (
        <section aria-label="Estimated fare" className="estimate-block">
          <div className="estimate-head">
            <h3 className="estimate-title">Estimated fare</h3>
            <span className="estimate-total">
              {formatPaisa(estimate.data.estimatedTotalPaisa)}
            </span>
          </div>
          <FareBreakdown fare={estimate.data} />
          <p className="text-small text-muted">
            Seat fares assume a solo ride — every seat pays 25% less once your
            ride shares a Tesla with another passenger.
          </p>
        </section>
      )}

      {serverError && <p className="error-text">{serverError}</p>}

      <button
        type="submit"
        className="btn btn-primary"
        disabled={createRide.isPending}
        aria-busy={createRide.isPending}
      >
        {createRide.isPending ? "Booking…" : "Book ride"}
      </button>
    </form>
  );
}