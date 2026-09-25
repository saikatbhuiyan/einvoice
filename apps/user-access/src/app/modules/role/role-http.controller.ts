import { Controller, Get } from '@nestjs/common';
import { RoleService } from './role.service';

@Controller('roles')
export class RoleHttpController {
  constructor(private readonly roleService: RoleService) {}

  @Get()
  findAll() {
    return this.roleService.findAll();
  }
}
