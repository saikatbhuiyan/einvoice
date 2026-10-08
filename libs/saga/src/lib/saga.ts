import { Logger } from '@nestjs/common';
import { SagaStep } from './saga-step.interface';
import { SagaCompensationFailure, SagaExecutionError } from './saga-execution.error';

/**
 * Orchestrates a sequence of steps across systems with no shared transaction coordinator
 * (Mongo/Postgres/Stripe/Keycloak/S3, none of which this project runs 2PC/XA across). One caller
 * builds the sequence and drives it -- the "orchestration" half of the Saga pattern, as opposed
 * to "choreography" (each service reacting to events independently, closer to what the Kafka
 * pipeline already does for invoice -> mail). If any step fails, every already-completed step's
 * `compensate` runs in reverse order before the failure is rethrown as a SagaExecutionError.
 *
 * No DI module/factory here, unlike @libs/circuit-breaker: a circuit breaker has to persist state
 * *across* calls for the same named dependency (hence its factory returning the same instance per
 * name); a saga runs once per call site and has nothing left to share once execute() returns.
 */
export class Saga<TContext> {
  private readonly steps: SagaStep<TContext>[] = [];
  private readonly logger: Logger;

  constructor(private readonly name: string) {
    this.logger = new Logger(`Saga:${name}`);
  }

  addStep(step: SagaStep<TContext>): this {
    this.steps.push(step);
    return this;
  }

  async execute(context: TContext): Promise<void> {
    const completed: SagaStep<TContext>[] = [];

    for (const step of this.steps) {
      try {
        this.logger.log(`Executing step "${step.name}"`);
        await step.execute(context);
        completed.push(step);
      } catch (error) {
        this.logger.error(
          `Step "${step.name}" failed, compensating ${completed.length} completed step(s)`,
          error instanceof Error ? error.stack : String(error),
        );
        const compensationFailures = await this.runCompensations(completed, context);
        throw new SagaExecutionError(this.name, step.name, error, compensationFailures);
      }
    }
  }

  private async runCompensations(
    completed: SagaStep<TContext>[],
    context: TContext,
  ): Promise<SagaCompensationFailure[]> {
    const failures: SagaCompensationFailure[] = [];

    // Reverse order: the most recently committed step is the first undone, same reasoning a
    // database transaction's own rollback applies to its write-ahead log.
    for (const step of [...completed].reverse()) {
      if (!step.compensate) continue;

      try {
        this.logger.log(`Compensating step "${step.name}"`);
        await step.compensate(context);
      } catch (error) {
        // Logged at error level and collected, never thrown here -- one failed rollback must
        // not stop the rest of the rollback from running. The caller sees every compensation
        // failure via SagaExecutionError.compensationFailures and decides what to do (page
        // someone, flag for manual reconciliation) rather than this class deciding for them.
        this.logger.error(
          `Compensation for step "${step.name}" failed`,
          error instanceof Error ? error.stack : String(error),
        );
        failures.push({ step: step.name, error });
      }
    }

    return failures;
  }
}
