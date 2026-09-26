import { formatPaisa } from "@/lib/format";
import type { FareView } from "@/lib/types";

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
      <div>
        <dt>Pool discount</dt>
        <dd>{fare.poolDiscountPaisa > 0 ? `−${formatPaisa(fare.poolDiscountPaisa)}` : formatPaisa(0)}</dd>
      </div>
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