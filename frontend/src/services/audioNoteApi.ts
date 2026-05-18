import client from '../api/client';
import { FileSystemObject } from '../types';

export type AudioNoteStatus = 'recording' | 'queued' | 'processing' | 'draft_ready' | 'ready' | 'failed';
export type AudioNoteProvider = 'auto' | 'funasr' | 'faster-whisper';

export interface AudioNoteTranscriptSegment {
  id: string;
  start?: number;
  end?: number;
  text: string;
  source?: string;
}

export interface AudioNoteAnalysis {
  version: 1;
  status: AudioNoteStatus;
  provider: AudioNoteProvider | 'fallback';
  transcript: AudioNoteTranscriptSegment[];
  transcriptText: string;
  noteDraft: string;
  progress: {
    stage: string;
    percent: number;
    message?: string;
    jobId?: string;
    updatedAt: string;
  };
  chunks: Array<{
    id: string;
    index: number;
    fileObjectId: string;
    name: string;
    size?: number;
    createdAt: string;
  }>;
  warnings: string[];
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export const audioNoteApi = {
  createRecording: async (
    workspaceId: string,
    data: { workbenchId: string; name?: string; mimeType?: string }
  ): Promise<{ file: FileSystemObject; analysis: AudioNoteAnalysis }> => {
    const response = await client.post(`/audio-notes/workspace/${workspaceId}/recordings`, data, { timeout: 60000 });
    return response.data;
  },

  appendChunk: async (
    workspaceId: string,
    fileObjectId: string,
    chunk: Blob,
    chunkIndex: number
  ): Promise<{ chunk: FileSystemObject; analysis: AudioNoteAnalysis }> => {
    const formData = new FormData();
    formData.append('chunk', chunk, `chunk-${String(chunkIndex).padStart(4, '0')}.webm`);
    formData.append('chunkIndex', String(chunkIndex));
    const response = await client.post(`/audio-notes/workspace/${workspaceId}/${fileObjectId}/chunks`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000
    });
    return response.data;
  },

  finishRecording: async (
    workspaceId: string,
    fileObjectId: string,
    provider: AudioNoteProvider = 'auto'
  ): Promise<{ analysis: AudioNoteAnalysis }> => {
    const response = await client.post(`/audio-notes/workspace/${workspaceId}/${fileObjectId}/finish`, { provider }, { timeout: 30000 });
    return response.data;
  },

  startAnalysis: async (
    workspaceId: string,
    fileObjectId: string,
    provider: AudioNoteProvider = 'auto'
  ): Promise<{ analysis: AudioNoteAnalysis }> => {
    const response = await client.post(`/audio-notes/workspace/${workspaceId}/${fileObjectId}/analyze`, { provider }, { timeout: 30000 });
    return response.data;
  },

  getAnalysis: async (workspaceId: string, fileObjectId: string): Promise<{ analysis: AudioNoteAnalysis }> => {
    const response = await client.get(`/audio-notes/workspace/${workspaceId}/${fileObjectId}`, { timeout: 30000 });
    return response.data;
  }
};
