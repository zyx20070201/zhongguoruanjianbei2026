type CodeLabLanguage =
  | 'javascript'
  | 'typescript'
  | 'python'
  | 'java'
  | 'cpp'
  | 'c'
  | 'go'
  | 'rust'
  | 'sql'
  | 'sqlite';

interface Judge0SubmissionResponse {
  token?: string;
  stdout?: string | null;
  stderr?: string | null;
  compile_output?: string | null;
  message?: string | null;
  time?: string | null;
  memory?: number | null;
  status?: { id?: number; description?: string };
}

export interface CodeExecutionInput {
  language: string;
  sourceCode: string;
  stdin?: string;
}

export interface CodeExecutionResult {
  provider: 'judge0';
  language: CodeLabLanguage;
  status: {
    id: number | null;
    description: string;
    success: boolean;
  };
  stdout: string;
  stderr: string;
  compileOutput: string;
  message: string;
  time: string | null;
  memory: number | null;
}

const DEFAULT_JUDGE0_BASE_URL = 'http://localhost:2358';
const MAX_SOURCE_LENGTH = Number(process.env.CODE_LAB_MAX_SOURCE_CHARS || 80_000);
const MAX_STDIN_LENGTH = Number(process.env.CODE_LAB_MAX_STDIN_CHARS || 20_000);
const JUDGE0_TIMEOUT_MS = Number(process.env.JUDGE0_TIMEOUT_MS || 30_000);

const LANGUAGE_IDS: Record<CodeLabLanguage, number> = {
  c: 50,
  cpp: 54,
  java: 62,
  javascript: 63,
  typescript: 74,
  python: 71,
  go: 60,
  rust: 73,
  sql: 82,
  sqlite: 82
};

const normalizeLanguage = (language: string): CodeLabLanguage | null => {
  const value = language.trim().toLowerCase();
  if (['js', 'node', 'nodejs'].includes(value)) return 'javascript';
  if (['ts'].includes(value)) return 'typescript';
  if (['py', 'python3'].includes(value)) return 'python';
  if (['c++', 'cc', 'cpp17'].includes(value)) return 'cpp';
  if (['golang'].includes(value)) return 'go';
  if (['sqlite3', 'sqlite', 'sql'].includes(value)) return 'sql';
  if (value in LANGUAGE_IDS) return value as CodeLabLanguage;
  return null;
};

const judge0BaseUrl = () =>
  (process.env.JUDGE0_BASE_URL || process.env.CODE_LAB_JUDGE0_BASE_URL || DEFAULT_JUDGE0_BASE_URL).replace(/\/$/, '');

const judge0Headers = () => {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const apiKey = process.env.JUDGE0_API_KEY?.trim();
  if (apiKey) headers['x-auth-token'] = apiKey;
  return headers;
};

class CodeExecutionService {
  supportedLanguages() {
    return Object.keys(LANGUAGE_IDS);
  }

  async run(input: CodeExecutionInput): Promise<CodeExecutionResult> {
    const language = normalizeLanguage(input.language);
    if (!language) throw new Error(`Unsupported Code Lab language "${input.language}"`);

    const sourceCode = String(input.sourceCode || '');
    const stdin = String(input.stdin || '');
    if (!sourceCode.trim()) throw new Error('sourceCode is required');
    if (sourceCode.length > MAX_SOURCE_LENGTH) throw new Error(`sourceCode exceeds ${MAX_SOURCE_LENGTH} characters`);
    if (stdin.length > MAX_STDIN_LENGTH) throw new Error(`stdin exceeds ${MAX_STDIN_LENGTH} characters`);

    let response: Response;
    try {
      response = await fetch(`${judge0BaseUrl()}/submissions?base64_encoded=false&wait=true`, {
        method: 'POST',
        headers: judge0Headers(),
        body: JSON.stringify({
          language_id: LANGUAGE_IDS[language],
          source_code: sourceCode,
          stdin,
          redirect_stderr_to_stdout: false
        }),
        signal: AbortSignal.timeout(JUDGE0_TIMEOUT_MS)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Judge0 is unreachable at ${judge0BaseUrl()}. Start Judge0 or set JUDGE0_BASE_URL. Detail: ${message}`);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Judge0 execution failed (${response.status}): ${body || response.statusText}`);
    }

    const result = await response.json() as Judge0SubmissionResponse;
    const statusId = typeof result.status?.id === 'number' ? result.status.id : null;
    const statusDescription = result.status?.description || 'Unknown';
    return {
      provider: 'judge0',
      language,
      status: {
        id: statusId,
        description: statusDescription,
        success: statusId === 3
      },
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      compileOutput: result.compile_output || '',
      message: result.message || '',
      time: result.time || null,
      memory: typeof result.memory === 'number' ? result.memory : null
    };
  }
}

export const codeExecutionService = new CodeExecutionService();
