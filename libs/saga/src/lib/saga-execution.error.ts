export interface SagaCompensationFailure {
  step: string;
  error: unknown;
}

/**
 * Thrown by Saga.execute() when a step fails. Carries both the original failure and whatever
 * went wrong *while rolling back* -- a compensation failing is a second, distinct problem a
 * caller needs to be able to see (e.g. to page someone), not something this error should hide
 * behind the original cause.
 */
export class SagaExecutionError extends Error {
  constructor(
    public readonly sagaName: string,
    public readonly failedStep: string,
    public readonly cause: unknown,
    public readonly compensationFailures: ReadonlyArray<SagaCompensationFailure>,
  ) {
    super(SagaExecutionError.buildMessage(sagaName, failedStep, cause, compensationFailures));
    this.name = 'SagaExecutionError';
  }

  private static buildMessage(
    sagaName: string,
    failedStep: string,
    cause: unknown,
    compensationFailures: ReadonlyArray<SagaCompensationFailure>,
  ): string {
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    const base = `Saga "${sagaName}" failed at step "${failedStep}": ${causeMessage}`;

    if (compensationFailures.length === 0) {
      return base;
    }

    const compensationSummary = compensationFailures
      .map(({ step, error }) => `"${step}" (${error instanceof Error ? error.message : String(error)})`)
      .join(', ');
    return `${base}. Additionally, compensation failed for: ${compensationSummary}`;
  }
}
