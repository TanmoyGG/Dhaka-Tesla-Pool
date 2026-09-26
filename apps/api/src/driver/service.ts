// Driver workflow service (Phase 6, ADR-019): the driver surface over the
// pooling engine.
//
// The facade does not re-implement any rule — it narrows the pooling service
// to exactly the driver lifecycle operations and documents that the driver
// identity is passed ONLY from the authenticated request (never from the
// request body). Route handlers never see (and cannot call) the passenger
// facing match/cancel operations through this type.

import type { AppDatabase } from "../db/index.js";
import {
  createPoolingService,
  type DriverPoolView,
  type PoolingService,
} from "../rides/pooling/service.js";

export interface DriverService {
  setAvailability(driverId: string, isOnline: boolean): Promise<void>;
  acceptPool(driverId: string, poolId: string): Promise<DriverPoolView>;
  arrivePool(driverId: string, poolId: string): Promise<DriverPoolView>;
  startPool(driverId: string, poolId: string): Promise<DriverPoolView>;
  completePool(driverId: string, poolId: string): Promise<DriverPoolView>;
  listDriverPools(driverId: string): Promise<DriverPoolView[]>;
  getDriverPool(driverId: string, poolId: string): Promise<DriverPoolView>;
}

export function createDriverService(database: AppDatabase): DriverService {
  const pooling = createPoolingService({ database });
  return {
    setAvailability: pooling.setAvailability,
    acceptPool: pooling.acceptPool,
    arrivePool: pooling.arrivePool,
    startPool: pooling.startPool,
    completePool: pooling.completePool,
    listDriverPools: pooling.listDriverPools,
    getDriverPool: pooling.getDriverPool,
  };
}

export type { PoolingService };