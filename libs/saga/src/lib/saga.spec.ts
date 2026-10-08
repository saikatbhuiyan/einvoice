import { Saga } from './saga';
import { SagaExecutionError } from './saga-execution.error';
import { SagaStep } from './saga-step.interface';

interface TestContext {
  log: string[];
}

describe('Saga', () => {
  it('runs every step in order and never compensates on the happy path', async () => {
    const context: TestContext = { log: [] };
    const compensateA = jest.fn();
    const compensateB = jest.fn();

    const saga = new Saga<TestContext>('HappyPath');
    saga.addStep({
      name: 'stepA',
      execute: async (ctx) => {
        ctx.log.push('A');
      },
      compensate: compensateA,
    });
    saga.addStep({
      name: 'stepB',
      execute: async (ctx) => {
        ctx.log.push('B');
      },
      compensate: compensateB,
    });

    await saga.execute(context);

    expect(context.log).toEqual(['A', 'B']);
    expect(compensateA).not.toHaveBeenCalled();
    expect(compensateB).not.toHaveBeenCalled();
  });

  it("compensates completed steps in reverse order when a later step fails, and never runs the failed step's own compensate", async () => {
    const context: TestContext = { log: [] };
    const compensationOrder: string[] = [];
    const failedStepCompensate = jest.fn();

    const saga = new Saga<TestContext>('MidwayFailure');
    saga
      .addStep({
        name: 'stepA',
        execute: async (ctx) => {
          ctx.log.push('A');
        },
        compensate: async () => {
          compensationOrder.push('A');
        },
      })
      .addStep({
        name: 'stepB',
        execute: async (ctx) => {
          ctx.log.push('B');
        },
        compensate: async () => {
          compensationOrder.push('B');
        },
      })
      .addStep({
        name: 'stepC',
        execute: async () => {
          throw new Error('stepC exploded');
        },
        compensate: failedStepCompensate,
      });

    await expect(saga.execute(context)).rejects.toThrow(SagaExecutionError);

    expect(context.log).toEqual(['A', 'B']);
    // B committed after A, so B's compensation must run first.
    expect(compensationOrder).toEqual(['B', 'A']);
    // stepC itself never completed, so its own compensate must never run.
    expect(failedStepCompensate).not.toHaveBeenCalled();
  });

  it('skips steps with no compensate defined (e.g. the last step in a sequence) without error', async () => {
    const context: TestContext = { log: [] };
    const compensateA = jest.fn();

    const saga = new Saga<TestContext>('NoCompensateOnLastStep');
    saga
      .addStep({
        name: 'stepA',
        execute: async (ctx) => {
          ctx.log.push('A');
        },
        compensate: compensateA,
      })
      .addStep({
        name: 'stepB-no-compensate',
        execute: async () => {
          throw new Error('stepB exploded');
        },
        // no compensate -- nothing to undo, it never committed anything
      });

    await expect(saga.execute(context)).rejects.toThrow(SagaExecutionError);
    expect(compensateA).toHaveBeenCalledTimes(1);
  });

  it('collects a compensation failure instead of throwing it, and keeps running the remaining rollbacks', async () => {
    const context: TestContext = { log: [] };
    const compensationOrder: string[] = [];

    const saga = new Saga<TestContext>('CompensationItselfFails');
    saga
      .addStep({
        name: 'stepA',
        execute: async (ctx) => {
          ctx.log.push('A');
        },
        compensate: async () => {
          compensationOrder.push('A');
        },
      })
      .addStep({
        name: 'stepB-bad-compensate',
        execute: async (ctx) => {
          ctx.log.push('B');
        },
        compensate: async () => {
          throw new Error('rollback for B failed too');
        },
      })
      .addStep({
        name: 'stepC',
        execute: async () => {
          throw new Error('stepC exploded');
        },
      });

    let thrown: SagaExecutionError | undefined;
    try {
      await saga.execute(context);
    } catch (error) {
      thrown = error as SagaExecutionError;
    }

    expect(thrown).toBeInstanceOf(SagaExecutionError);
    expect(thrown?.failedStep).toBe('stepC');
    expect(thrown?.compensationFailures).toHaveLength(1);
    expect(thrown?.compensationFailures[0].step).toBe('stepB-bad-compensate');
    // Despite B's own compensation throwing, A's compensation still ran.
    expect(compensationOrder).toEqual(['A']);
  });

  it('exposes the original cause on SagaExecutionError', async () => {
    const originalError = new Error('boom');
    const saga = new Saga<TestContext>('CausePreserved');
    const step: SagaStep<TestContext> = {
      name: 'stepA',
      execute: async () => {
        throw originalError;
      },
    };
    saga.addStep(step);

    let thrown: SagaExecutionError | undefined;
    try {
      await saga.execute({ log: [] });
    } catch (error) {
      thrown = error as SagaExecutionError;
    }

    expect(thrown?.cause).toBe(originalError);
    expect(thrown?.sagaName).toBe('CausePreserved');
  });
});
