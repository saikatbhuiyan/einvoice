import { AuthorizationController } from './authorization.controller';
import type { AuthorizationService } from './authorization.service';

describe('AuthorizationController', () => {
  const service = { getPermissionsForRoles: jest.fn().mockResolvedValue(['invoice:read']) };
  const controller = new AuthorizationController(service as unknown as AuthorizationService);

  beforeEach(() => service.getPermissionsForRoles.mockClear());

  it('wraps the resolved permissions in the proto response shape', async () => {
    await expect(controller.getPermissionsForRoles({ roles: ['viewer'] })).resolves.toEqual({
      permissions: ['invoice:read'],
    });
    expect(service.getPermissionsForRoles).toHaveBeenCalledWith(['viewer']);
  });

  // proto3 omits an empty repeated field on the wire, so a caller with no roles arrives as {}.
  it('treats a missing roles field as no roles', async () => {
    await controller.getPermissionsForRoles({} as { roles: string[] });

    expect(service.getPermissionsForRoles).toHaveBeenCalledWith([]);
  });
});
