import { UserController } from './user.controller';
import { UserService } from './user.service';

describe('UserController', () => {
  let service: jest.Mocked<
    Pick<UserService, 'create' | 'findAll' | 'findOne' | 'update' | 'deactivate' | 'findAllRoles'>
  >;
  let controller: UserController;
  const res = { setHeader: jest.fn() } as never;

  beforeEach(() => {
    service = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      deactivate: jest.fn(),
      findAllRoles: jest.fn(),
    };
    controller = new UserController(service as never);
  });

  it('delegates findAllRoles to the service', () => {
    controller.findAllRoles();
    expect(service.findAllRoles).toHaveBeenCalled();
  });

  it('delegates create to the service', () => {
    controller.create({ email: 'jane@acme.test' } as never);
    expect(service.create).toHaveBeenCalledWith({ email: 'jane@acme.test' });
  });

  it('forwards the response object to findAll for circuit-state headers', () => {
    controller.findAll({ page: 1 } as never, res);
    expect(service.findAll).toHaveBeenCalledWith({ page: 1 }, res);
  });

  it('delegates findOne to the service', () => {
    controller.findOne('user-1');
    expect(service.findOne).toHaveBeenCalledWith('user-1');
  });

  it('delegates update to the service', () => {
    controller.update('user-1', { name: 'New Name' } as never);
    expect(service.update).toHaveBeenCalledWith('user-1', { name: 'New Name' });
  });

  it('delegates deactivate to the service', () => {
    controller.deactivate('user-1');
    expect(service.deactivate).toHaveBeenCalledWith('user-1');
  });
});
