import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TryOnSessionStatus } from '@vj/shared';
import { Public } from '../../common/decorators/public.decorator';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayloadUser } from '../../common/decorators/current-user.decorator';
import { paginationMeta } from '../../common/dto/pagination.dto';
import { TryOnService, ArAnalyticsEvent } from './try-on.service';

// ─── DTOs ──────────────────────────────────────────────────────────────────

class StartSessionDto {
  @ApiProperty()
  @IsUUID()
  productId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  clientInfo?: Record<string, unknown>;
}

class ArEventDto implements ArAnalyticsEvent {
  @ApiProperty()
  @IsString()
  type!: string;

  @ApiPropertyOptional()
  @IsOptional()
  value?: string | number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  meta?: Record<string, unknown>;
}

class PatchSessionDto {
  @ApiPropertyOptional({ enum: TryOnSessionStatus })
  @IsOptional()
  @IsEnum(TryOnSessionStatus)
  status?: (typeof TryOnSessionStatus)[keyof typeof TryOnSessionStatus];

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metrics?: Record<string, unknown>;

  @ApiPropertyOptional({ type: [ArEventDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ArEventDto)
  events?: ArEventDto[];
}

class RecordEventDto {
  @ApiProperty()
  @IsString()
  type!: string;

  @ApiPropertyOptional()
  @IsOptional()
  value?: string | number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  meta?: Record<string, unknown>;
}

class BatchEventsDto {
  @ApiProperty({ type: [ArEventDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ArEventDto)
  events!: ArEventDto[];
}

class BatchAssetLookupDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsUUID('4', { each: true })
  productIds!: string[];
}

// ─── Controller ────────────────────────────────────────────────────────────

@ApiTags('try-on')
@Controller('try-on')
export class TryOnController {
  constructor(private readonly tryOn: TryOnService) {}

  /** Start a new try-on session (public, optional auth). */
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Post('sessions')
  start(@Body() dto: StartSessionDto, @CurrentUser() user?: JwtPayloadUser) {
    return this.tryOn.start(dto.productId, user?.id, dto.clientInfo);
  }

  /** Update session status / metrics / events (public, optional auth). */
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Patch('sessions/:sessionId')
  patch(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: PatchSessionDto,
    @CurrentUser() user?: JwtPayloadUser,
  ) {
    return this.tryOn.patch(sessionId, dto, user?.id);
  }

  /** Record a single analytics event into the session. */
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Post('sessions/:sessionId/events')
  recordEvent(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: RecordEventDto,
  ) {
    return this.tryOn.recordEvent(sessionId, dto);
  }

  /** Record a batch of analytics events (buffered client sends). */
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Post('sessions/:sessionId/events/batch')
  recordEvents(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: BatchEventsDto,
  ) {
    return this.tryOn.recordEvents(sessionId, dto.events);
  }

  /** Keep an active session alive in the cache. */
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Post('sessions/:sessionId/heartbeat')
  heartbeat(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user?: JwtPayloadUser,
  ) {
    return this.tryOn.heartbeat(sessionId, user?.id);
  }

  /** Get session detail (auth required). */
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('sessions/:sessionId')
  get(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: JwtPayloadUser,
  ) {
    return this.tryOn.get(sessionId, user.id);
  }

  /** Session summary (engagement metrics). Auth required. */
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('sessions/:sessionId/summary')
  summary(@Param('sessionId', ParseUUIDPipe) sessionId: string) {
    return this.tryOn.summarize(sessionId);
  }

  /** List the authenticated user's sessions. */
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('sessions')
  async mine(
    @CurrentUser() user: JwtPayloadUser,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    const p  = Math.max(1, parseInt(page, 10) || 1);
    const ps = Math.min(50, Math.max(1, parseInt(pageSize, 10) || 20));
    const { items, total } = await this.tryOn.listMine(user.id, p, ps);
    return { data: items, meta: { pagination: paginationMeta(p, ps, total) } };
  }

  /** Get the try-on asset for a specific product (public, cached). */
  @Public()
  @Get('products/:productId/asset')
  getProductAsset(@Param('productId', ParseUUIDPipe) productId: string) {
    return this.tryOn.getProductAsset(productId);
  }

  /** Batch lookup of try-on assets for multiple products (for preloading). */
  @Public()
  @Post('products/assets')
  getProductAssets(@Body() dto: BatchAssetLookupDto) {
    return this.tryOn.getProductAssets(dto.productIds);
  }
}
