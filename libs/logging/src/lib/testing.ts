/**
 * SPEC-ONLY. Never import from application code.
 *
 * Every real request runs inside a correlation context that carries the caller's organization;
 * tenant-scoped code (cache keys, repositories) refuses to run without one. Specs of such code run
 * each test body inside that context the same way:
 *
 *   import { itInOrganization as it, TEST_ORGANIZATION_ID } from '@libs/logging/testing';
 *
 * (AsyncLocalStorage.enterWith() in a beforeEach does *not* reach the test body under Jest -- the
 * test runs in a different async continuation -- so the context has to wrap the test function.)
 */
import { runWithCorrelationContext } from './correlation-context';

// A UUID like every real organization id (Postgres columns are typed uuid).
export const TEST_ORGANIZATION_ID = '7e57e57e-0000-4000-8000-000000000001';

type TestFn = (...args: unknown[]) => unknown;

function inOrganization(fn: TestFn, organizationId = TEST_ORGANIZATION_ID): TestFn {
  return (...args) =>
    runWithCorrelationContext({ correlationId: 'spec', traceId: 'spec', organizationId }, () => fn(...args));
}

type ItLike = (name: string, fn: TestFn, timeout?: number) => void;

type EachRow = readonly unknown[];

const wrapped = ((name: string, fn: TestFn, timeout?: number) =>
  (it as unknown as ItLike)(name, inOrganization(fn), timeout)) as ItLike & {
  /** Rows are argument tuples, as with Jest's it.each([[a, b], ...]). */
  each: <Row extends EachRow>(
    table: readonly Row[],
  ) => (name: string, fn: (...args: [...Row]) => unknown, timeout?: number) => void;
  only: ItLike;
  skip: ItLike;
  todo: (name: string) => void;
};
wrapped.each = (table) => (name, fn, timeout) =>
  (it.each(table as never) as unknown as ItLike)(name, inOrganization(fn as TestFn), timeout);
wrapped.only = (name, fn, timeout) => (it.only as unknown as ItLike)(name, inOrganization(fn), timeout);
wrapped.skip = (name, fn, timeout) => (it.skip as unknown as ItLike)(name, inOrganization(fn), timeout);
wrapped.todo = (name) => it.todo(name);

/** Jest's `it`, with each test body running inside an organization context. */
export const itInOrganization = wrapped;
