// ── API / Message types ──

export type ApiFormat = 'anthropic' | 'openai';

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ImageBlock {
  type: 'image';
  source: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

export type ContentBlock = TextBlock | ImageBlock;

export type MessageContent = string | ContentBlock[];

export interface Message {
  role: 'user' | 'assistant';
  content: MessageContent;
}

// ── API Config ──

export interface APIConfig {
  id: string;
  name: string;
  base: string;
  key: string;
  model: string;
  fmt: ApiFormat;
}

export interface PresetConfig {
  base: string;
  model: string;
  fmt: ApiFormat;
}

// ── Session ──

export interface Session {
  id: string;
  title: string;
  updatedAt: number;
  history: Message[];
}

// ── Visualisation ──

export type VizType = 'html' | 'react';

export interface VizPart {
  type: 'text';
  content: string;
}

export interface VizCodePart {
  type: VizType;
  code: string;
}

export type ParsedPart = VizPart | VizCodePart;

export interface VizEntry {
  type: VizType;
  code: string;
}

// ── Pending image ──

export interface PendingImage {
  base64: string;
  mediaType: string;
  dataUrl: string;
  name: string;
}
