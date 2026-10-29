export type LoadedMediaReference =
  | { file: string; kind: 'cover' }
  | { file: string; kind: 'question'; questionIndex: number };
