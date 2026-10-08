export interface ValidationIssue {
  field: string;
  code:
    | "REQUIRED"
    | "INVALID_MONEY"
    | "NON_FINITE_MONEY"
    | "NEGATIVE_VALUE"
    | "NON_POSITIVE_VALUE"
    | "INVALID_NUMBER"
    | "INVALID_DATE"
    | "INVALID_PERIOD";
  message: string;
}

export class ModelValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super(issues.map((issue) => `${issue.field}: ${issue.message}`).join("; "));
    this.name = "ModelValidationError";
    this.issues = issues;
  }
}
