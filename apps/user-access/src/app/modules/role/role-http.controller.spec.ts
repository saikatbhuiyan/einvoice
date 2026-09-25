import { RoleHttpController } from './role-http.controller';
import { RoleService } from './role.service';

describe('RoleHttpController', () => {
  let service: jest.Mocked<Pick<RoleService, 'findAll'>>;
  let controller: RoleHttpController;

  beforeEach(() => {
    service = { findAll: jest.fn() };
    controller = new RoleHttpController(service as never);
  });

  it('delegates findAll to the service', () => {
    controller.findAll();
    expect(service.findAll).toHaveBeenCalled();
  });
});
