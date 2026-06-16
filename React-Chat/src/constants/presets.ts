import type { PresetConfig } from '../types';

export const PRESETS: Record<string, PresetConfig> = {
  anthropic: {
    base: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-20250514',
    fmt: 'anthropic',
  },
  openrouter: {
    base: 'https://openrouter.ai/api',
    model: 'anthropic/claude-sonnet-4',
    fmt: 'anthropic',
  },
  oneapi: {
    base: 'https://your-domain.com',
    model: 'claude-sonnet-4-20250514',
    fmt: 'anthropic',
  },
  'openai-compat': {
    base: 'https://api.openai.com',
    model: 'gpt-4o',
    fmt: 'openai',
  },
};
