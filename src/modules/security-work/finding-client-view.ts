import { vulnerabilityFindings } from "../../infrastructure/database/schema";

/**
 * FindingClientView columns (API Contract v1.3/v1.4): selected explicitly so
 * description, evidenceSummary, createdBy, stateVersion and other internal
 * finding fields never reach a Business query result.
 */
export const findingClientColumns = {
  id: vulnerabilityFindings.id,
  title: vulnerabilityFindings.title,
  severity: vulnerabilityFindings.severity,
  recommendation: vulnerabilityFindings.recommendation,
  status: vulnerabilityFindings.status,
  resolvedAt: vulnerabilityFindings.resolvedAt,
  createdAt: vulnerabilityFindings.createdAt,
};

type FindingClientRow = {
  id: string;
  title: string;
  severity: (typeof vulnerabilityFindings.$inferSelect)["severity"];
  recommendation: string;
  status: (typeof vulnerabilityFindings.$inferSelect)["status"];
  resolvedAt: Date | null;
  createdAt: Date;
};

/**
 * Client-safe finding projection with live values (D-1, D6-7). resolvedAt is
 * present only while the finding is RESOLVED (API Contract v1.2 rule).
 */
export function findingClientView(row: FindingClientRow) {
  return {
    id: row.id,
    title: row.title,
    severity: row.severity,
    recommendation: row.recommendation,
    status: row.status,
    ...(row.status === "RESOLVED" ? { resolvedAt: row.resolvedAt } : {}),
    createdAt: row.createdAt,
  };
}
