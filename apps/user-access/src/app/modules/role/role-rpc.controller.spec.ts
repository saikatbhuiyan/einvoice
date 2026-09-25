import { RoleRpcController } from './role-rpc.controller';
import { RoleService } from './role.service';

describe('RoleRpcController', () => {
  let service: jest.Mocked<Pick<RoleService, 'findAll'>>;
  let controller: RoleRpcController;

  beforeEach(() => {
    service = { findAll: jest.fn() };
    controller = new RoleRpcController(service as never);
  });

  it('delegates findAllByMessage to the service', () => {
    controller.findAllByMessage();
    expect(service.findAll).toHaveBeenCalled();
  });
});
