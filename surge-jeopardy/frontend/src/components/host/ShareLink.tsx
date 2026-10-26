import { useState } from 'react';

export default function ShareLink({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <div className="bg-gray-800 rounded p-2 flex items-center gap-2">
      <div className="flex-1 min-w-0">
        <div className="text-xs text-gray-400">{label}</div>
        <div className="text-xs text-gray-300 truncate font-mono">{url}</div>
      </div>
      <button className="text-xs btn-ghost py-1 px-2 flex-shrink-0" onClick={copy}>
        {copied ? '✓' : 'Copy'}
      </button>
    </div>
  );
}
