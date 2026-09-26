// postgres-js surfaces constraint violations as an error whose .cause is the
// PostgresError carrying the SQLSTATE code (23505 = unique_violation) and the
// name of the violated constraint. These helpers unpack that shape for the
// services that must resolve a DB-level race back to a typed application error.

export function isUniqueViolation(error: unknown): boolean {
  const code =
    (error as { code?: string } | undefined)?.code ??
    (error as { cause?: { code?: string } } | undefined)?.cause?.code;
  return code === "23505";
}

// The name of the violated constraint (also nested under .cause). Used to tell
// which partial unique index an application race reached on disk.
export function violatedConstraintName(error: unknown): string | null {
  const direct = (error as { constraint_name?: string } | undefined)
    ?.constraint_name;
  const nested = (error as { cause?: { constraint_name?: string } } | undefined)
    ?.cause?.constraint_name;
  return direct ?? nested ?? null;
}