import { runWithCorrelationContext } from '@libs/logging/correlation-context';
import { tenantCacheKey } from './tenant-cache-key';

describe('tenantCacheKey', () => {
  const inOrg = (organizationId: string) =>
    runWithCorrelationContext({ correlationId: 'c', traceId: 't', organizationId }, () =>
      tenantCacheKey('bff', 'invoice', 'one', 'inv-1'),
    );

  it('puts the active organization into the key, so tenants never share an entry', () => {
    expect(inOrg('org-a')).toBe('bff:org:org-a:invoice:one:inv-1');
    expect(inOrg('org-b')).not.toBe(inOrg('org-a'));
  });

  it('refuses to build a tenant key without an organization', () => {
    expect(() => tenantCacheKey('bff', 'invoice', 'list')).toThrow(/No organization in the request context/);
  });
});
