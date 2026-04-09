import React, { useState } from 'react';
import { PanelInstance } from '../../types';
import PanelHeader from './PanelHeader';
import { Sparkles, Send, FileText, Code, MessageSquare, BookOpen } from 'lucide-react';

interface AIAssistantPanelProps {
  panel: PanelInstance;
  onClose: () => void;
  onRemove: () => void;
}

export default function AIAssistantPanel({ panel, onClose, onRemove }: AIAssistantPanelProps) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Hi! I am scoped to this workbench. I can help you understand the resources, summarize your notes, or explain code.' }
  ]);

  const handleSend = () => {
    if (!input.trim()) return;
    
    setMessages([...messages, { role: 'user', content: input }]);
    setInput('');
    
    // Mock response
    setTimeout(() => {
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: 'I understand you are asking about the current workbench context. As an AI assistant, I can analyze the files referenced in your other panels to help you with this task.' 
      }]);
    }, 1000);
  };

  return (
    <div className="h-full flex flex-col bg-white rounded-lg shadow-sm border border-purple-200 overflow-hidden">
      <div className="panel-header bg-gradient-to-r from-purple-50 to-indigo-50 px-3 py-2 border-b border-purple-100 flex justify-between items-center cursor-move select-none">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-purple-600" />
          <span className="font-bold text-xs text-purple-900">AI Assistant</span>
          <span className="text-[10px] text-purple-600 bg-purple-100/50 px-1.5 py-0.5 rounded border border-purple-200">
            Scoped to Workbench
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onRemove} className="text-[10px] text-purple-600 hover:underline mr-2">Remove</button>
          <button onClick={onClose} className="p-1 text-purple-400 hover:text-purple-600 hover:bg-purple-100 rounded transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 bg-gray-50/30">
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 max-w-[90%] ${msg.role === 'user' ? 'self-end flex-row-reverse' : ''}`}>
            <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-xs shadow-sm ${
              msg.role === 'user' ? 'bg-gray-200 text-gray-600 font-bold' : 'bg-gradient-to-br from-purple-500 to-indigo-600 text-white'
            }`}>
              {msg.role === 'user' ? 'ME' : <Sparkles className="w-3 h-3" />}
            </div>
            <div className={`rounded-2xl p-3 text-sm shadow-sm ${
              msg.role === 'user' 
                ? 'bg-blue-600 text-white rounded-tr-none' 
                : 'bg-white border border-gray-100 text-gray-800 rounded-tl-none'
            }`}>
              {msg.content}
            </div>
          </div>
        ))}
      </div>

      <div className="p-3 border-t border-gray-100 bg-white">
        <div className="flex flex-wrap gap-1.5 mb-2">
          <button onClick={() => setInput('Explain the current resource')} className="px-2 py-1 text-[10px] border border-gray-200 rounded-full hover:bg-gray-50 text-gray-600 flex items-center gap-1">
            <BookOpen className="w-3 h-3" /> Explain Resource
          </button>
          <button onClick={() => setInput('Summarize my notes')} className="px-2 py-1 text-[10px] border border-gray-200 rounded-full hover:bg-gray-50 text-gray-600 flex items-center gap-1">
            <FileText className="w-3 h-3" /> Summarize Notes
          </button>
          <button onClick={() => setInput('Help with this code')} className="px-2 py-1 text-[10px] border border-gray-200 rounded-full hover:bg-gray-50 text-gray-600 flex items-center gap-1">
            <Code className="w-3 h-3" /> Help with Code
          </button>
        </div>
        
        <div className="relative flex items-end shadow-sm rounded-lg border border-gray-300 bg-white focus-within:ring-2 focus-within:ring-purple-500 focus-within:border-purple-500 overflow-hidden">
          <textarea 
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            className="w-full max-h-32 min-h-[40px] py-2.5 pl-3 pr-10 text-sm outline-none resize-none bg-transparent"
            placeholder="Ask AI about this task..."
            rows={1}
          />
          <button 
            onClick={handleSend}
            disabled={!input.trim()}
            className="absolute right-1.5 bottom-1.5 p-1.5 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors shadow-sm disabled:opacity-50"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
