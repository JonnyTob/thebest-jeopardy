import type { StartupRules } from './protocol.js';

export const defaultStartupRules: StartupRules = {
  title: 'How to play',
  rules: [
    'Join on your phone and keep the page open.',
    'Buzz first and answer aloud. A wrong buzz loses points.',
    'For typed questions, submit one answer before time runs out.',
    'Type + buzz: a correct buzz replaces your typed award.',
    'The host makes the final call. Have fun!',
  ],
};
