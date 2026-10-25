import { isolatedUsageFile } from '../server/llm/usage-file.ts';

// Standalone verification must not inherit the play server's counter or credentials.
process.env.LLM_USAGE_FILE = isolatedUsageFile();
process.env.LLM_PROVIDER = 'mock';
process.env.LLM_DIAGNOSTIC_SOURCE = 'test';
for (const name of ['GEMINI_API_KEY', 'GEMINI_MODEL_ID', 'GOOGLE_API_KEY', 'OPENAI_API_KEY', 'OPENAI_COMPAT_API_KEY']) delete process.env[name];
