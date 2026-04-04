const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;
const { chatUploadDir, chatPublicBaseUrl } = require('../config/env');

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/gif',
]);

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.gif']);
const IMAGE_SHARP_FORMATS = new Set(['jpeg', 'png', 'webp', 'heif', 'gif']);

const VIDEO_MIME_TYPES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-matroska',
  'video/3gpp',
  'video/3gpp2',
  'video/x-msvideo',
  'application/octet-stream',
]);

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.mkv', '.3gp', '.3g2', '.m4v', '.avi']);

const IMAGE_TARGET_RATIO = 0.4;
const VIDEO_TARGET_RATIO = 0.4;
const TEMP_SOURCE_SUFFIX = '_source';
const TEMP_FILE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

class ChatMediaService {
  constructor() {
    this.absoluteUploadDir = path.resolve(process.cwd(), chatUploadDir);
  }

  async ensureUploadDir() {
    await fs.mkdir(this.absoluteUploadDir, { recursive: true });
    await this.cleanupStaleTempFiles();
  }

  async processUpload({ file, type, conversationId = null, userId = null, req }) {
    await this.ensureUploadDir();

    if (type === 'image') {
      try {
        await this.ensureImage(file);
        return await this.processImage({ file, conversationId, userId, req });
      } finally {
        await this.cleanupIncomingFile(file);
      }
    }

    if (type === 'video') {
      try {
        await this.ensureVideo(file);
        return await this.processVideo({ file, conversationId, userId, req });
      } finally {
        await this.cleanupIncomingFile(file);
      }
    }

    const error = new Error('type debe ser image o video');
    error.status = 422;
    throw error;
  }

  async ensureImage(file) {
    const extension = this.getNormalizedExtension(file);
    if (!file) {
      const error = new Error('Archivo de imagen no soportado');
      error.status = 415;
      throw error;
    }

    const mimeAccepted = IMAGE_MIME_TYPES.has(file.mimetype);
    const extensionAccepted = IMAGE_EXTENSIONS.has(extension);

    if (mimeAccepted || extensionAccepted) {
      return;
    }

    try {
      const metadata = await sharp(await this.readImageInput(file)).metadata();
      if (IMAGE_SHARP_FORMATS.has(String(metadata.format || '').toLowerCase())) {
        return;
      }
    } catch (_) {
      // La validacion final se maneja debajo.
    }

    const error = new Error('Archivo de imagen no soportado');
    error.status = 415;
    throw error;
  }

  async ensureVideo(file) {
    const extension = this.getNormalizedExtension(file);
    if (!file) {
      const error = new Error('Archivo de video no soportado');
      error.status = 415;
      throw error;
    }

    const mimeAccepted = VIDEO_MIME_TYPES.has(file.mimetype);
    const extensionAccepted = VIDEO_EXTENSIONS.has(extension);

    if (mimeAccepted || extensionAccepted) {
      return;
    }

    try {
      const probeData = await this.getVideoProbeData(file.path);
      if (Number(probeData.durationSeconds || 0) > 0) {
        return;
      }
    } catch (_) {
      // La validacion final se maneja debajo.
    }

    const error = new Error('Archivo de video no soportado');
    error.status = 415;
    throw error;
  }

  async processImage({ file, conversationId, userId, req }) {
    const inputBuffer = await this.readImageInput(file);
    const originalSize = file.size || inputBuffer.length;
    const targetBytes = Math.max(80 * 1024, Math.floor(originalSize * IMAGE_TARGET_RATIO));
    const fileId = this.makeFileId({ userId, conversationId, type: 'img' });
    const image = sharp(inputBuffer).rotate();
    const sourceMetadata = await image.metadata();

    let quality = 80;
    let width = 1600;
    let outputBuffer = await this.renderImageBuffer(inputBuffer, { quality, width });
    let storedWidth = sourceMetadata.width || null;
    let storedHeight = sourceMetadata.height || null;

    while (outputBuffer.length > targetBytes && (quality > 30 || width > 720)) {
      if (quality > 30) {
        quality -= 10;
      } else if (width > 720) {
        width = Math.max(720, width - 160);
      } else {
        break;
      }
      outputBuffer = await this.renderImageBuffer(inputBuffer, { quality, width });
    }

    if (outputBuffer.length < originalSize) {
      const outputMetadata = await sharp(outputBuffer).metadata();
      storedWidth = outputMetadata.width || storedWidth;
      storedHeight = outputMetadata.height || storedHeight;
    } else {
      outputBuffer = inputBuffer;
    }

    const relativePath = `${fileId}.jpg`;
    const absolutePath = path.join(this.absoluteUploadDir, relativePath);
    await fs.writeFile(absolutePath, outputBuffer);

    return {
      url: this.buildPublicUrl(req, relativePath),
      path: relativePath,
      contentType: 'image/jpeg',
      originalSize,
      storedSize: outputBuffer.length,
      reductionPercent: this.reductionPercent(originalSize, outputBuffer.length),
      metadata: {
        original_width: sourceMetadata.width || null,
        original_height: sourceMetadata.height || null,
        stored_width: storedWidth,
        stored_height: storedHeight,
      },
    };
  }

  async renderImageBuffer(inputBuffer, { quality, width }) {
    return sharp(inputBuffer)
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .jpeg({
        quality,
        mozjpeg: true,
      })
      .toBuffer();
  }

  async processVideo({ file, conversationId, userId, req }) {
    const originalSize = file.size || 0;
    const fileId = this.makeFileId({ userId, conversationId, type: 'vid' });
    const inputPath = file.path || path.join(this.absoluteUploadDir, `${fileId}${TEMP_SOURCE_SUFFIX}`);
    const outputPath = path.join(this.absoluteUploadDir, `${fileId}.mp4`);
    const thumbnailPath = path.join(this.absoluteUploadDir, `${fileId}_thumb.jpg`);

    try {
      const probeData = await this.getVideoProbeData(inputPath);
      const durationSeconds = probeData.durationSeconds;
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        const error = new Error('No fue posible leer la duracion del video');
        error.status = 422;
        throw error;
      }

      const targetBytes = Math.max(1024 * 1024, Math.floor(originalSize * VIDEO_TARGET_RATIO));
      const targetTotalBitrate = Math.max(
        250000,
        Math.floor((targetBytes * 8) / durationSeconds),
      );
      const audioBitrate = 96000;
      const videoBitrate = Math.max(160000, targetTotalBitrate - audioBitrate);

      await this.transcodeVideo({
        inputPath,
        outputPath,
        videoBitrate,
        audioBitrate,
      });
      await this.generateVideoThumbnail({
        inputPath: outputPath,
        thumbnailPath,
        durationSeconds,
      });

      let outputStats = await fs.stat(outputPath);
      if (outputStats.size >= originalSize) {
        await fs.copyFile(inputPath, outputPath);
        outputStats = await fs.stat(outputPath);
      }

      return {
        url: this.buildPublicUrl(req, `${fileId}.mp4`),
        path: `${fileId}.mp4`,
        contentType: 'video/mp4',
        originalSize,
        storedSize: outputStats.size,
        reductionPercent: this.reductionPercent(originalSize, outputStats.size),
        thumbnailUrl: this.buildPublicUrl(req, `${fileId}_thumb.jpg`),
        thumbnailPath: `${fileId}_thumb.jpg`,
        metadata: {
          duration_seconds: Number(durationSeconds.toFixed(3)),
          original_width: probeData.width,
          original_height: probeData.height,
          thumbnail_url: this.buildPublicUrl(req, `${fileId}_thumb.jpg`),
          thumbnail_path: `${fileId}_thumb.jpg`,
        },
      };
    } finally {
      if (!file.path || file.path !== inputPath) {
        await fs.rm(inputPath, { force: true });
      }
    }
  }

  getVideoProbeData(inputPath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(inputPath, (error, metadata) => {
        if (error) {
          reject(error);
          return;
        }

        const videoStream = (metadata?.streams || []).find((stream) => stream.codec_type === 'video');
        resolve({
          durationSeconds: Number(metadata?.format?.duration || 0),
          width: Number(videoStream?.width || 0) || null,
          height: Number(videoStream?.height || 0) || null,
        });
      });
    });
  }

  transcodeVideo({ inputPath, outputPath, videoBitrate, audioBitrate }) {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions([
          '-movflags +faststart',
          '-preset veryfast',
          '-pix_fmt yuv420p',
          `-b:v ${videoBitrate}`,
          `-maxrate ${Math.floor(videoBitrate * 1.2)}`,
          `-bufsize ${Math.floor(videoBitrate * 2)}`,
          `-b:a ${audioBitrate}`,
        ])
        .videoCodec('libx264')
        .audioCodec('aac')
        .size('?x720')
        .format('mp4')
        .on('end', resolve)
        .on('error', reject)
        .save(outputPath);
    });
  }

  generateVideoThumbnail({ inputPath, thumbnailPath, durationSeconds }) {
    return new Promise((resolve, reject) => {
      const screenshotSecond = this.resolveThumbnailSecond(durationSeconds);

      ffmpeg(inputPath)
        .on('end', resolve)
        .on('error', reject)
        .screenshots({
          timestamps: [screenshotSecond],
          filename: path.basename(thumbnailPath),
          folder: path.dirname(thumbnailPath),
          size: '640x?',
        });
    });
  }

  resolveThumbnailSecond(durationSeconds) {
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 1) return 0;
    return Math.min(Math.max(durationSeconds * 0.2, 1), durationSeconds - 0.2);
  }

  buildPublicUrl(req, relativePath) {
    const baseUrl =
      chatPublicBaseUrl ||
      `${req.protocol}://${req.get('host')}`;

    return `${baseUrl}/media/chat/${relativePath}`;
  }

  reductionPercent(originalSize, storedSize) {
    if (!originalSize || storedSize >= originalSize) return 0;
    return Number((((originalSize - storedSize) * 100) / originalSize).toFixed(1));
  }

  makeFileId({ userId = null, conversationId = null, type = 'file' } = {}) {
    const safeType = this.slugSegment(type, 'file');
    const safeUser = this.slugSegment(userId, 'user');
    const safeConversation = this.slugSegment(conversationId, 'chat');
    return `${safeType}_${safeConversation}_${safeUser}_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
  }

  slugSegment(value, fallback) {
    const normalized = String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    return normalized || fallback;
  }

  getNormalizedExtension(file) {
    return path.extname(String(file?.originalname || file?.filename || file?.path || '')).trim().toLowerCase();
  }

  async readImageInput(file) {
    if (file?.buffer) return file.buffer;
    if (file?.path) return fs.readFile(file.path);
    throw new Error('Archivo de imagen invalido');
  }

  async cleanupIncomingFile(file) {
    if (!file?.path) return;
    await fs.rm(file.path, { force: true });
  }

  async cleanupStaleTempFiles() {
    let entries = [];
    try {
      entries = await fs.readdir(this.absoluteUploadDir, { withFileTypes: true });
    } catch {
      return;
    }

    const now = Date.now();
    await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(TEMP_SOURCE_SUFFIX))
        .map(async (entry) => {
          const fullPath = path.join(this.absoluteUploadDir, entry.name);

          try {
            const stats = await fs.stat(fullPath);
            if (now - stats.mtimeMs < TEMP_FILE_MAX_AGE_MS) return;
            await fs.rm(fullPath, { force: true });
          } catch {
            return;
          }
        }),
    );
  }
}

module.exports = new ChatMediaService();
