import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { TCP_PATTERNS, unwrapRpcPayload, type RpcEnvelope } from '@libs/transports';
import {
  CreateUserDto,
  DeactivateUserGatewayDto,
  FindAllUsersDto,
  FindOneUserGatewayDto,
  UpdateUserGatewayDto,
} from '@libs/interfaces/gateway';
import { UserService } from './user.service';

@Controller()
export class UserRpcController {
  constructor(private readonly userService: UserService) {}

  @MessagePattern(TCP_PATTERNS.USER.CREATE)
  createByMessage(@Payload() payload: RpcEnvelope<CreateUserDto> | CreateUserDto) {
    return this.userService.create(unwrapRpcPayload(payload));
  }

  @MessagePattern(TCP_PATTERNS.USER.FIND_ALL)
  findAllByMessage(@Payload() payload: RpcEnvelope<FindAllUsersDto> | FindAllUsersDto = new FindAllUsersDto()) {
    return this.userService.findAll(unwrapRpcPayload(payload));
  }

  @MessagePattern(TCP_PATTERNS.USER.FIND_ONE)
  findOneByMessage(@Payload() payload: RpcEnvelope<FindOneUserGatewayDto> | FindOneUserGatewayDto) {
    const data = unwrapRpcPayload(payload);
    return this.userService.findOne(data.id);
  }

  @MessagePattern(TCP_PATTERNS.USER.UPDATE)
  updateByMessage(@Payload() payload: RpcEnvelope<UpdateUserGatewayDto> | UpdateUserGatewayDto) {
    const data = unwrapRpcPayload(payload);
    return this.userService.update(data.id, data.data);
  }

  @MessagePattern(TCP_PATTERNS.USER.DELETE)
  deactivateByMessage(@Payload() payload: RpcEnvelope<DeactivateUserGatewayDto> | DeactivateUserGatewayDto) {
    const data = unwrapRpcPayload(payload);
    return this.userService.deactivate(data.id);
  }
}
