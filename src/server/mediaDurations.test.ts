import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, copyFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { Quiz } from '../shared/protocol.js';
import { probeMediaDurations } from './mediaDurations.js';

test('probes local WAV, MP3 and MP4, ignores missing/unsupported/corrupt paths and outside symlinks', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'quiz-media-'));
  try {
    const root = path.join(temp, 'media');
    await mkdir(root);
    await copyFile(path.resolve('src/public/media/examples/chimes.wav'), path.join(root, 'sound.wav'));
    await copyFile(path.resolve('src/public/media/examples/shapes.mp4'), path.join(root, 'video.mp4'));
    // MPEG-1 Layer III frames with real headers; 40 frames at 1152 samples / 44100 Hz.
    const frames = Buffer.alloc(417 * 40);
    for (let i = 0; i < 40; i++) Buffer.from([0xff, 0xfb, 0x90, 0x00]).copy(frames, i * 417);
    await writeFile(path.join(root, 'sound.mp3'), frames);
    await writeFile(path.join(root, 'broken.mp4'), 'not media');
    await copyFile(path.join(root, 'sound.wav'), path.join(temp, 'outside.wav'));
    await symlink(path.join(temp, 'outside.wav'), path.join(root, 'escape.wav'));
    const names = ['sound.wav', 'sound.mp3', 'video.mp4', 'missing.wav', 'broken.mp4', 'escape.wav', 'sound.ogg', '../outside.wav'];
    const quiz: Quiz = { id: 1, title: 'Probe', questions: names.map((name, index) => ({
      id: String(index), type: 'audio', mode: 'buzzer', question: 'Question', answer: 'SECRET', media: `/media/${name}`,
    })) };
    const durations = await probeMediaDurations(quiz, root);
    assert.equal(durations['/media/sound.wav'], 8);
    assert.ok(Math.abs(durations['/media/video.mp4'] - 8.415) < 0.001);
    assert.ok(Math.abs(durations['/media/sound.mp3'] - 40 * 1152 / 44100) < 0.001, String(durations['/media/sound.mp3']));
    assert.deepEqual(Object.keys(durations).sort(), ['/media/sound.mp3', '/media/sound.wav', '/media/video.mp4']);
    assert.deepEqual(Object.keys(await probeMediaDurations(quiz, path.join(temp, 'missing'))), []);
  } finally { await rm(temp, { recursive: true, force: true }); }
});