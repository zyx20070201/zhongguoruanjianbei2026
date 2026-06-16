import dotenv from 'dotenv';

const AI_ENV_KEYS = [
  'AI_DEFAULT_PROVIDER',
  'AI_CHAT_PROVIDER',
  'AI_STUDIO_PROVIDER',
  'AI_STUDIO_MODEL',
  'AI_STUDIO_FALLBACK_PROVIDERS',
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
  const parsed = dotenv.config({ quiet: true }).parsed || {};
  AI_ENV_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(parsed, key)) {
      process.env[key] = parsed[key];
    }
  });
};
