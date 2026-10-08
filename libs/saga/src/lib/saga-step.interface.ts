/**
 * One step of a Saga. `TContext` is a plain mutable object every step reads/writes through --
 * the simplest way for a step's `compensate` (or a later step) to see whatever an earlier step's
 * `execute` produced (e.g. a Stripe session ID), without heavier generics tying steps together.
 */
export interface SagaStep<TContext> {
  /** Used only for logging/error identification -- keep it unique within one Saga. */
  name: string;

  execute(context: TContext): Promise<void>;

  /**
   * Undoes this step's effect. Omit it for a step with nothing to undo (most commonly the last
   * step in the sequence -- if it fails, it never committed anything itself, so there's nothing
   * to compensate; only the steps *before* it need rolling back).
   */
  compensate?(context: TContext): Promise<void>;
}
