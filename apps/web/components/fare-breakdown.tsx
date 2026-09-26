import { formatPaisa } from "@/lib/format";
import type { FareView } from "@/lib/types";

// Full fare breakup for a booked ride, and the identical user-facing text for
// the pre-booking estimate. The pool-discount row only appears when a discount
// actually applies (25% once a second passenger joins the pool); a plain solo
// ride shows no invented discount.
export function FareBreakdown({ fare }: { fare: FareView }) {
  return (
    <dl className="dl">
      <div>
        <dt>Base fare</dt>
        <dd>{formatPaisa(fare.baseFarePaisa)}</dd>
      </div>
      <div>
        <dt>Distance charge</dt>
        <dd>{formatPaisa(fare.distanceChargePaisa)}</dd>
      </div>
      {fare.poolDiscountPaisa > 0 && (
        <div>
          <dt>Pool discount (shared ride)</dt>
          <dd>−{formatPaisa(fare.poolDiscountPaisa)}</dd>
        </div>
      )}
      <div>
        <dt>Fare per seat</dt>
        <dd>{formatPaisa(fare.perSeatFarePaisa)}</dd>
      </div>
      <div>
        <dt>Final fare</dt>
        <dd>{formatPaisa(fare.finalFarePaisa)}</dd>
      </div>
      <div>
        <dt>Estimated total ({fare.currency})</dt>
        <dd className="total">{formatPaisa(fare.estimatedTotalPaisa)}</dd>
      </div>
    </dl>
  );
}