import { Controller } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import { TCP_PATTERNS } from '@libs/transports';
import { RoleService } from './role.service';

@Controller()
export class RoleRpcController {
  constructor(private readonly roleService: RoleService) {}

  @MessagePattern(TCP_PATTERNS.ROLE.FIND_ALL)
  findAllByMessage() {
    return this.roleService.findAll();
  }
}
