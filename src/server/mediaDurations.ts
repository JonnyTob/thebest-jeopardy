import { realpath, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { parseFile, parseStream } from 'music-metadata';
import type { Quiz } from '../shared/protocol.js';

/** Probe once at startup. Missing, unsupported, or unreadable files remain unknown. */
export async function probeMediaDurations(quiz: Quiz, mediaRoot: string, prefix = '/media/'):  Promise<Record<string, number>> {
  const durations: Record<string, number> = Object.create(null) as Record<string, number>;
  let root: string;
  try { root = await realpath(mediaRoot); } catch { return durations; }
  const paths = new Set(quiz.questions
    .filter((question) => question.type === 'audio' || question.type === 'video')
    .map((question) => question.media).filter((value): value is string => !!value));
  for (const media of paths) {
    if (!media.startsWith(prefix) || !/^\/media\/[a-zA-Z0-9_./-]+$/.test(media) || media.includes('..') || !/\.(wav|mp3|mp4)$/i.test(media)) continue;
    try {
      const file = await realpath(path.resolve(root, media.slice(prefix.length)));
      const relative = path.relative(root, file);
      if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) continue;
      if (!(await stat(file)).isFile()) continue;
      // With no file-size hint the MPEG parser scans frames instead of extrapolating
      // from the first few bitrates (which can misclassify variable-bitrate files).
      let metadata;
      if (/\.mp3$/i.test(file)) {
        const stream = createReadStream(file);
        try { metadata = await parseStream(stream, 'audio/mpeg', { duration: true }); }
        finally { stream.destroy(); }
      } else metadata = await parseFile(file, { duration: true });
      const duration = metadata.format.duration;
      if (duration !== undefined && Number.isFinite(duration) && duration > 0) durations[media] = duration;
    } catch {
      // A broken or unsupported clip must not prevent the quiz from starting.
    }
  }
  return durations;
}