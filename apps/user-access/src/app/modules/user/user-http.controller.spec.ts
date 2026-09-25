import { UserHttpController } from './user-http.controller';
import { UserService } from './user.service';

describe('UserHttpController', () => {
  let service: jest.Mocked<Pick<UserService, 'create' | 'findAll' | 'findOne' | 'update' | 'deactivate'>>;
  let controller: UserHttpController;

  beforeEach(() => {
    service = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      deactivate: jest.fn(),
    };
    controller = new UserHttpController(service as never);
  });

  it('delegates create to the service', () => {
    controller.create({ email: 'jane@acme.test' } as never);
    expect(service.create).toHaveBeenCalledWith({ email: 'jane@acme.test' });
  });

  it('delegates findAll to the service', () => {
    controller.findAll({ page: 1 } as never);
    expect(service.findAll).toHaveBeenCalledWith({ page: 1 });
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
