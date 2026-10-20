import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { MissingOrganizationContextError } from '@libs/logging/correlation-context';
import { MissingOrganizationContextFilter } from './missing-organization.filter';

describe('MissingOrganizationContextFilter', () => {
  it('answers 400 problem+json naming the header', () => {
    const response = { status: jest.fn(), type: jest.fn(), json: jest.fn() };
    response.status.mockReturnValue(response);
    response.type.mockReturnValue(response);
    const host = new ExecutionContextHost([{ url: '/api/invoices' }, response]);

    new MissingOrganizationContextFilter().catch(new MissingOrganizationContextError(), host);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.type).toHaveBeenCalledWith('application/problem+json');
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 400,
        instance: '/api/invoices',
        detail: expect.stringContaining('x-organization-id header'),
      }),
    );
  });
});
