import { createRpcEnvelope } from '@libs/transports';
import { FindAllUsersDto } from '@libs/interfaces/gateway';
import { UserRpcController } from './user-rpc.controller';
import { UserService } from './user.service';

describe('UserRpcController', () => {
  let service: jest.Mocked<Pick<UserService, 'create' | 'findAll' | 'findOne' | 'update' | 'deactivate'>>;
  let controller: UserRpcController;

  beforeEach(() => {
    service = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      deactivate: jest.fn(),
    };
    controller = new UserRpcController(service as never);
  });

  it('unwraps createByMessage payloads', () => {
    const envelope = createRpcEnvelope({ email: 'jane@acme.test' }, 'bff');
    controller.createByMessage(envelope as never);
    expect(service.create).toHaveBeenCalledWith({ email: 'jane@acme.test' });
  });

  it('defaults findAllByMessage to an empty query when no payload is sent', () => {
    controller.findAllByMessage(undefined as never);
    expect(service.findAll).toHaveBeenCalledWith(new FindAllUsersDto());
  });

  it('unwraps findOneByMessage and forwards the id', () => {
    const envelope = createRpcEnvelope({ id: 'user-1' }, 'bff');
    controller.findOneByMessage(envelope as never);
    expect(service.findOne).toHaveBeenCalledWith('user-1');
  });

  it('unwraps updateByMessage and forwards id/data', () => {
    const envelope = createRpcEnvelope({ id: 'user-1', data: { name: 'New Name' } }, 'bff');
    controller.updateByMessage(envelope as never);
    expect(service.update).toHaveBeenCalledWith('user-1', { name: 'New Name' });
  });

  it('unwraps deactivateByMessage and forwards the id', () => {
    const envelope = createRpcEnvelope({ id: 'user-1' }, 'bff');
    controller.deactivateByMessage(envelope as never);
    expect(service.deactivate).toHaveBeenCalledWith('user-1');
  });
});
