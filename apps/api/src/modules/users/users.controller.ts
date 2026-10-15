import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsArray, IsEnum, IsOptional, IsString } from 'class-validator';
import { PermissionCode, UserStatus } from '@vj/shared';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser, JwtPayloadUser } from '../../common/decorators/current-user.decorator';
import { PaginationQueryDto, paginationMeta } from '../../common/dto/pagination.dto';
import { UsersService } from './users.service';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class UsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  q?: string;
}

class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fullName?: string;

  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: (typeof UserStatus)[keyof typeof UserStatus];
}

class SetRolesDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  roleCodes!: string[];
}

@ApiTags('admin-users')
@ApiBearerAuth()
@Controller('admin/users')
@UseGuards(PermissionsGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Permissions(PermissionCode.USERS_READ)
  async list(@Query() query: UsersQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const { items, total } = await this.users.list(page, pageSize, query.q);
    return { data: items, meta: { pagination: paginationMeta(page, pageSize, total) } };
  }

  @Get(':id')
  @Permissions(PermissionCode.USERS_READ)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.get(id);
  }

  @Patch(':id')
  @Permissions(PermissionCode.USERS_WRITE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: JwtPayloadUser,
  ) {
    return this.users.update(id, dto, user.id);
  }

  @Put(':id/roles')
  @Permissions(PermissionCode.ROLES_WRITE)
  setRoles(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetRolesDto,
    @CurrentUser() user: JwtPayloadUser,
  ) {
    return this.users.setRoles(id, dto.roleCodes, user.id);
  }
}
