import { z } from 'zod';
import { questionDefinitionSchema, questionSchema, quizSchema, settingsSchema, type Question, type Quiz } from './protocol.js';

export const QUIZ_SCHEMA_VERSION = 1;

const archiveMediaSchema = z.string().regex(/^media\/[a-zA-Z0-9_./-]+$/)
  .refine((value) => !value.includes('..'), 'Invalid quiz media path; use a relative media/... path');

export const gameSetupOverridesSchema = z.strictObject({
  ...settingsSchema.shape,
  questionTimerSeconds: settingsSchema.shape.questionTimerSeconds.removeDefault(),
  lockoutSeconds: settingsSchema.shape.lockoutSeconds.removeDefault(),
  maxAnswerLength: settingsSchema.shape.maxAnswerLength.removeDefault(),
}).partial();

export const archiveGameSetupSchema = gameSetupOverridesSchema.omit({ title: true }).refine(
  (setup) => setup.startPoints === undefined || setup.minimumPoints === undefined || setup.minimumPoints <= setup.startPoints,
  { message: 'Minimum points cannot exceed starting points', path: ['minimumPoints'] },
);

export const archiveQuestionSchema = questionDefinitionSchema.safeExtend({
  id: z.uuid(),
  media: archiveMediaSchema.optional(),
});

export const quizArchiveSchema = z.strictObject({
  schemaVersion: z.literal(QUIZ_SCHEMA_VERSION, { error: 'Unsupported or missing quiz schemaVersion; expected 1.' }),
  quiz: z.strictObject({
    id: quizSchema.shape.id,
    title: quizSchema.shape.title,
    coverImage: archiveMediaSchema.optional(),
  }),
  gameSetup: archiveGameSetupSchema.optional(),
  questions: z.array(archiveQuestionSchema).min(1).max(500),
}).superRefine((archive, context) => {
  const ids = new Set<string>();
  archive.questions.forEach((question, index) => {
    const id = question.id.toLowerCase();
    if (ids.has(id)) {
      context.addIssue({ code: 'custom', path: ['questions', index, 'id'], message: 'Question IDs must be unique' });
    }
    ids.add(id);
  });
});

export type QuizArchive = z.infer<typeof quizArchiveSchema>;
export type ArchiveQuestion = z.infer<typeof archiveQuestionSchema>;

export function toRuntimeQuestion(question: ArchiveQuestion): Question {
  return questionSchema.parse({
    ...question,
    id: question.id.toLowerCase(),
    ...(question.media !== undefined ? { media: '/media/quiz/' + question.media.slice('media/'.length) } : {}),
  });
}

export function toRuntimeQuiz(archive: QuizArchive): Quiz {
  const mediaUrl = (value: string) => '/media/quiz/' + value.slice('media/'.length);
  return quizSchema.parse({
    ...archive.quiz,
    ...(archive.quiz.coverImage !== undefined ? { coverImage: mediaUrl(archive.quiz.coverImage) } : {}),
    questions: archive.questions.map(toRuntimeQuestion),
  });
}
