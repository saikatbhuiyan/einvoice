import { of } from 'rxjs';
import { TCP_PATTERNS } from '@libs/transports';
import { UserClientService } from './user-client.service';

describe('UserClientService', () => {
  let client: { send: jest.Mock };
  let service: UserClientService;

  beforeEach(() => {
    client = { send: jest.fn().mockReturnValue(of({ id: 'user-1' })) };
    service = new UserClientService(client as never, undefined);
  });

  const patternOf = (call: jest.Mock) => call.mock.calls[0][0];
  const payloadOf = (call: jest.Mock) => call.mock.calls[0][1].data;

  it('sends CREATE with the user payload', async () => {
    await service.createUser({ email: 'jane@acme.test' } as never);

    expect(patternOf(client.send)).toBe(TCP_PATTERNS.USER.CREATE);
    expect(payloadOf(client.send)).toEqual({ email: 'jane@acme.test' });
  });

  it('sends FIND_ALL with the query', async () => {
    await service.findAllUsers({ page: 1 } as never);

    expect(patternOf(client.send)).toBe(TCP_PATTERNS.USER.FIND_ALL);
    expect(payloadOf(client.send)).toEqual({ page: 1 });
  });

  it('sends FIND_ONE with the id', async () => {
    await service.findOneUser('user-1');

    expect(patternOf(client.send)).toBe(TCP_PATTERNS.USER.FIND_ONE);
    expect(payloadOf(client.send)).toEqual({ id: 'user-1' });
  });

  it('sends UPDATE with id and data', async () => {
    await service.updateUser('user-1', { name: 'New Name' });

    expect(patternOf(client.send)).toBe(TCP_PATTERNS.USER.UPDATE);
    expect(payloadOf(client.send)).toEqual({ id: 'user-1', data: { name: 'New Name' } });
  });

  it('sends DELETE with the id', async () => {
    await service.deactivateUser('user-1');

    expect(patternOf(client.send)).toBe(TCP_PATTERNS.USER.DELETE);
    expect(payloadOf(client.send)).toEqual({ id: 'user-1' });
  });

  it('sends the ROLE FIND_ALL pattern with no payload', async () => {
    await service.findAllRoles();

    expect(patternOf(client.send)).toBe(TCP_PATTERNS.ROLE.FIND_ALL);
  });
});
