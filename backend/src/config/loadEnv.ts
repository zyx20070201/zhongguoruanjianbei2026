import dotenv from 'dotenv';

const AI_ENV_KEYS = [
  'AI_DEFAULT_PROVIDER',
  'AI_DEFAULT_MODEL',
  'AI_CHAT_PROVIDER',
  'AI_CHAT_MODEL',
  'AI_STUDIO_PROVIDER',
  'AI_STUDIO_MODEL',
  'AI_STUDIO_FALLBACK_PROVIDERS',
  'AI_PLANNER_PROVIDER',
  'AI_PLANNER_MODEL',
  'AI_LEARNING_PROVIDER',
  'AI_LEARNING_MODEL',
  'AI_TERMINAL_PROVIDER',
  'AI_TERMINAL_MODEL',
  'AI_MEMORY_PROVIDER',
  'AI_MEMORY_MODEL',
  'AI_FLASHCARD_PROVIDER',
  'AI_FLASHCARD_MODEL',
  'AI_QUIZ_PROVIDER',
  'AI_QUIZ_MODEL',
  'AI_RESOURCE_PROVIDER',
  'AI_RESOURCE_MODEL',
  'AI_VIDEO_PROVIDER',
  'AI_VIDEO_MODEL',
  'AI_TABLE_PROVIDER',
  'AI_TABLE_MODEL',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_API_MODE',
  'OPENAI_MODEL',
  'DEEPSEEK_API_KEY',
  'DEEPSEEK_BASE_URL',
  'DEEPSEEK_MODEL',
  'GEMINI_API_KEY',
  'GEMINI_BASE_URL',
  'GEMINI_MODEL',
  'ANTHROPIC_API_KEY',
  'CLAUDE_API_KEY',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_BASE_URL',
  'CLAUDE_MODEL'
];

export const loadEnv = () => {
  const base = dotenv.config({ path: '.env', quiet: true }).parsed || {};
  const local = dotenv.config({ path: '.env.local', override: true, quiet: true }).parsed || {};
  const parsed = { ...base, ...local };
  AI_ENV_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(parsed, key)) {
      process.env[key] = parsed[key];
    }
  });
};
