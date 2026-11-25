import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/** backend/ klasörü: .env.local, .cache ve Synthesia worker buradan bulunur. */
export const BACKEND_ROOT = fileURLToPath(new URL('..', import.meta.url));
/** Projelerin dışındaki ortak RAG klasörü (çalışma alanı kökündeki rag/). */
export const RAG_ROOT = join(BACKEND_ROOT, '..', 'rag');
export const RAG_DOCS = join(RAG_ROOT, 'pmi-rag-dummy');
export const RAG_PROMPT_FILE = join(RAG_ROOT, 'rag-prompt.md');
export const RAG_VECTOR_CACHE = join(BACKEND_ROOT, '.cache', 'rag-vectors.json');
