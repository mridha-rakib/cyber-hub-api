import { FilePolicyNotConfiguredException } from "../../../core/errors/app.exception";

/**
 * D6-3 artifact gate seam. A successful API-RPT-008 release requires a READY
 * SECURITY_REPORT stored object, which requires the GAP-013 file/storage
 * policy and the Wave 7 object storage (US-SYS-001). Neither exists, so this
 * gate is deterministic and has no configuration input: it always rejects.
 * Wave 7 replaces it together with the real release persistence path; Wave 6B
 * contains no code that writes a RELEASED report.
 */
export function assertReportFilePolicyConfigured(): never {
  throw new FilePolicyNotConfiguredException();
}
