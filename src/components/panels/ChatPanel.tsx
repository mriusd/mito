import { useState, useEffect, useRef, useCallback } from 'react';
import { useAccount } from 'wagmi';
import { MessageCircle, Send } from 'lucide-react';
import { fetchChatMessages, postChatMessage } from '../../api';
import type { ChatMessage } from '../../api';
import { API_BASE } from '../../lib/env';

// Cache nickname from Polymarket profile
const nicknameCache: Record<string, string> = {};

async function fetchPolymarketNickname(address: string): Promise<string> {
  const key = address.toLowerCase();
  if (nicknameCache[key]) return nicknameCache[key];
  try {
    // Gamma API is CORS-restricted in browser contexts; always use backend proxy.
    const url = `${API_BASE}/api/polyproxy/gamma/public-profile?address=${address}`;
    const resp = await fetch(url);
    if (!resp.ok) return '';
    const data = await resp.json();
    const name = data.username || data.name || '';
    if (name) nicknameCache[key] = name;
    return name;
  } catch {
    return '';
  }
}

function shortAddr(addr: string): string {
  if (addr.length > 10) return addr.slice(0, 6) + '...' + addr.slice(-4);
  return addr;
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

export function ChatPanel() {
  const { address, isConnected } = useAccount();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [nickname, setNickname] = useState('');
  const [loading, setLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  // Fetch Polymarket nickname on connect
  useEffect(() => {
    if (!address) return;
    fetchPolymarketNickname(address).then((n) => {
      if (n) setNickname(n);
    });
  }, [address]);

  // Load messages
  const loadMessages = useCallback(async () => {
    try {
      const msgs = await fetchChatMessages(100);
      setMessages(msgs.reverse()); // API returns newest-first, we want oldest-first
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMessages();
    // Poll every 5s for new messages
    pollRef.current = setInterval(loadMessages, 5000);
    return () => clearInterval(pollRef.current);
  }, [loadMessages]);

  // Auto-scroll to bottom on new messages (within container only)
  useEffect(() => {
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || !address || sending) return;
    setSending(true);
    try {
      const msg = await postChatMessage(address, nickname, input.trim());
      setMessages((prev) => [...prev, msg]);
      setInput('');
    } catch {
      // ignore
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleMention = (name: string) => {
    const mention = `@${name} `;
    setInput((prev) => prev ? prev + mention : mention);
    inputRef.current?.focus();
  };

  const myAddr = address?.toLowerCase() || '';

  return (
    <div className="panel-wrapper bg-gray-800/50 rounded-lg p-3 h-full flex flex-col">
      <div className="panel-header">
        <h3 className="text-sm font-bold text-yellow-400 mb-2 flex items-center justify-between">
          <span>
            <MessageCircle className="inline w-3.5 h-3.5 mr-1" />
            Chat
          </span>
          <span className="text-gray-500 text-[9px] font-normal">{messages.length} msgs</span>
        </h3>
      </div>

      {/* Messages */}
      <div ref={containerRef} className="panel-body flex-1 overflow-y-auto space-y-0.5 min-h-0 text-xs flex flex-col justify-end">
        {loading && <div className="text-gray-500 text-center py-4">Loading...</div>}
        {!loading && messages.length === 0 && (
          <div className="text-gray-500 text-center py-4">No messages yet. Start the conversation!</div>
        )}
        {messages.map((msg) => {
          const isMine = msg.address.toLowerCase() === myAddr;
          const displayName = msg.nickname || shortAddr(msg.address);
          return (
            <div key={msg.id} className="flex flex-col items-start">
              <div className="flex items-baseline gap-1 max-w-[90%] flex-wrap">
                <span
                  className={`font-medium text-[10px] cursor-pointer hover:underline ${isMine ? 'text-blue-400' : 'text-yellow-400'}`}
                  title={msg.address}
                  onClick={() => handleMention(displayName)}
                >
                  {displayName}
                </span>
                {typeof msg.title === 'string' && msg.title.trim() !== '' && (
                  <span
                    className="inline-flex items-center rounded px-1 py-px text-[8px] font-semibold uppercase tracking-wide bg-purple-900/55 text-purple-200 border border-purple-500/40 shrink-0"
                    title={msg.title}
                  >
                    {msg.title.trim()}
                  </span>
                )}
                <span className="text-gray-600 text-[9px]">{timeAgo(msg.createdAt)}</span>
              </div>
              <div
                className={`rounded px-1.5 py-0.5 max-w-[90%] break-words ${
                  isMine ? 'bg-blue-900/40 text-blue-100' : 'bg-gray-700/60 text-gray-200'
                }`}
              >
                {msg.message}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="mt-2 pt-2 border-t border-gray-700/50">
        {!isConnected ? (
          <div className="text-gray-500 text-center text-[10px]">Connect wallet to chat</div>
        ) : (
          <div className="flex items-center gap-1">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              maxLength={1000}
              className="flex-1 bg-gray-700 border border-gray-600 rounded px-1.5 py-0.5 text-gray-200 text-[11px] outline-none focus:border-blue-500 no-drag"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || sending}
              className="px-1.5 py-0.5 rounded bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-[11px] transition no-drag"
            >
              <Send className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
