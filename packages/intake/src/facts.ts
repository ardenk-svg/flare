import { CALLER_FACT_KINDS, type CallerFactField } from "@flare/contracts";

// Shared fact helpers live in @flare/contracts; re-exported for intake consumers.
export { CALLER_FACT_FIELDS, CALLER_FACT_KINDS, emptyFacts, mergeFacts } from "@flare/contracts";

export function isCallerFactField(value: unknown): value is CallerFactField {
  return typeof value === "string" && Object.hasOwn(CALLER_FACT_KINDS, value);
}

/** Checks a single value against the contract type for its field. */
export function isValidFactValue(field: CallerFactField, value: unknown): boolean {
  if (value === null) return true;
  switch (CALLER_FACT_KINDS[field]) {
    case "text":
      return typeof value === "string" && value.trim().length > 0;
    case "count":
      return typeof value === "number" && Number.isInteger(value) && value >= 0;
    case "bool":
      return typeof value === "boolean";
  }
}
