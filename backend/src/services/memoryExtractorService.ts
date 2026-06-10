import {
  chatSignalExtractorService,
  CHAT_SIGNAL_EXTRACTOR_PROMPT_VERSION,
  CHAT_SIGNAL_EXTRACTOR_VERSION,
  ChatSignalExtractionResult
} from './chatSignalExtractorService';

export const MEMORY_EXTRACTOR_VERSION = CHAT_SIGNAL_EXTRACTOR_VERSION;
export const MEMORY_EXTRACTOR_PROMPT_VERSION = CHAT_SIGNAL_EXTRACTOR_PROMPT_VERSION;
export type MemoryExtractionResult = ChatSignalExtractionResult;

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export class MemoryExtractorService {
  extract(input: {
    workspaceId: string;
    workbenchId?: string | null;
    userId: string;
    messages: ChatMessage[];
    answer?: string;
    sourceId?: string | null;
  }) {
    return chatSignalExtractorService.extract(input);
  }

  apply(input: {
    workspaceId: string;
    workbenchId?: string | null;
    userId: string;
    messages: ChatMessage[];
    answer?: string;
    sourceId?: string | null;
  }) {
    return chatSignalExtractorService.apply(input);
  }
}

export const memoryExtractorService = new MemoryExtractorService();
