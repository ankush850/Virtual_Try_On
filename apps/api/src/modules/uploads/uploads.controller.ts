import {
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { UploadsService } from './uploads.service';

@ApiTags('uploads')
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Public()
  @Post('asset')
  @ApiOperation({ summary: 'Upload an AR asset file (.glb, .gltf, .png, .webp)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 25 * 1024 * 1024,
      },
    }),
  )
  async uploadAsset(@UploadedFile() file: Express.Multer.File) {
    return this.uploads.saveAsset(file);
  }

  @Public()
  @Get('files')
  @ApiOperation({ summary: 'Serve a stored file by query parameter key' })
  async getFileByQuery(
    @Query('key') key: string,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, contentType } = await this.uploads.getFile(key);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.end(buffer);
  }

  @Public()
  @Get('files/:key(*)')
  @ApiOperation({ summary: 'Serve a stored file by route parameter key' })
  async getFileByParam(
    @Param('key') key: string,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, contentType } = await this.uploads.getFile(key);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.end(buffer);
  }

  @Public()
  @Put('local')
  @ApiOperation({ summary: 'Local storage direct upload endpoint for presigned uploads' })
  async putLocal(
    @Query('key') key: string,
    @Query('expires') expires: string,
    @Query('token') token: string,
    @Headers('content-type') contentType: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    const body = Buffer.concat(chunks);
    const exp = parseInt(expires, 10) || 0;

    await this.uploads.handleLocalPresignedUpload(
      key,
      body,
      contentType || 'application/octet-stream',
      exp,
      token,
    );

    res.status(200).json({ ok: true, key });
  }
}
