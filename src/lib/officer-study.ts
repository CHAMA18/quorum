/**
 * Officer-study capture: turn the prepared validation protocol into data.
 *
 * Each observation is one officer reviewing one case, assisted or manual.
 * The summary refuses to claim a benefit from fewer than the minimum paired
 * observations, matching the repo's rule that impact is unmeasured until a
 * real counterbalanced study completes.
 */

export interface StudyObservation {
  officerId: string;
  caseId: string;
  assisted: boolean;
  minutes: number;
  materialIssuesFound: number;
  materialIssuesTotal: number;
  corrections: number;
}

export interface StudySummary {
  observations: number;
  assistedAvgMinutes: number | null;
  manualAvgMinutes: number | null;
  timeSavedPct: number | null;
  assistedRecall: number | null;
  manualRecall: number | null;
  claimable: boolean;
  note: string;
}

const MIN_PAIRED = 2;

function avg(v: number[]): number | null { return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }
function recall(obs: StudyObservation[]): number | null {
  const total = obs.reduce((n, o) => n + o.materialIssuesTotal, 0);
  return total > 0 ? obs.reduce((n, o) => n + o.materialIssuesFound, 0) / total : null;
}

export function summarizeStudy(obs: readonly StudyObservation[]): StudySummary {
  const assisted = obs.filter((o) => o.assisted), manual = obs.filter((o) => !o.assisted);
  const aMin = avg(assisted.map((o) => o.minutes)), mMin = avg(manual.map((o) => o.minutes));
  const claimable = assisted.length >= MIN_PAIRED && manual.length >= MIN_PAIRED;
  return {
    observations: obs.length,
    assistedAvgMinutes: aMin,
    manualAvgMinutes: mMin,
    timeSavedPct: claimable && aMin !== null && mMin !== null && mMin > 0 ? ((mMin - aMin) / mMin) * 100 : null,
    assistedRecall: recall(assisted),
    manualRecall: recall(manual),
    claimable,
    note: claimable ? "Minimum paired observations met; figures may be reported with method." : "Not yet claimable: impact remains unmeasured until paired observations complete.",
  };
}
