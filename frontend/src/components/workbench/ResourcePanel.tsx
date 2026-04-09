import React from 'react';
import { PanelInstance } from '../../types';
import PanelHeader from './PanelHeader';
import { FileText, Image as ImageIcon, File, Play } from 'lucide-react';

interface ResourcePanelProps {
  panel: PanelInstance;
  onClose: () => void;
  onRemove: () => void;
  onReplaceReference: () => void;
}

export default function ResourcePanel({ panel, onClose, onRemove, onReplaceReference }: ResourcePanelProps) {
  // Mock content based on referenced file
  const isPdf = panel.referencedFileId?.endsWith('.pdf');
  const isImage = panel.referencedFileId?.endsWith('.png') || panel.referencedFileId?.endsWith('.jpg');
  const isVideo = panel.referencedFileId?.endsWith('.mp4');

  return (
    <div className="h-full flex flex-col bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <PanelHeader 
        panel={panel} 
        onClose={onClose} 
        onRemove={onRemove} 
        onReplaceReference={onReplaceReference} 
      />
      
      <div className="flex-1 overflow-auto bg-gray-50 flex flex-col items-center justify-center p-4">
        {!panel.referencedFileId ? (
          <div className="text-center">
            <File className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500 mb-4">No resource selected</p>
            <button 
              onClick={onReplaceReference}
              className="px-4 py-2 bg-white border border-gray-200 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Select File
            </button>
          </div>
        ) : isPdf ? (
          <div className="w-full h-full bg-white border border-gray-200 shadow-sm flex flex-col">
            <div className="bg-gray-100 border-b border-gray-200 p-2 flex justify-between items-center text-xs text-gray-500">
              <span>Page 1 / 42</span>
              <div className="flex gap-2">
                <button className="hover:text-gray-800">-</button>
                <span>100%</span>
                <button className="hover:text-gray-800">+</button>
              </div>
            </div>
            <div className="flex-1 p-8 flex items-center justify-center text-gray-400">
              [PDF Content Mock: {panel.referencedFileId}]
            </div>
          </div>
        ) : isImage ? (
          <div className="w-full h-full flex items-center justify-center bg-gray-100 rounded border border-gray-200">
            <ImageIcon className="w-16 h-16 text-gray-300" />
            <span className="ml-2 text-gray-400 text-sm">Image Preview</span>
          </div>
        ) : isVideo ? (
          <div className="w-full aspect-video bg-black rounded flex items-center justify-center group cursor-pointer relative">
            <Play className="w-12 h-12 text-white opacity-80 group-hover:opacity-100 transition-opacity" />
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-gray-800">
              <div className="h-full bg-blue-500 w-1/3"></div>
            </div>
          </div>
        ) : (
          <div className="w-full h-full bg-white border border-gray-200 p-6 text-sm text-gray-700 font-mono whitespace-pre-wrap overflow-auto">
            {`// Mock text content for ${panel.referencedFileId}

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.`}
          </div>
        )}
      </div>
    </div>
  );
}
