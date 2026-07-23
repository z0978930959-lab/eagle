'use client';

import { useState, useEffect, useRef } from 'react';

/* ------------------------------------------------------------------
 * 房間聊天室（棒球／賓果／璀璨寶石共用）
 *
 * 訊息跟著房間狀態一起輪詢回來，所以這裡不自己輪詢；
 * 送出後把回應的 view 交給上層，畫面就會更新。
 *
 * props:
 *   code, token  房間資訊
 *   chat         [{ id, role, text, ts }]
 *   role         'away' | 'home'
 *   labels       { away, home }  雙方稱呼
 *   onView       (view) => void  送出成功後把新的 view 交回上層
 * ------------------------------------------------------------------ */

const MAX_LEN = 200;

function timeOf(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function Chat({ code, token, chat = [], role, labels, onView }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [seen, setSeen] = useState(0);
  const listRef = useRef(null);

  const names = { away: labels?.away || '建房方', home: labels?.home || '加入方' };
  const unread = Math.max(0, chat.length - seen);

  // 開著的時候自動捲到最新、並把未讀歸零
  useEffect(() => {
    if (!open) return;
    setSeen(chat.length);
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open, chat.length]);

  async function send() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/room/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, token, action: 'chat_send', payload: { text: body } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data.error === 'CHAT_TOO_FAST' ? '發言太快，稍等一下' : data.message || '送出失敗');
      } else {
        setText('');
        if (data.view && onView) onView(data.view);
      }
    } catch {
      setErr('連線失敗');
    } finally {
      setBusy(false);
    }
  }

  if (!code || !token) return null;

  return (
    <>
      {/* 收合時的浮動按鈕 */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          title="開啟聊天室"
          className="fixed bottom-4 right-4 z-[80] w-12 h-12 rounded-full bg-black/70 border border-field-chalk/25 text-field-chalk/80 text-xl leading-none shadow-dugout hover:border-field-floodlight hover:text-field-floodlight transition-colors"
        >
          💬
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-field-floodlight text-field-night text-[11px] font-bold flex items-center justify-center">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
      )}

      {/* 展開的面板 */}
      {open && (
        <div className="fixed bottom-4 right-4 z-[80] w-[min(340px,calc(100vw-2rem))] rounded-2xl bg-[#0c1410]/95 backdrop-blur border border-field-chalk/20 shadow-dugout flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-field-chalk/12">
            <span className="text-xs tracking-widest text-field-chalk/60">聊天室</span>
            <button
              onClick={() => setOpen(false)}
              className="w-7 h-7 rounded-full text-field-chalk/50 hover:text-field-floodlight text-lg leading-none"
              title="收合"
            >
              ×
            </button>
          </div>

          <div ref={listRef} className="h-56 overflow-y-auto px-3 py-2 space-y-2">
            {chat.length === 0 && (
              <div className="text-[11px] text-field-chalk/35 text-center pt-16">
                還沒有人說話——先打聲招呼吧
              </div>
            )}
            {chat.map((m) => {
              const mine = m.role === role;
              return (
                <div key={m.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                  <div className="text-[10px] text-field-chalk/35 px-1 mb-0.5">
                    {mine ? '我' : names[m.role]}　{timeOf(m.ts)}
                  </div>
                  <div
                    className={`max-w-[85%] px-2.5 py-1.5 rounded-xl text-[13px] leading-relaxed whitespace-pre-wrap break-words ${
                      mine
                        ? 'bg-field-floodlight/20 border border-field-floodlight/35 text-field-chalk'
                        : 'bg-black/45 border border-field-chalk/15 text-field-chalk/85'
                    }`}
                  >
                    {m.text}
                  </div>
                </div>
              );
            })}
          </div>

          {err && <div className="px-3 pb-1 text-[11px] text-red-300/80">{err}</div>}

          <div className="flex items-end gap-2 px-3 py-2 border-t border-field-chalk/12">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MAX_LEN))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={1}
              placeholder="說點什麼…（Enter 送出）"
              className="flex-1 resize-none bg-black/40 border border-field-chalk/20 rounded-lg px-2.5 py-1.5 text-[13px] text-field-chalk placeholder:text-field-chalk/25 focus:outline-none focus:border-field-floodlight/60 max-h-24"
            />
            <button
              onClick={send}
              disabled={busy || !text.trim()}
              className="shrink-0 px-3 py-1.5 rounded-lg border border-field-chalk/25 text-xs text-field-chalk/80 disabled:opacity-30 hover:border-field-floodlight hover:text-field-floodlight transition-colors"
            >
              送出
            </button>
          </div>
        </div>
      )}
    </>
  );
}
