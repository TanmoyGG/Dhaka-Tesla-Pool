import postgres from "postgres";
import { config } from "../src/config.js";

const sql = postgres(config.databaseUrl);

const riders = await sql`select count(*)::int as c from ride_requests`;
console.log("ride_requests total:", JSON.stringify(riders[0]));

const byPassenger = await sql`
  select u.email, r.status, count(*)::int as c
  from ride_requests r
  join users u on u.id = r.passenger_id
  group by u.email, r.status
  order by u.email, r.status`;
console.log("rides by passenger/status:", JSON.stringify(byPassenger));

const multiActive = await sql`
  select u.email, count(*)::int as c
  from ride_requests r
  join users u on u.id = r.passenger_id
  where r.status not in ('COMPLETED', 'CANCELLED')
  group by u.email
  having count(*) > 1`;
console.log("passengers with >1 ACTIVE ride:", JSON.stringify(multiActive));

const pools = await sql`select status, count(*)::int as c from pools group by status`;
console.log("pools:", JSON.stringify(pools));

const members = await sql`select status, count(*)::int as c from pool_members group by status`;
console.log("pool_members:", JSON.stringify(members));

const fares = await sql`select count(*)::int as c from fares`;
console.log("fares total:", JSON.stringify(fares[0]));

const vehicles = await sql`select name, is_online from vehicles`;
console.log("vehicles:", JSON.stringify(vehicles));

const users = await sql`select email, role, active from users order by email`;
console.log("users:", JSON.stringify(users));

await sql.end();