import { useEffect, useRef } from 'react';
import type { Message } from '../../types';
import { MessageBubble } from './MessageBubble';
import { HintPanel } from './HintPanel';
import { LoadingDots } from './LoadingDots';
import './Chat.css';

interface ChatAreaProps {
  history: Message[];
  loading: boolean;
  onHintClick: (text: string) => void;
}

export function ChatArea({ history, loading, onHintClick }: ChatAreaProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history, loading]);

  return (
    <div className="chat">
      {history.length === 0 && !loading && (
        <HintPanel onHintClick={onHintClick} />
      )}
      {history.map((msg, i) => (
        <MessageBubble key={i} message={msg} />
      ))}
      {loading && <LoadingDots />}
      <div ref={bottomRef} />
    </div>
  );
}
