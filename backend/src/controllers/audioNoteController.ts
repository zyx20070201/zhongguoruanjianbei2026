import { Request, Response } from 'express';
import { audioNoteService } from '../services/audioNoteService';
import { FileSystemError } from '../types/fileSystem';

const getSingleParam = (value: any): string => {
  if (Array.isArray(value)) return String(value[0]);
  if (value == null) return '';
  return String(value);
};

const handleError = (res: Response, error: any) => {
  if (error instanceof FileSystemError) {
    return res.status(error.statusCode).json({ error: error.message });
  }
  console.error(error);
  return res.status(500).json({ error: error.message || 'Internal server error' });
};

export const createAudioRecording = async (req: Request, res: Response) => {
  try {
    const workspaceId = getSingleParam(req.params.workspaceId);
    const { workbenchId, name, mimeType } = req.body ?? {};
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
    if (!workbenchId) return res.status(400).json({ error: 'workbenchId is required' });

    const result = await audioNoteService.createRecording({
      workspaceId,
      workbenchId,
      name,
      mimeType
    });
    return res.json(result);
  } catch (error: any) {
    return handleError(res, error);
  }
};

export const appendAudioChunk = async (req: Request, res: Response) => {
  try {
    const workspaceId = getSingleParam(req.params.workspaceId);
    const fileObjectId = getSingleParam(req.params.fileObjectId);
    const file = (req as any).file;
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
    if (!fileObjectId) return res.status(400).json({ error: 'fileObjectId is required' });
    if (!file) return res.status(400).json({ error: 'chunk file is required' });

    const result = await audioNoteService.appendChunk({
      workspaceId,
      fileObjectId,
      file,
      chunkIndex: Number(req.body?.chunkIndex || 0)
    });
    return res.json(result);
  } catch (error: any) {
    return handleError(res, error);
  }
};

export const finishAudioRecording = async (req: Request, res: Response) => {
  try {
    const workspaceId = getSingleParam(req.params.workspaceId);
    const fileObjectId = getSingleParam(req.params.fileObjectId);
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
    if (!fileObjectId) return res.status(400).json({ error: 'fileObjectId is required' });

    const analysis = await audioNoteService.finishRecording({
      workspaceId,
      fileObjectId,
      provider: req.body?.provider
    });
    return res.json({ analysis });
  } catch (error: any) {
    return handleError(res, error);
  }
};

export const startUploadedAudioAnalysis = async (req: Request, res: Response) => {
  try {
    const workspaceId = getSingleParam(req.params.workspaceId);
    const fileObjectId = getSingleParam(req.params.fileObjectId);
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
    if (!fileObjectId) return res.status(400).json({ error: 'fileObjectId is required' });

    const analysis = await audioNoteService.finishRecording({
      workspaceId,
      fileObjectId,
      provider: req.body?.provider
    });
    return res.json({ analysis });
  } catch (error: any) {
    return handleError(res, error);
  }
};


export const getAudioNoteAnalysis = async (req: Request, res: Response) => {
  try {
    const workspaceId = getSingleParam(req.params.workspaceId);
    const fileObjectId = getSingleParam(req.params.fileObjectId);
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });
    if (!fileObjectId) return res.status(400).json({ error: 'fileObjectId is required' });

    const analysis = await audioNoteService.getAnalysis(workspaceId, fileObjectId);
    return res.json({ analysis });
  } catch (error: any) {
    return handleError(res, error);
  }
};
