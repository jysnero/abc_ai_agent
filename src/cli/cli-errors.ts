export enum ExitCode {
  SUCCESS = 0,
  CLI_ARGS_ERROR = 2,
  INPUT_FILE_ERROR = 3,
  RUN_NOT_FOUND_ERROR = 4,
  INVALID_STATE_ERROR = 5,
  APPROVAL_MISMATCH_ERROR = 6,
  WORKFLOW_ERROR = 7,
  INFRASTRUCTURE_ERROR = 8,
}

export class CliError extends Error {
  constructor(public message: string, public exitCode: ExitCode) {
    super(message);
    this.name = "CliError";
  }
}

export class InputFileError extends CliError {
  constructor(message: string) {
    super(message, ExitCode.INPUT_FILE_ERROR);
  }
}

export class WorkflowError extends CliError {
  constructor(message: string) {
    super(message, ExitCode.WORKFLOW_ERROR);
  }
}
