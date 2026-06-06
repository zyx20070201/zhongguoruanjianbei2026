interface OpenWebUIIconProps {
  className?: string;
  strokeWidth?: number;
}

export function OpenWebUISidebarIcon({ className = 'size-5' }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth="1.5"
      stroke="currentColor"
      className={className}
    >
      <rect x="3" y="3" width="18" height="18" rx="5" ry="5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.5 21V3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function OWPencilSquareIcon({ className = 'size-4', strokeWidth = 1.5 }: OpenWebUIIconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={strokeWidth} stroke="currentColor" className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
    </svg>
  );
}

export function OWSearchIcon({ className = 'size-4', strokeWidth = 1.5 }: OpenWebUIIconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={strokeWidth} stroke="currentColor" aria-hidden="true" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
    </svg>
  );
}

export function OWDocumentPageIcon({ className = 'size-4', strokeWidth = 1.5 }: OpenWebUIIconProps) {
  return (
    <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={strokeWidth} stroke="currentColor" className={className}>
      <path d="M4 21.4V2.6C4 2.26863 4.26863 2 4.6 2H16.2515C16.4106 2 16.5632 2.06321 16.6757 2.17574L19.8243 5.32426C19.9368 5.43679 20 5.5894 20 5.74853V21.4C20 21.7314 19.7314 22 19.4 22H4.6C4.26863 22 4 21.7314 4 21.4Z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 10L16 10" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 18L16 18" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 14L12 14" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 2V5.4C16 5.73137 16.2686 6 16.6 6H20" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function OWChatBubbleIcon({ className = 'size-4', strokeWidth = 1.5 }: OpenWebUIIconProps) {
  return (
    <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={strokeWidth} stroke="currentColor" className={className}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z"
      />
    </svg>
  );
}

export function OWXMarkIcon({ className = 'size-4', strokeWidth = 2 }: OpenWebUIIconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" strokeWidth={strokeWidth} className={className}>
      <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
    </svg>
  );
}

export function OWWorkspaceIcon({ className = 'size-4', strokeWidth = 1.5 }: OpenWebUIIconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={strokeWidth} stroke="currentColor" className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 16.875h3.375m0 0h3.375m-3.375 0V13.5m0 3.375v3.375M6 10.5h2.25a2.25 2.25 0 0 0 2.25-2.25V6a2.25 2.25 0 0 0-2.25-2.25H6A2.25 2.25 0 0 0 3.75 6v2.25A2.25 2.25 0 0 0 6 10.5Zm0 9.75h2.25A2.25 2.25 0 0 0 10.5 18v-2.25a2.25 2.25 0 0 0-2.25-2.25H6a2.25 2.25 0 0 0-2.25 2.25V18A2.25 2.25 0 0 0 6 20.25Zm9.75-9.75H18a2.25 2.25 0 0 0 2.25-2.25V6A2.25 2.25 0 0 0 18 3.75h-2.25A2.25 2.25 0 0 0 13.5 6v2.25a2.25 2.25 0 0 0 2.25 2.25Z" />
    </svg>
  );
}

export function OWEllipsisHorizontalIcon({ className = 'size-4', strokeWidth = 1.5 }: OpenWebUIIconProps) {
  return (
    <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={strokeWidth} stroke="currentColor" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM12.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM18.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
    </svg>
  );
}

export function OWPlusAltIcon({ className = 'h-[22px] w-[22px]', strokeWidth = 2 }: OpenWebUIIconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={strokeWidth} stroke="currentColor" className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

export function OWComponentIcon({ className = 'h-[18px] w-[18px]', strokeWidth = 1.5 }: OpenWebUIIconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={strokeWidth} stroke="currentColor" className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5 4.5 8.25 8.25 12 12 8.25 8.25 4.5Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 4.5 12 8.25 15.75 12 19.5 8.25 15.75 4.5Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 12 4.5 15.75 8.25 19.5 12 15.75 8.25 12Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 12 12 15.75 15.75 19.5 19.5 15.75 15.75 12Z" />
    </svg>
  );
}

export function OWWrenchIcon({ className = 'h-[18px] w-[18px]', strokeWidth = 1.5 }: OpenWebUIIconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={strokeWidth} stroke="currentColor" className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.88-5.88m-3.7 3.8-2.12 2.12a3 3 0 0 1-4.24 0l-.71-.71a3 3 0 0 1 0-4.24l2.12-2.12m4.95 4.95 3.75-3.75m0 0 1.06-1.06a3.75 3.75 0 0 0 .84-4.03l3.18-3.18a6 6 0 0 1-7.42 7.42l-1.06 1.06Z" />
    </svg>
  );
}

export function OWClipIcon({ className = 'size-4', strokeWidth = 1.5 }: OpenWebUIIconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={strokeWidth} stroke="currentColor" className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13" />
    </svg>
  );
}

export function OWGlobeAltIcon({ className = 'size-4', strokeWidth = 1.5 }: OpenWebUIIconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={strokeWidth} stroke="currentColor" className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418" />
    </svg>
  );
}

export function OWDatabaseIcon({ className = 'size-4', strokeWidth = 1.5 }: OpenWebUIIconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={strokeWidth} stroke="currentColor" className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6c0 2.071-3.694 3.75-8.25 3.75S3.75 8.071 3.75 6m16.5 0c0-2.071-3.694-3.75-8.25-3.75S3.75 3.929 3.75 6m16.5 0v12c0 2.071-3.694 3.75-8.25 3.75S3.75 20.071 3.75 18V6m16.5 6c0 2.071-3.694 3.75-8.25 3.75S3.75 14.071 3.75 12" />
    </svg>
  );
}

export function OWClockRotateRightIcon({ className = 'size-4', strokeWidth = 1.5 }: OpenWebUIIconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={strokeWidth} stroke="currentColor" className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 1 1-6 6" />
    </svg>
  );
}

export function OWAdjustmentsHorizontalIcon({ className = 'w-4 h-4', strokeWidth = 1.5 }: OpenWebUIIconProps) {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      stroke="currentColor"
      fill="currentColor"
      className={className}
      strokeWidth={strokeWidth}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75"
      />
    </svg>
  );
}

export function OWDownloadIcon({ className = 'size-4', strokeWidth = 1.5 }: OpenWebUIIconProps) {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={strokeWidth}
      stroke="currentColor"
      className={className}
    >
      <path d="M6 20L18 20" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 4V16M12 16L15.5 12.5M12 16L8.5 12.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
