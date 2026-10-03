import type { CallerFactField, CallerFactPatch, CallerFacts } from "./contract-types.ts";

export type FactKind = "text" | "count" | "boolean";

export const FACT_KINDS: Readonly<Record<CallerFactField, FactKind>> = {
  incidentType: "text",
  locationText: "text",
  peopleInvolved: "count",
  callerReportedConscious: "boolean",
  callerReportedBreathing: "boolean",
  fireOrSmoke: "boolean",
  trappedPerson: "boolean",
  violentThreat: "boolean",
  injuryReported: "boolean",
};

export const CALLER_FACT_FIELDS = Object.keys(FACT_KINDS) as CallerFactField[];

export function isCallerFactField(value: unknown): value is CallerFactField {
  return typeof value === "string" && Object.hasOwn(FACT_KINDS, value);
}

export function emptyFacts(): CallerFacts {
  return {
    incidentType: null,
    locationText: null,
    peopleInvolved: null,
    callerReportedConscious: null,
    callerReportedBreathing: null,
    fireOrSmoke: null,
    trappedPerson: null,
    violentThreat: null,
    injuryReported: null,
  };
}

/** Checks a single value against the contract type for its field. */
export function isValidFactValue(field: CallerFactField, value: unknown): boolean {
  if (value === null) return true;
  switch (FACT_KINDS[field]) {
    case "text":
      return typeof value === "string" && value.trim().length > 0;
    case "count":
      return typeof value === "number" && Number.isInteger(value) && value >= 0;
    case "boolean":
      return typeof value === "boolean";
  }
}

/**
 * Contract merge: an omitted field retains the stored value, an explicit null
 * clears it to unknown, and any other value replaces it.
 */
export function mergeFacts(current: CallerFacts, patch: CallerFactPatch): CallerFacts {
  const merged = { ...current };
  for (const field of CALLER_FACT_FIELDS) {
    if (Object.hasOwn(patch, field) && patch[field] !== undefined) {
      (merged as Record<CallerFactField, unknown>)[field] = patch[field];
    }
  }
  return merged;
}
