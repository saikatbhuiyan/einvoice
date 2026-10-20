import { AuthorizationController } from './authorization.controller';
import type { AuthorizationService } from './authorization.service';

describe('AuthorizationController', () => {
  const resolveCaller = jest.fn().mockResolvedValue({ status: 'none' });
  const controller = new AuthorizationController({ resolveCaller } as unknown as AuthorizationService);

  it('passes the request through to the service', async () => {
    await controller.resolveCaller({ userId: 'kc-1', roles: ['platform-admin'], organizationId: 'org-1' });

    expect(resolveCaller).toHaveBeenCalledWith({ userId: 'kc-1', roles: ['platform-admin'], organizationId: 'org-1' });
  });

  it('treats missing fields as none, never undefined', async () => {
    await controller.resolveCaller({});

    expect(resolveCaller).toHaveBeenLastCalledWith({ userId: '', roles: [], organizationId: '' });
  });
});
