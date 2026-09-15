import { Module } from "@nestjs/common";
import { ConsultingRequestWorkflowService } from "./consulting-request-workflow.service";
import { SecurityAssessmentWorkflowService } from "./security-assessment-workflow.service";
import { WorkflowValidationService } from "./workflow-validation.service";

/**
 * Wave 0D-6. `TransactionManager` comes from the `@Global()` DatabaseModule
 * (see security.module.ts's identical reliance on it), so it is not
 * re-imported here.
 */
@Module({
  providers: [
    WorkflowValidationService,
    ConsultingRequestWorkflowService,
    SecurityAssessmentWorkflowService,
  ],
  exports: [
    WorkflowValidationService,
    ConsultingRequestWorkflowService,
    SecurityAssessmentWorkflowService,
  ],
})
export class WorkflowModule {}
