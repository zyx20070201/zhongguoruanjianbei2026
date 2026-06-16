import type { Message } from '../../types';
import { formatText } from '../../utils/markdown';
import { parseResponse } from '../../utils/parser';
import { useState, useCallback, type ReactNode } from 'react';
import { SandboxView } from '../Sandbox/SandboxView';

interface MessageBubbleProps {
  message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  if (message.role === 'user') {
    let text = '';
    let imgs: { dataUrl: string }[] = [];
    if (typeof message.content === 'string') {
      text = message.content;
    } else if (Array.isArray(message.content)) {
      text = message.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      imgs = message.content
        .filter((b) => b.type === 'image')
        .map((b) => ({
          dataUrl: `data:${b.source.media_type};base64,${b.source.data}`,
        }));
    }
    return (
      <div className="msg">
        <div className="msg-lbl u">You</div>
        <div className="msg-b u">
          {text}
          {imgs.length > 0 && (
            <div className="msg-img">
              {imgs.map((img, i) => (
                <img key={i} src={img.dataUrl} alt="" />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Assistant message
  const text = typeof message.content === 'string' ? message.content : '';
  const parts = parseResponse(text);

  return (
    <>
      {parts.map((part, i) => {
        if (part.type === 'text') {
          return (
            <div key={i} className="msg">
              <div className="msg-lbl">Claude</div>
              <div
                className="msg-b a"
                dangerouslySetInnerHTML={{ __html: formatText(part.content) }}
              />
            </div>
          );
        }
        const vizId = `v-${i}`;
        return (
          <SandboxView
            key={i}
            vizId={vizId}
            type={part.type}
            code={part.code}
            title={part.type === 'html' ? '可视化' : 'React 组件'}
            initialHeight={part.type === 'html' ? 420 : 500}
          />
        );
      })}
    </>
  );
}
