import { Module } from '@nestjs/common';
import { RedisModule } from '../../infrastructure/redis/redis.module';
import { TryOnController } from './try-on.controller';
import { TryOnService } from './try-on.service';

@Module({
  imports: [RedisModule],
  controllers: [TryOnController],
  providers: [TryOnService],
  exports: [TryOnService],
})
export class TryOnModule {}
