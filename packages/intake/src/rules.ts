// Synthetic demonstration rules from docs/CONTRACT.md. These are fixture logic,
// not clinical or operational triage guidance. Gemini never decides services.

import { NO_RULE_REASON, type CallerFacts, type Recommendation, type Service } from "@flare/contracts";

export { NO_RULE_REASON };

interface DemoRule {
  id: string;
  matches: (facts: CallerFacts) => boolean;
  services: Service[];
  description: string;
}

export const DEMO_RULES: readonly DemoRule[] = [
  { id: "DEMO_FIRE", matches: (f) => f.fireOrSmoke === true, services: ["FIRE"], description: "caller reported fire or smoke" },
  { id: "DEMO_TRAPPED", matches: (f) => f.trappedPerson === true, services: ["FIRE", "EMS"], description: "caller reported a trapped person" },
  { id: "DEMO_INJURY", matches: (f) => f.injuryReported === true, services: ["EMS"], description: "caller reported an injury" },
  { id: "DEMO_CONSCIOUS", matches: (f) => f.callerReportedConscious === false, services: ["EMS"], description: "caller reported someone not conscious" },
  { id: "DEMO_BREATHING", matches: (f) => f.callerReportedBreathing === false, services: ["EMS"], description: "caller reported someone not breathing" },
  { id: "DEMO_THREAT", matches: (f) => f.violentThreat === true, services: ["POLICE"], description: "caller reported a violent threat" },
];

const SERVICE_ORDER: readonly Service[] = ["POLICE", "FIRE", "EMS"];

/** Pure function of merged caller facts. Null/missing facts match no rule. */
export function recommendServices(facts: CallerFacts): Recommendation {
  const matched = DEMO_RULES.filter((rule) => rule.matches(facts));
  if (matched.length === 0) {
    return { services: [], ruleIds: [], reason: NO_RULE_REASON };
  }
  const wanted = new Set(matched.flatMap((rule) => rule.services));
  return {
    services: SERVICE_ORDER.filter((service) => wanted.has(service)),
    ruleIds: matched.map((rule) => rule.id),
    reason: `Simulated demo recommendation: ${matched.map((r) => `${r.description} (${r.id})`).join("; ")}.`,
  };
}
