const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const fs = require('fs');
const os = require('os');
const path = require('path');

ffmpeg.setFfmpegPath(ffmpegPath);

const MIN_COMPRESS_BYTES = 512 * 1024; // 512 KB

/**
 * Comprime un video con FFmpeg apuntando a calidad móvil (720p / CRF 26).
 *
 * @param {string} inputPath  Ruta absoluta del video original (temp de multer).
 * @returns {Promise<{finalPath: string, compressed: boolean, tempOutput: string|null}>}
 *   finalPath    → ruta del archivo a usar (original o comprimido).
 *   compressed   → true si se generó un archivo nuevo más pequeño.
 *   tempOutput   → ruta del archivo comprimido (limpiar después de usar).
 */
async function compressVideo(inputPath) {
  const originalSize = fs.statSync(inputPath).size;

  if (originalSize < MIN_COMPRESS_BYTES) {
    return { finalPath: inputPath, compressed: false, tempOutput: null };
  }

  const outputPath = path.join(
    os.tmpdir(),
    `hub_cmp_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`,
  );

  return new Promise((resolve) => {
    ffmpeg(inputPath)
      .videoCodec('libx264')
      .addOption('-crf', '26')
      .addOption('-preset', 'fast')
      .addOption('-movflags', '+faststart')
      .audioCodec('aac')
      .audioBitrate('128k')
      .videoFilter(
        "scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease",
      )
      .output(outputPath)
      .on('end', () => {
        if (!fs.existsSync(outputPath)) {
          console.warn('[HubCompress] Salida no encontrada; usando original.');
          return resolve({ finalPath: inputPath, compressed: false, tempOutput: null });
        }

        const compressedSize = fs.statSync(outputPath).size;

        if (compressedSize >= originalSize) {
          fs.unlinkSync(outputPath);
          console.info('[HubCompress] Sin ganancia; conservando original.');
          return resolve({ finalPath: inputPath, compressed: false, tempOutput: null });
        }

        const reduction = Math.round((1 - compressedSize / originalSize) * 100);
        console.info(
          `[HubCompress] OK: ${Math.round(originalSize / 1024)} KB → ` +
            `${Math.round(compressedSize / 1024)} KB (-${reduction}%)`,
        );
        resolve({ finalPath: outputPath, compressed: true, tempOutput: outputPath });
      })
      .on('error', (err) => {
        console.error('[HubCompress] FFmpeg error:', err.message);
        if (fs.existsSync(outputPath)) {
          try { fs.unlinkSync(outputPath); } catch (_) {}
        }
        // Fallback silencioso: usa el original.
        resolve({ finalPath: inputPath, compressed: false, tempOutput: null });
      })
      .run();
  });
}

/**
 * Elimina archivos temporales de forma segura.
 * @param {(string|null|undefined)[]} paths
 */
function cleanupFiles(paths) {
  for (const p of paths) {
    if (p && fs.existsSync(p)) {
      try { fs.unlinkSync(p); } catch (_) {}
    }
  }
}

module.exports = { compressVideo, cleanupFiles };
