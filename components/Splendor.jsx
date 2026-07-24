'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Chat from './Chat';

/* ------------------------------------------------------------------
 * 璀璨寶石．雙人對決前端
 * 流程：大廳（建房／加房）→ 等待對手 → 輪流行動 → 15 分終局
 * 所有規則判定都在伺服器，這裡只負責送出意圖與呈現。
 * ------------------------------------------------------------------ */

async function api(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || ERR_TEXT[data.error] || '連線失敗');
    err.code = data.error;
    err.view = data.view;
    throw err;
  }
  return data;
}

const ERR_TEXT = {
  NOT_YOUR_TURN: '還沒輪到你',
  CANNOT_AFFORD: '寶石不足，買不起這張',
  RESERVE_FULL: '保留卡已有 3 張',
  NOT_ENOUGH_GEMS: '寶石庫存不足',
  BAD_TAKE: '這樣拿不符合規則',
  NO_CARD: '這個位置已經沒有卡了',
  WRONG_PHASE: '目前不能做這個動作',
  ROOM_FULL: '房間已滿',
  NOT_FOUND: '找不到這個房號',
  WRONG_MODE: '房號對應的是別種遊戲',
};

function saveSession(code, token) {
  try {
    sessionStorage.setItem('splendor_session', JSON.stringify({ code, token }));
  } catch {}
}
function loadSession() {
  try {
    const raw = sessionStorage.getItem('splendor_session');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function clearSession() {
  try {
    sessionStorage.removeItem('splendor_session');
  } catch {}
}

const GEM_KEY = ['w', 'u', 'g', 'r', 'k'];
const GEM_NAME = ['鑽石', '藍寶石', '綠寶石', '紅寶石', '瑪瑙'];
const GEM_RING = ['#d8d4c8', '#3d7ec9', '#3f9b68', '#c9484f', '#5b5364'];
const gemSrc = (k) => `/splendor/gems/${k}.png`;

/* ---------------- 飛行動畫 ----------------
 * 任何一方買牌／保留／拿寶石，都用「物件飛到該玩家區域」呈現，
 * 讓對手的動作一眼看得出來（輪詢拿到新的 lastAction 就播一次）。
 * -------------------------------------------------- */

function useFlights() {
  const [flights, setFlights] = useState([]);
  const idRef = useRef(0);

  const launch = useCallback((items) => {
    const made = [];
    const pick = (sel) => {
      const list = Array.isArray(sel) ? sel : [sel];
      for (const q of list) {
        const el = document.querySelector(q);
        if (el) return el;
      }
      return null;
    };
    items.forEach((it, k) => {
      const from = pick(it.from);
      const to = pick(it.to);
      if (!from || !to) return;
      const a = from.getBoundingClientRect();
      const b = to.getBoundingClientRect();
      if (!a.width || !b.width) return;
      made.push({
        id: ++idRef.current,
        x0: a.left + a.width / 2,
        y0: a.top + a.height / 2,
        x1: b.left + b.width / 2,
        y1: b.top + b.height / 2,
        w: it.w,
        h: it.h,
        node: it.node,
        delay: k * 100,
      });
    });
    if (!made.length) return;
    setFlights((f) => [...f, ...made]);
    const ttl = 900 + made.length * 100;
    setTimeout(() => setFlights((f) => f.filter((x) => !made.some((m) => m.id === x.id))), ttl);
  }, []);

  return [flights, launch];
}

function Ghost({ f }) {
  const [go, setGo] = useState(false);
  useEffect(() => {
    let r2;
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => setGo(true));
    });
    return () => {
      cancelAnimationFrame(r1);
      if (r2) cancelAnimationFrame(r2);
    };
  }, []);
  const dx = f.x1 - f.x0;
  const dy = f.y1 - f.y0;
  return (
    <div
      style={{
        position: 'absolute',
        left: f.x0 - f.w / 2,
        top: f.y0 - f.h / 2,
        width: f.w,
        height: f.h,
        transform: go ? `translate(${dx}px, ${dy}px) scale(.5)` : 'translate(0,0) scale(1.06)',
        opacity: go ? 0 : 1,
        transition: `transform 640ms cubic-bezier(.32,.72,.26,1) ${f.delay}ms, opacity 300ms ease-in ${f.delay + 400}ms`,
        filter: 'drop-shadow(0 8px 20px rgba(0,0,0,.75))',
      }}
    >
      {f.node}
    </div>
  );
}

function FlightLayer({ flights }) {
  if (!flights.length) return null;
  return (
    <div className="fixed inset-0 z-[95] pointer-events-none overflow-hidden">
      {flights.map((f) => (
        <Ghost key={f.id} f={f} />
      ))}
    </div>
  );
}

/* 貴族登場：全畫面的登場演出，結束後才把貴族送進玩家區域 */
function NobleEntrance({ fx, onDone }) {
  // onDone 是父層的行內函式，每次輪詢重新渲染都會換一個新的。
  // 若把它放進依賴陣列，計時器會被反覆重設而永遠不會觸發，
  // 所以改用 ref 保存，效果只依 fx.id 起算一次。
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    const t = setTimeout(() => doneRef.current(), 3000);
    return () => clearTimeout(t);
  }, [fx.id]);

  const sparks = Array.from({ length: 14 }, (_, i) => {
    const ang = (i / 14) * Math.PI * 2;
    const dist = 120 + (i % 4) * 34;
    return { x: Math.cos(ang) * dist, y: Math.sin(ang) * dist, d: (i % 7) * 55 };
  });

  return (
    <div className="fixed inset-0 z-[96] pointer-events-none flex items-center justify-center overflow-hidden">
      <div className="absolute inset-0 bg-black/55" style={{ animation: 'spRise 300ms ease-out both' }} />
      <div
        className="absolute w-[560px] h-[560px] rounded-full"
        style={{
          background: 'conic-gradient(from 0deg, transparent 0deg, rgba(245,207,106,.22) 12deg, transparent 26deg, transparent 60deg, rgba(245,207,106,.18) 72deg, transparent 88deg, transparent 130deg, rgba(245,207,106,.22) 142deg, transparent 158deg, transparent 200deg, rgba(245,207,106,.18) 212deg, transparent 228deg, transparent 280deg, rgba(245,207,106,.22) 292deg, transparent 308deg)',
          animation: 'spRays 7s linear infinite',
          maskImage: 'radial-gradient(circle, black 30%, transparent 72%)',
          WebkitMaskImage: 'radial-gradient(circle, black 30%, transparent 72%)',
        }}
      />
      <div className="absolute w-52 h-52 rounded-full border-2" style={{ borderColor: '#f5cf6a', animation: 'spRing 1.1s ease-out forwards' }} />
      <div className="absolute w-52 h-52 rounded-full border" style={{ borderColor: '#f5cf6a99', animation: 'spRing 1.1s ease-out .22s forwards' }} />

      {sparks.map((sp, i) => (
        <span
          key={i}
          className="absolute w-1.5 h-1.5 rounded-full"
          style={{
            background: '#f5cf6a',
            '--sx': `${sp.x}px`,
            '--sy': `${sp.y}px`,
            animation: `spSparkle 1.15s ease-out ${sp.d}ms forwards`,
          }}
        />
      ))}

      <div className="relative flex flex-col items-center">
        <div
          className="text-[11px] tracking-[0.55em] mb-3 pl-[0.55em]"
          style={{ color: '#f5cf6a', animation: 'spRise 420ms ease-out 180ms both' }}
        >
          貴族來訪
        </div>
        <div
          className="rounded-2xl overflow-hidden border-2 shadow-2xl"
          style={{
            borderColor: '#f5cf6a',
            width: 190,
            height: 190,
            boxShadow: '0 0 60px -6px rgba(245,207,106,.7), 0 20px 50px rgba(0,0,0,.8)',
            animation: 'spNoblePop 640ms cubic-bezier(.22,1.2,.36,1) both',
          }}
        >
          <img src={`/splendor/noble/${fx.img}.jpg`} alt="" className="w-full h-full object-cover" />
        </div>
        <div className="mt-4 text-center" style={{ animation: 'spRise 420ms ease-out 380ms both' }}>
          <div className="font-display text-2xl font-black" style={{ color: '#f5cf6a', textShadow: '0 2px 12px rgba(0,0,0,.9)' }}>
            {fx.who}
          </div>
          <div className="font-display font-black text-4xl mt-1" style={{ color: '#f5cf6a', textShadow: '0 0 22px rgba(245,207,106,.55)' }}>
            +3
            <span className="text-sm font-mono ml-1" style={{ color: '#f5cf6aaa' }}>
              pts
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// 飛行中的牌背（暗抽的卡不揭露內容）
function CardBack({ lv }) {
  return (
    <div className="w-full h-full rounded-lg border border-field-chalk/25 bg-[repeating-linear-gradient(135deg,#1c1730_0_5px,#241d3c_5px_10px)] flex items-center justify-center">
      <Stars lv={lv} size="text-xs" />
    </div>
  );
}

/* ---------------- 小元件 ---------------- */

// 寶石圖示（附圖切出的六色素材）
function Gem({ idx, size = 26, count, dim, className = '' }) {
  const k = idx === 'gold' ? 'gold' : GEM_KEY[idx];
  const ring = idx === 'gold' ? '#d6b153' : GEM_RING[idx];
  return (
    <span
      className={`relative inline-flex items-center justify-center shrink-0 ${dim ? 'opacity-35' : ''} ${className}`}
      style={{ width: size, height: size }}
    >
      <span
        className="absolute inset-0 rounded-full"
        style={{ background: `radial-gradient(circle at 32% 28%, ${ring}44, transparent 68%)`, boxShadow: `inset 0 0 0 1.5px ${ring}66` }}
      />
      <img src={gemSrc(k)} alt="" draggable={false} className="relative w-[82%] h-[82%] object-contain drop-shadow" />
      {count !== undefined && (
        <span
          className="absolute -bottom-1 -right-1 min-w-[15px] h-[15px] px-[3px] rounded-full bg-black/85 border border-field-chalk/25 text-[10px] font-mono text-field-chalk flex items-center justify-center"
          style={{ fontSize: 10 }}
        >
          {count}
        </span>
      )}
    </span>
  );
}

// 等級＝金色星星（一星 ★／二星 ★★／三星 ★★★）
function Stars({ lv, size = 'text-xs' }) {
  return (
    <span className={`${size} tracking-[0.12em] leading-none`} style={{ color: '#f0c75e', textShadow: '0 1px 2px rgba(0,0,0,.7)' }}>
      {'★'.repeat(lv)}
    </span>
  );
}

// 分數＝金字
function Pts({ n, big }) {
  if (!n) return null;
  return (
    <span className="inline-flex items-baseline gap-[2px] leading-none">
      <span
        className={`font-display font-black ${big ? 'text-3xl' : 'text-xl'}`}
        style={{ color: '#f5cf6a', textShadow: '0 1px 3px rgba(0,0,0,.85), 0 0 12px rgba(245,207,106,.35)' }}
      >
        {n}
      </span>
      <span className="text-[9px] font-mono" style={{ color: '#f5cf6a99' }}>
        pts
      </span>
    </span>
  );
}

/* ---------------- 發展卡 ---------------- */

function DevCard({ card, affordable, oppAfford, onClick, disabled, compact, flyId }) {
  if (!card) {
    return <div className="rounded-lg border border-dashed border-field-chalk/12 bg-black/20 aspect-[5/7]" />;
  }
  const costs = card.cost.map((n, i) => (n ? { i, n } : null)).filter(Boolean);
  return (
    <button
      data-fly={flyId}
      onClick={onClick}
      disabled={disabled}
      style={affordable ? { borderColor: '#f5cf6a', boxShadow: '0 0 0 1px #f5cf6a55, 0 0 18px -4px rgba(245,207,106,.75)' } : undefined}
      className={`group relative rounded-lg overflow-hidden aspect-[5/7] w-full text-left transition-all
        ${affordable ? 'border-2' : 'border border-field-chalk/18'}
        ${disabled ? 'cursor-default opacity-80' : 'hover:-translate-y-1 active:translate-y-0'}`}
    >
      {/* 對手買得起：卡片上方一個小紅箭頭 */}
      {oppAfford && (
        <span
          className="absolute top-0 left-1/2 -translate-x-1/2 z-20 leading-none pointer-events-none"
          style={{ fontSize: 13, color: '#ff5a5a', textShadow: '0 1px 3px rgba(0,0,0,.9)', animation: 'spBob 1.1s ease-in-out infinite' }}
          title="對手目前買得起這張"
        >
          ▼
        </span>
      )}
      <img
        src={`/splendor/dev/${card.img}.jpg`}
        alt=""
        draggable={false}
        className="absolute inset-0 w-full h-full object-cover"
      />
      <span className="absolute inset-0 bg-gradient-to-b from-black/72 via-black/40 to-black/85" />
      {/* 上緣：寶石獎勵色帶 */}
      <span className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: GEM_RING[card.col] }} />

      <span className="relative flex flex-col justify-between h-full p-1.5">
        <span className="flex items-start justify-between">
          <span className="flex flex-col gap-0.5">
            <Stars lv={card.lv} size={compact ? 'text-[9px]' : 'text-[11px]'} />
            <Pts n={card.pv} />
          </span>
          <Gem idx={card.col} size={compact ? 20 : 26} />
        </span>

        <span className="flex flex-col gap-[3px] items-start">
          {costs.map(({ i, n }) => (
            <span key={i} className="flex items-center gap-1">
              <Gem idx={i} size={compact ? 14 : 17} />
              <span className="font-mono text-[11px] text-field-chalk/90 leading-none drop-shadow">{n}</span>
            </span>
          ))}
        </span>
      </span>
    </button>
  );
}

/* 購買預覽：算出這張卡會扣掉哪些寶石（與伺服器同一套算法） */
function previewPayment(me, card) {
  const pay = [0, 0, 0, 0, 0];
  let need = 0;
  for (let i = 0; i < 5; i++) {
    const c = Math.max(0, card.cost[i] - me.bonus[i]);
    pay[i] = Math.min(c, me.tok[i]);
    need += c - pay[i];
  }
  return { pay, gold: need, ok: need <= me.gold };
}

// 購買前先看清楚：花掉的變灰，剩下的維持原色
function PaymentPreview({ me, card }) {
  const pm = previewPayment(me, card);
  const rows = [];
  for (let i = 0; i < 5; i++) {
    if (me.tok[i] > 0 || pm.pay[i] > 0) rows.push({ i, own: me.tok[i], spend: pm.pay[i], bonus: me.bonus[i] });
  }
  const goldRow = me.gold > 0 || pm.gold > 0 ? { own: me.gold, spend: pm.gold } : null;

  return (
    <div className="rounded-xl border border-field-chalk/15 bg-black/35 p-2.5 text-left">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] tracking-[0.2em] text-field-chalk/40">購買後剩餘</span>
        <span className="text-[9px] text-field-chalk/30">灰色＝將被扣除</span>
      </div>

      {rows.length === 0 && !goldRow && <div className="text-[11px] text-field-chalk/30">目前沒有持有寶石</div>}

      <div className="space-y-1.5">
        {rows.map(({ i, own, spend, bonus }) => (
          <div key={i} className="flex items-center gap-1.5">
            <Gem idx={i} size={17} />
            {bonus > 0 && <span className="font-mono text-[9px] text-[#f5cf6a99] w-7">折{bonus}</span>}
            {bonus === 0 && <span className="w-7" />}
            <div className="flex gap-[3px] flex-wrap flex-1">
              {Array.from({ length: own }).map((_, k) => (
                <span key={k} className={k < spend ? 'grayscale opacity-25' : ''}>
                  <Gem idx={i} size={15} />
                </span>
              ))}
            </div>
            <span className={`font-mono text-[11px] ${spend > 0 ? 'text-[#f5cf6a]' : 'text-field-chalk/45'}`}>
              {own - spend}
            </span>
          </div>
        ))}

        {goldRow && (
          <div className="flex items-center gap-1.5 pt-1.5 border-t border-field-chalk/10">
            <Gem idx="gold" size={17} />
            <span className="w-7" />
            <div className="flex gap-[3px] flex-wrap flex-1">
              {Array.from({ length: goldRow.own }).map((_, k) => (
                <span key={k} className={k < goldRow.spend ? 'grayscale opacity-25' : ''}>
                  <Gem idx="gold" size={15} />
                </span>
              ))}
            </div>
            <span className={`font-mono text-[11px] ${goldRow.spend > 0 ? 'text-[#f5cf6a]' : 'text-field-chalk/45'}`}>
              {goldRow.own - goldRow.spend}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- 貴族 ---------------- */

// 左側常駐用的迷你貴族：只顯示達成進度
function MiniNoble({ noble, myBonus }) {
  const reqs = noble.req.map((v, i) => (v ? { i, v } : null)).filter(Boolean);
  const done = reqs.every((r) => (myBonus?.[r.i] || 0) >= r.v);
  return (
    <div className={`flex items-center gap-1.5 ${noble.taken ? 'opacity-25' : ''}`}>
      <img
        src={`/splendor/noble/${noble.img}.jpg`}
        alt=""
        className="w-8 h-8 rounded object-cover border shrink-0"
        style={{ borderColor: done && !noble.taken ? '#f5cf6a' : '#ffffff22' }}
      />
      <div className="flex flex-wrap gap-x-1 gap-y-0.5">
        {reqs.map(({ i, v }) => {
          const have = myBonus?.[i] || 0;
          return (
            <span key={i} className="flex items-center gap-[2px]">
              <Gem idx={i} size={11} />
              <span className={`font-mono text-[9px] leading-none ${have >= v ? 'text-[#f5cf6a]' : 'text-field-chalk/45'}`}>
                {Math.min(have, v)}/{v}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

// 上方主要的貴族卡：放大，並列出雙方各色現有數
function NobleCard({ noble, myBonus, others = [], onClick, selectable, flyId }) {
  const reqs = noble.req.map((v, i) => (v ? { i, v } : null)).filter(Boolean);
  return (
    <button
      data-fly={flyId}
      onClick={onClick}
      disabled={!selectable}
      className={`flex gap-2.5 items-stretch rounded-xl overflow-hidden border p-2 text-left transition-all bg-black/30
        ${noble.taken ? 'opacity-30 grayscale border-field-chalk/15' : 'border-[#d6b153]/60'}
        ${selectable ? 'ring-2 ring-field-floodlight hover:scale-[1.03] cursor-pointer' : 'cursor-default'}`}
    >
      <div className="relative w-[74px] h-[74px] shrink-0 rounded-lg overflow-hidden">
        <img src={`/splendor/noble/${noble.img}.jpg`} alt="" className="absolute inset-0 w-full h-full object-cover" />
        <span className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
        <span className="absolute bottom-0.5 left-1">
          <Pts n={3} />
        </span>
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-[9px] tracking-[0.2em] text-field-chalk/35 mb-1">入場條件</div>
        <div className="space-y-[3px]">
          {reqs.map(({ i, v }) => {
            const mine = myBonus?.[i] || 0;
            return (
              <div key={i} className="flex items-center gap-1.5 flex-wrap">
                <Gem idx={i} size={15} />
                <span className="font-mono text-[11px] text-field-chalk/80 w-4">{v}</span>
                <span className={`font-mono text-[10px] ${mine >= v ? 'text-[#f5cf6a]' : 'text-field-chalk/40'}`}>你 {mine}</span>
                {others.map((o) => {
                  const n = o.bonus?.[i] || 0;
                  return (
                    <span key={o.seat} className={`font-mono text-[10px] ${n >= v ? 'text-[#ff7a7a]' : 'text-field-chalk/30'}`}>
                      {o.name.replace('玩家', '')} {n}
                    </span>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </button>
  );
}

function NobleTile({ noble, onClick, selectable, flyId }) {
  return (
    <button
      data-fly={flyId}
      onClick={onClick}
      disabled={!selectable}
      className={`relative rounded-lg overflow-hidden w-[76px] h-[76px] shrink-0 border transition-all
        ${noble.taken ? 'opacity-25 grayscale border-field-chalk/15' : 'border-[#d6b153]/70'}
        ${selectable ? 'hover:scale-105 ring-2 ring-field-floodlight cursor-pointer' : 'cursor-default'}`}
    >
      <img src={`/splendor/noble/${noble.img}.jpg`} alt="" draggable={false} className="absolute inset-0 w-full h-full object-cover" />
      <span className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/25 to-black/80" />
      <span className="relative flex flex-col justify-between h-full p-1">
        <span className="text-left">
          <Pts n={3} />
        </span>
        <span className="flex flex-wrap gap-[3px]">
          {noble.req.map((v, i) =>
            v ? (
              <span key={i} className="flex items-center gap-[2px]">
                <Gem idx={i} size={13} />
                <span className="font-mono text-[10px] text-field-chalk/90 leading-none">{v}</span>
              </span>
            ) : null
          )}
        </span>
      </span>
    </button>
  );
}

/* ---------------- 玩家面板 ---------------- */

function Seat({ p, name, active, isMe, res, onBuyRes, discardMode, onDiscard, winPoints, role }) {
  if (!p) {
    return (
      <div className="rounded-xl border border-dashed border-field-chalk/15 bg-black/20 p-3 text-center text-xs text-field-chalk/35">
        等待對手加入…
      </div>
    );
  }
  return (
    <div
      data-fly={role ? `seat-${role}` : undefined}
      className={`relative rounded-xl border p-3 transition-colors ${
        active ? 'border-field-floodlight/70 bg-field-floodlight/[0.06]' : 'border-field-chalk/15 bg-black/30'
      }`}
    >
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-sm tracking-wider text-field-chalk/85 relative">
          {/* 輪到誰：名字上方的箭頭 */}
          {active && (
            <span
              className="absolute -top-[18px] left-1/2 -translate-x-1/2 leading-none whitespace-nowrap"
              style={{ color: '#f5cf6a', fontSize: 15, textShadow: '0 0 10px rgba(245,207,106,.6)', animation: 'spBob 1.1s ease-in-out infinite' }}
            >
              ▼
            </span>
          )}
          {p.order !== null && p.order !== undefined && (
            <span className="text-[10px] font-mono mr-1" style={{ color: '#f5cf6a99' }}>
              {p.order + 1}．
            </span>
          )}
          {name}
          {isMe && <span className="text-[10px] text-field-chalk/40 ml-1">（你）</span>}
        </span>
        <span className="flex items-baseline gap-2">
          <span className="text-[10px] text-field-chalk/35 font-mono">{p.cards} 卡</span>
          <span
            className="font-display font-black text-2xl"
            style={{ color: '#f5cf6a', textShadow: '0 1px 3px rgba(0,0,0,.85)' }}
          >
            {p.pts}
          </span>
          <span className="text-[10px] font-mono" style={{ color: '#f5cf6a80' }}>
            / {winPoints}
          </span>
        </span>
      </div>

      {/* 折扣引擎：各色已擁有的發展卡數 */}
      <div className="flex gap-2 mb-2">
        {p.bonus.map((b, i) => (
          <div key={i} className="flex flex-col items-center gap-1">
            <Gem idx={i} size={22} dim={!b} />
            <span className={`font-mono text-[11px] ${b ? 'text-field-chalk/85' : 'text-field-chalk/25'}`}>{b}</span>
          </div>
        ))}
      </div>

      {/* 持有寶石 */}
      <div className="flex flex-wrap gap-1.5 items-center min-h-[26px] pt-1 border-t border-field-chalk/10">
        {p.tok.every((n) => !n) && !p.gold && <span className="text-[11px] text-field-chalk/25">尚未持有寶石</span>}
        {p.tok.map((n, i) =>
          n ? (
            <button
              key={i}
              disabled={!discardMode}
              onClick={() => onDiscard?.(i)}
              className={discardMode ? 'ring-2 ring-field-floodlight rounded-full' : ''}
            >
              <Gem idx={i} size={24} count={n} />
            </button>
          ) : null
        )}
        {p.gold > 0 && (
          <button disabled={!discardMode} onClick={() => onDiscard?.('gold')} className={discardMode ? 'ring-2 ring-field-floodlight rounded-full' : ''}>
            <Gem idx="gold" size={24} count={p.gold} />
          </button>
        )}
      </div>

      {/* 保留卡 */}
      <div className="mt-2 pt-2 border-t border-field-chalk/10">
        <div className="text-[10px] text-field-chalk/35 mb-1">
          保留卡 {isMe ? `${res?.length || 0}/3` : `${p.reserved}/3`}
          {!isMe && p.resHidden > 0 && <span className="text-field-chalk/25">　其中 {p.resHidden} 張為暗抽</span>}
        </div>
        {isMe ? (
          res?.length ? (
            <div className="grid grid-cols-3 gap-1.5 max-w-[190px]">
              {res.map((c, i) => (
                <DevCard
                  key={c.id}
                  card={c}
                  compact
                  flyId={`res-${role}-${i}`}
                  affordable={onBuyRes?.can?.[i]}
                  onClick={() => onBuyRes?.open(i)}
                  disabled={!onBuyRes}
                />
              ))}
            </div>
          ) : (
            <div className="text-[11px] text-field-chalk/25">無</div>
          )
        ) : (
          <div className="flex gap-1.5 items-start">
            {/* 從檯面保留的：公開情報，正面朝上 */}
            {(p.resOpen || []).map((c) => (
              <div key={c.id} className="w-[52px]">
                <DevCard card={c} compact disabled />
              </div>
            ))}
            {/* 從牌堆暗抽的：只知道有幾張 */}
            {Array.from({ length: p.resHidden || 0 }).map((_, i) => (
              <div
                key={`h${i}`}
                title="對手從牌堆暗抽，內容不公開"
                className="w-[52px] aspect-[5/7] rounded border border-field-chalk/20 bg-[repeating-linear-gradient(135deg,#1c1730_0_4px,#241d3c_4px_8px)] flex items-center justify-center text-field-chalk/25 text-lg"
              >
                ?
              </div>
            ))}
            {!p.reserved && <span className="text-[11px] text-field-chalk/25">無</span>}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- 大廳 ---------------- */

function Lobby({ onEnter, initialError }) {
  const [tab, setTab] = useState('create');
  const [players, setPlayers] = useState(2);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(initialError || '');

  async function create() {
    setBusy(true);
    setErr('');
    try {
      const d = await api('/api/room/create', { mode: 'splendor', players });
      onEnter(d.code, d.token, d.view);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function join() {
    if (!/^\d{4}$/.test(code)) {
      setErr('房號是 4 位數字');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const d = await api('/api/room/join', { code, mode: 'splendor' });
      onEnter(d.code, d.token, d.view);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-[#1a1430] via-[#141024] to-[#0b0912]" />
      <div className="relative z-10 max-w-md mx-auto px-6 py-16 text-center">
        <div className="flex justify-center gap-1.5 mb-4">
          {GEM_KEY.map((k) => (
            <img key={k} src={gemSrc(k)} alt="" className="w-8 h-8 object-contain drop-shadow-lg" />
          ))}
        </div>
        <div className="font-display text-4xl font-black tracking-wide mb-1" style={{ color: '#f5cf6a' }}>
          璀璨寶石
        </div>
        <div className="text-field-chalk/45 text-xs tracking-[0.3em] mb-8">雙人對決．十五分致勝</div>

        <div className="flex rounded-xl overflow-hidden border border-field-chalk/20 mb-5">
          {[
            ['create', '建立房間'],
            ['join', '加入房間'],
          ].map(([k, label]) => (
            <button
              key={k}
              onClick={() => {
                setTab(k);
                setErr('');
              }}
              className={`flex-1 py-2.5 text-sm transition-colors ${
                tab === k ? 'bg-field-floodlight/20 text-field-floodlight' : 'text-field-chalk/50 hover:text-field-chalk/80'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'create' ? (
          <>
            <div className="mb-5">
              <div className="text-[10px] tracking-[0.25em] text-field-chalk/35 mb-2">遊戲人數</div>
              <div className="flex gap-2">
                {[2, 3].map((n) => (
                  <button
                    key={n}
                    onClick={() => setPlayers(n)}
                    className={`flex-1 py-3 rounded-xl border-2 transition-colors ${
                      players === n
                        ? 'border-field-floodlight text-field-floodlight bg-field-floodlight/10'
                        : 'border-field-chalk/20 text-field-chalk/50 hover:border-field-chalk/40'
                    }`}
                  >
                    <div className="text-lg font-bold">{n} 人</div>
                    <div className="text-[10px] mt-0.5 opacity-70">
                      {n === 2 ? '寶石各 4／貴族 3' : '寶石各 5／貴族 4'}
                    </div>
                  </button>
                ))}
              </div>
            </div>
            <p className="text-xs text-field-chalk/45 leading-relaxed mb-5">
              建立後會拿到 4 位數房號，人到齊就自動開始。
              <br />
              {players === 2 ? '以猜金幣決定先後手。' : '以抽籤決定 1／2／3 順位。'}
            </p>
            <button
              onClick={create}
              disabled={busy}
              className="w-full rounded-xl border-2 border-field-floodlight/60 bg-field-floodlight/10 py-3 text-field-floodlight tracking-widest disabled:opacity-40 hover:bg-field-floodlight/20 transition-colors"
            >
              {busy ? '建立中…' : '建立房間'}
            </button>
          </>
        ) : (
          <>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
              onKeyDown={(e) => e.key === 'Enter' && join()}
              placeholder="4 位數房號"
              inputMode="numeric"
              className="w-full text-center font-mono text-2xl tracking-[0.5em] bg-black/40 border border-field-chalk/25 rounded-xl py-3 mb-4 text-field-chalk focus:outline-none focus:border-field-floodlight/70"
            />
            <button
              onClick={join}
              disabled={busy}
              className="w-full rounded-xl border-2 border-field-floodlight/60 bg-field-floodlight/10 py-3 text-field-floodlight tracking-widest disabled:opacity-40 hover:bg-field-floodlight/20 transition-colors"
            >
              {busy ? '加入中…' : '加入房間'}
            </button>
          </>
        )}

        {err && <div className="mt-4 text-sm text-red-300/85">{err}</div>}
      </div>
    </div>
  );
}

/* ---------------- 猜金幣 ---------------- */

const SIDE_LABEL = { H: '正面', T: '反面' };

function CoinToss({ v, onPick, busy }) {
  const c = v.coin || {};
  const decided = !!c.first;
  const iWon = c.first === v.role;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 bg-gradient-to-b from-[#1a1430] to-[#0b0912]">
      <div className="text-[11px] tracking-[0.4em] text-field-chalk/40 mb-8 pl-[0.4em]">猜金幣決定先後手</div>

      <div
        className="w-28 h-28 mb-8"
        style={{ animation: decided ? 'spCoinSpin 1.1s cubic-bezier(.3,.7,.3,1) both' : 'spCoinIdle 2.4s ease-in-out infinite' }}
      >
        <img src="/splendor/gems/gold.png" alt="" className="w-full h-full object-contain drop-shadow-2xl" />
      </div>

      {!decided ? (
        <>
          {!c.myPick ? (
            <>
              <div className="text-sm text-field-chalk/70 mb-1">選一面</div>
              <div className="text-[11px] text-field-chalk/35 mb-5">
                {c.oppPick ? '對手已押走一面，你只能選剩下那面' : '雙方不能押同一面，先選先贏'}
              </div>
              <div className="flex gap-3">
                {['H', 'T'].map((side) => {
                  const taken = c.oppPick === side;
                  return (
                    <button
                      key={side}
                      onClick={() => !taken && onPick(side)}
                      disabled={busy || taken}
                      className={`relative px-9 py-3 rounded-xl border-2 tracking-widest transition-colors ${
                        taken
                          ? 'border-field-chalk/15 text-field-chalk/25 cursor-not-allowed bg-black/30'
                          : 'border-field-floodlight/50 text-field-floodlight hover:bg-field-floodlight/15'
                      } disabled:opacity-60`}
                    >
                      {SIDE_LABEL[side]}
                      {taken && <span className="block text-[9px] mt-0.5 opacity-70">對手已選</span>}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="text-center">
              <div className="text-sm text-field-chalk/70">
                你押了 <span style={{ color: '#f5cf6a' }}>{SIDE_LABEL[c.myPick]}</span>
              </div>
              <div className="text-xs text-field-chalk/40 mt-3">
                {c.oppPicked ? '雙方都選好了，正在開盅…' : '等待對手選擇…'}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="text-center" style={{ animation: 'spRise 400ms ease-out 900ms both' }}>
          <div className="text-xs text-field-chalk/45 mb-2">
            你押 {SIDE_LABEL[c.myPick]}　·　對手押 {SIDE_LABEL[c.oppPick]}
          </div>
          <div className="font-display text-2xl font-black mb-1" style={{ color: '#f5cf6a' }}>
            金幣是{SIDE_LABEL[c.toss]}
          </div>
          <div className="text-lg text-field-chalk/85 mt-3">{iWon ? '你先手' : `${c.firstName} 先手`}</div>
          <div className="text-[11px] text-field-chalk/35 mt-4">即將開始…</div>
        </div>
      )}
    </div>
  );
}

/* 三人局：入座後自動抽籤，揭曉 1／2／3 順位 */
function Lottery({ v }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 bg-gradient-to-b from-[#1a1430] to-[#0b0912]">
      <div className="text-[11px] tracking-[0.4em] text-field-chalk/40 mb-8 pl-[0.4em]">抽籤決定順位</div>
      <div className="w-full max-w-xs space-y-2.5">
        {(v.draw?.order || []).map((o, i) => (
          <div
            key={o.seat}
            className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
              o.isMe ? 'border-[#f5cf6a]/70 bg-[#f5cf6a]/[0.08]' : 'border-field-chalk/15 bg-black/30'
            }`}
            style={{ animation: `spRise 480ms ease-out ${i * 420}ms both` }}
          >
            <span className="font-display font-black text-2xl w-7" style={{ color: o.isMe ? '#f5cf6a' : '#e9e6df66' }}>
              {i + 1}
            </span>
            <span className="flex-1 text-left text-sm text-field-chalk/85">
              {o.name}
              {o.isMe && <span className="text-[10px] text-field-chalk/45 ml-1">（你）</span>}
            </span>
            {i === 0 && <span className="text-[10px]" style={{ color: '#f5cf6a' }}>先手</span>}
          </div>
        ))}
      </div>
      <div className="text-[11px] text-field-chalk/30 mt-8">即將開始…</div>
    </div>
  );
}

/* ---------------- 主元件 ---------------- */

export default function Splendor() {
  const [session, setSession] = useState(null); // { code, token }
  const [view, setView] = useState(null);
  const [sel, setSel] = useState([]); // 已選取要拿的寶石色 index
  const [modal, setModal] = useState(null); // { kind:'card', card, from, lv, slot, idx }
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [lobbyErr, setLobbyErr] = useState('');
  const pollRef = useRef(null);
  const [flights, launch] = useFlights();
  const playedRef = useRef(null); // null = 尚未初始化；Set = 已播過的動作序號
  const [nobleFx, setNobleFx] = useState(null); // 貴族登場演出
  const [coinDone, setCoinDone] = useState(false); // 猜金幣結果是否已看完
  const [confirmSurrender, setConfirmSurrender] = useState(false);

  // 還原上次的對局
  useEffect(() => {
    const s = loadSession();
    if (s?.code && s?.token) setSession(s);
  }, []);

  const refresh = useCallback(async () => {
    if (!session) return;
    try {
      const d = await api('/api/room/state', session);
      setView(d.view);
    } catch (e) {
      if (e.code === 'NOT_FOUND' || e.code === 'FORBIDDEN') {
        clearSession();
        setSession(null);
        setView(null);
        setLobbyErr('房間已過期或不存在，請重新建立');
      }
    }
  }, [session]);

  // 輪詢：換對手回合時查得勤一點
  useEffect(() => {
    if (!session) return;
    refresh();
    const period = view && !view.myTurn ? 1500 : 3000;
    pollRef.current = setInterval(refresh, period);
    return () => clearInterval(pollRef.current);
  }, [session, refresh, view?.myTurn]);

  // 任何一方的動作都會帶回一個新的 lastAction；序號變大就播放飛行動畫
  useEffect(() => {
    const all = view?.recentActions || [];

    // 第一次拿到狀態：把當下已存在的動作全部標記為「看過了」，不補播歷史
    if (playedRef.current === null) {
      playedRef.current = new Set(all.map((a) => a.seq));
      return;
    }

    const played = playedRef.current;
    const fresh = all.filter((a) => !played.has(a.seq)).sort((a, b) => a.seq - b.seq);
    if (!fresh.length) return;
    fresh.forEach((a) => played.add(a.seq));
    // 集合只留最近的序號，避免無限長大
    if (played.size > 40) {
      const keep = [...played].sort((x, y) => y - x).slice(0, 20);
      playedRef.current = new Set(keep);
    }

    const items = [];
    for (const la of fresh) {
    const seat = `[data-fly="seat-${la.by}"]`;

    if (la.kind === 'take') {
      la.gems.forEach((g) => items.push({ from: `[data-fly="bank-${g}"]`, to: seat, w: 30, h: 30, node: <Gem idx={g} size={30} /> }));
    } else if (la.kind === 'discard') {
      // 放回：方向相反
      const g = la.gem;
      items.push({
        from: seat,
        to: g === 'gold' ? '[data-fly="bank-gold"]' : `[data-fly="bank-${g}"]`,
        w: 30,
        h: 30,
        node: <Gem idx={g} size={30} />,
      });
    } else if (la.kind === 'buy' || la.kind === 'reserve') {
      const from =
        la.from === 'deck'
          ? `[data-fly="deck-${la.lv}"]`
          : la.from === 'reserve'
            ? [`[data-fly="res-${la.by}-${la.resIdx}"]`, seat]
            : `[data-fly="slot-${la.lv}-${la.slot}"]`;
      items.push({
        from,
        to: seat,
        w: 66,
        h: 92,
        node: la.card ? (
          <div className="w-full h-full">
            <DevCard card={la.card} compact disabled />
          </div>
        ) : (
          <CardBack lv={la.lv} />
        ),
      });
      if (la.kind === 'reserve' && la.gotGold) {
        items.push({ from: '[data-fly="bank-gold"]', to: seat, w: 30, h: 30, node: <Gem idx="gold" size={30} /> });
      }
    } else if (la.kind === 'noble') {
      // 貴族值得一個大場面：全畫面登場，結束後才送進該玩家區域
      setNobleFx({
        id: la.seq,
        img: la.img,
        idx: la.idx,
        by: la.by,
        who: la.by === view.role ? '為你效力' : '投向對手',
      });
    }
    }

    if (items.length) launch(items);
  }, [view, launch]);

  // 進入新的決定順位階段就重置
  useEffect(() => {
    if (view?.phase === 'coin') setCoinDone(false);
  }, [view?.phase]);

  // 揭曉後停留一下讓所有人看清楚，再進入棋盤
  const revealKey = view?.coin?.first || (view?.draw ? view.draw.order.map((o) => o.seat).join() : null);
  useEffect(() => {
    if (!revealKey || coinDone) return;
    const t = setTimeout(() => setCoinDone(true), view?.playerCount === 3 ? 3200 : 2800);
    return () => clearTimeout(t);
  }, [revealKey, coinDone, view?.playerCount]);

  function enter(code, token, v) {
    saveSession(code, token);
    setSession({ code, token });
    setView(v);
    setLobbyErr('');
  }

  function leave() {
    playedRef.current = null;
    setCoinDone(false);
    clearSession();
    setSession(null);
    setView(null);
    setSel([]);
  }

  async function act(action, payload) {
    if (busy) return;
    setBusy(true);
    setMsg('');
    try {
      const d = await api('/api/room/action', { ...session, action, payload });
      setView(d.view);
      setSel([]);
      setModal(null);
    } catch (e) {
      setMsg(e.message);
      if (e.view) setView(e.view);
    } finally {
      setBusy(false);
    }
  }

  if (!session || !view) return <Lobby onEnter={enter} initialError={lobbyErr} />;

  const v = view;
  const meName = v.myName;
  const labels = Object.fromEntries([[v.role, v.myName], ...v.others.map((o) => [o.seat, o.name])]);

  /* 等待對手 */
  if (!v.allJoined) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6 bg-gradient-to-b from-[#1a1430] to-[#0b0912] px-6 text-center">
        <div className="text-field-chalk/50 text-sm tracking-widest">
          {v.playerCount === 3 ? '把房號給另外兩位' : '把房號給對手'}
        </div>
        <div className="font-mono text-6xl tracking-[0.3em] pl-[0.3em]" style={{ color: '#f5cf6a' }}>
          {v.code}
        </div>
        <div className="text-field-chalk/35 text-xs">
          已入座 {v.joinedCount}/{v.playerCount}　·　等待其他玩家…
        </div>
        <button onClick={leave} className="text-field-chalk/40 text-xs underline underline-offset-4 hover:text-field-chalk/70">
          取消並回大廳
        </button>
        <Chat code={session.code} token={session.token} chat={v.chat} role={v.chatRole} labels={labels} onView={setView} />
      </div>
    );
  }

  /* 決定順位：2 人猜金幣、3 人抽籤，揭曉後停留數秒再進棋盤 */
  if (v.phase === 'coin' || (v.coin?.first && !coinDone)) {
    return (
      <>
        <CoinToss v={v} busy={busy} onPick={(side) => act('sp_coin', { side })} />
        <Chat code={session.code} token={session.token} chat={v.chat} role={v.chatRole} labels={labels} onView={setView} />
      </>
    );
  }
  if (v.playerCount === 3 && v.draw && !coinDone) {
    return (
      <>
        <Lottery v={v} />
        <Chat code={session.code} token={session.token} chat={v.chat} role={v.chatRole} labels={labels} onView={setView} />
      </>
    );
  }

  const myTurn = v.myTurn;
  const discardMode = v.pendingDiscard > 0;
  const nobleMode = v.nobleChoices?.length > 0;

  // 拿寶石的選取合法性（與伺服器同一套判準，僅用於介面提示）
  function takeStatus() {
    if (!sel.length) return { ok: false, text: '選 3 個不同顏色，或同色點 2 次' };
    const cnt = [0, 0, 0, 0, 0];
    sel.forEach((i) => cnt[i]++);
    const two = cnt.findIndex((n) => n === 2);
    if (two > -1) {
      if (sel.length !== 2) return { ok: false, text: '拿同色 2 個時不能混其他顏色' };
      if (v.bank[two] < 4) return { ok: false, text: `${GEM_NAME[two]}不足 4 枚，不能一次拿 2 個` };
      return { ok: true, text: `拿 2 個${GEM_NAME[two]}` };
    }
    const avail = v.bank.filter((n) => n > 0).length;
    if (sel.length < Math.min(3, avail)) return { ok: false, text: `再選 ${Math.min(3, avail) - sel.length} 個` };
    return { ok: true, text: `拿 ${sel.length} 個不同顏色` };
  }
  const ts = takeStatus();

  function toggleGem(i) {
    if (!myTurn || discardMode || nobleMode || busy) return;
    const have = sel.filter((x) => x === i).length;
    if (have >= 2) setSel(sel.filter((x) => x !== i));
    else if (sel.length < 3 && v.bank[i] > have) setSel([...sel, i]);
  }

  const statusLine = v.phase === 'over'
    ? v.winner === 'draw'
      ? '平手'
      : `${v.winner === v.role ? '你獲勝了' : '對手獲勝'}`
    : discardMode
      ? `超過 10 枚——請點自己的寶石放回 ${v.pendingDiscard} 枚`
      : nobleMode
        ? '有多位貴族願意造訪，選一位'
        : myTurn
          ? '輪到你行動'
          : `等待 ${v.turnName} 行動…`;

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#171226] via-[#120f1e] to-[#0a0810] pb-24">
      {/* 左側常駐面板：捲動時也看得到貴族進度與自己的寶石 */}
      <aside className="hidden lg:flex fixed left-2 top-14 z-40 w-[168px] flex-col gap-2.5">
        <div className="rounded-xl border border-[#d6b153]/35 bg-[#0d0a18]/92 backdrop-blur p-2.5">
          <div className="text-[9px] tracking-[0.25em] text-field-chalk/35 mb-2">貴族進度</div>
          <div className="space-y-2">
            {v.nobles.map((n, i) => (
              <MiniNoble key={i} noble={n} myBonus={v.me?.bonus} />
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-field-chalk/18 bg-[#0d0a18]/92 backdrop-blur p-2.5">
          <div className="text-[9px] tracking-[0.25em] text-field-chalk/35 mb-2">你的寶石</div>
          <div className="space-y-1.5">
            {v.me.tok.map((n, i) => (
              <div key={i} className={`flex items-center gap-2 ${n ? '' : 'opacity-30'}`}>
                <Gem idx={i} size={20} />
                <span className="font-mono text-[11px] text-field-chalk/80 w-4">{n}</span>
                <span className="font-mono text-[9px] text-[#f5cf6a99]">折{v.me.bonus[i]}</span>
              </div>
            ))}
            <div className={`flex items-center gap-2 pt-1.5 border-t border-field-chalk/10 ${v.me.gold ? '' : 'opacity-30'}`}>
              <Gem idx="gold" size={20} />
              <span className="font-mono text-[11px] text-field-chalk/80 w-4">{v.me.gold}</span>
            </div>
          </div>
          <div className="mt-2 pt-2 border-t border-field-chalk/10 flex items-baseline justify-between">
            <span className="text-[9px] text-field-chalk/35">持有</span>
            <span
              className={`font-mono text-[11px] ${
                v.me.tok.reduce((a, b) => a + b, 0) + v.me.gold >= 10 ? 'text-[#ff7a7a]' : 'text-field-chalk/60'
              }`}
            >
              {v.me.tok.reduce((a, b) => a + b, 0) + v.me.gold}/10
            </span>
          </div>
        </div>
      </aside>

      <div className="max-w-5xl mx-auto px-3 sm:px-5 pt-4 lg:pl-[184px]">
        {/* 頂列 */}
        <div className="flex items-center justify-between gap-3 pb-3 mb-4 border-b border-field-chalk/12">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-lg font-bold" style={{ color: '#f5cf6a' }}>
              璀璨寶石
            </span>
            <span className="font-mono text-xs text-field-chalk/35">
              房號 {v.code}　·　{v.playerCount} 人局
            </span>
          </div>
          <div className={`text-xs tracking-wider ${myTurn || discardMode || nobleMode ? 'text-field-floodlight' : 'text-field-chalk/45'}`}>
            {statusLine}
          </div>
        </div>

        {/* 貴族 */}
        <div className="mb-4">
          <div className="text-[10px] tracking-[0.25em] text-field-chalk/35 mb-1.5">貴族　·　各 3 分　·　達成即自動來訪</div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {v.nobles.map((n, i) => (
              <NobleCard
                key={i}
                noble={n}
                flyId={`noble-${i}`}
                myBonus={v.me?.bonus}
                others={v.others}
                selectable={nobleMode && v.nobleChoices.includes(i)}
                onClick={() => act('sp_noble', { idx: i })}
              />
            ))}
          </div>
        </div>

        <div className="grid lg:grid-cols-[1fr_230px] gap-4 items-start">
          {/* 市場：三排各自框起來 */}
          <div className="space-y-3">
            {[3, 2, 1].map((lv) => {
              const row = v.board[lv - 1];
              const afford = v.affordable?.board?.[lv - 1] || [];
              const oppAfford = v.affordable?.oppBoard?.[lv - 1] || [];
              return (
                <div
                  key={lv}
                  className="rounded-xl border p-2.5 bg-black/25"
                  style={{ borderColor: lv === 3 ? '#f5cf6a55' : lv === 2 ? '#c9c4b840' : '#8a91a833' }}
                >
                  <div className="flex items-center justify-between mb-2 px-0.5">
                    <div className="flex items-center gap-2">
                      <Stars lv={lv} size="text-sm" />
                      <span className="text-[10px] tracking-[0.2em] text-field-chalk/40">
                        {lv === 1 ? '基礎礦脈' : lv === 2 ? '運輸車隊' : '大師工坊'}
                      </span>
                    </div>
                    <span className="font-mono text-[10px] text-field-chalk/35">牌堆剩 {v.deckCounts[lv - 1]}</span>
                  </div>

                  <div className="flex gap-2">
                    {/* 牌堆：可暗抽保留 */}
                    <button
                      data-fly={`deck-${lv}`}
                      disabled={!myTurn || discardMode || nobleMode || busy || !v.deckCounts[lv - 1] || v.me.res.length >= 3}
                      onClick={() => act('sp_reserve', { from: 'deck', lv })}
                      title="暗抽這疊最上面一張來保留"
                      className="w-9 shrink-0 rounded-lg border border-field-chalk/20 bg-[repeating-linear-gradient(135deg,#1c1730_0_4px,#241d3c_4px_8px)] flex flex-col items-center justify-center gap-1 disabled:opacity-30 enabled:hover:border-field-floodlight transition-colors"
                    >
                      <span className="[writing-mode:vertical-rl] text-[9px] tracking-widest text-field-chalk/45">暗抽</span>
                    </button>

                    <div className="grid grid-cols-4 gap-2 flex-1">
                      {row.map((c, j) => (
                        <DevCard
                          key={c ? c.id : `e${j}`}
                          card={c}
                          flyId={`slot-${lv}-${j}`}
                          affordable={afford[j]}
                          oppAfford={oppAfford[j]}
                          disabled={!myTurn || discardMode || nobleMode || busy || !c}
                          onClick={() => setModal({ kind: 'card', card: c, from: 'board', lv, slot: j, afford: afford[j] })}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 寶石庫 */}
          <div className="rounded-xl border border-field-chalk/15 bg-black/30 p-3">
            <div className="text-[10px] tracking-[0.25em] text-field-chalk/35 mb-2.5">寶石庫</div>
            <div className="space-y-1.5">
              {v.bank.map((n, i) => {
                const picked = sel.filter((x) => x === i).length;
                return (
                  <button
                    key={i}
                    data-fly={`bank-${i}`}
                    onClick={() => toggleGem(i)}
                    disabled={!myTurn || discardMode || nobleMode || busy || n <= 0}
                    className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg border transition-colors disabled:opacity-40
                      ${picked ? 'border-field-floodlight bg-field-floodlight/10' : 'border-transparent enabled:hover:border-field-chalk/25'}`}
                  >
                    <Gem idx={i} size={26} />
                    <span className="text-[11px] text-field-chalk/55 flex-1 text-left">{GEM_NAME[i]}</span>
                    <span className="font-mono text-sm text-field-chalk/85">{n}</span>
                    {picked > 0 && <span className="text-[10px] text-field-floodlight">＋{picked}</span>}
                  </button>
                );
              })}
              <div data-fly="bank-gold" className="flex items-center gap-2.5 px-2 py-1.5 opacity-70">
                <Gem idx="gold" size={26} />
                <span className="text-[11px] text-field-chalk/45 flex-1 text-left">黃金（保留時取得）</span>
                <span className="font-mono text-sm text-field-chalk/70">{v.gold}</span>
              </div>
            </div>

            <div className="mt-3 flex flex-col gap-2">
              <button
                onClick={() => act('sp_take', { gems: sel })}
                disabled={!myTurn || !ts.ok || busy || discardMode || nobleMode}
                className="w-full py-2 rounded-lg border border-field-floodlight/60 text-field-floodlight text-xs tracking-widest disabled:opacity-25 enabled:hover:bg-field-floodlight/15 transition-colors"
              >
                拿取寶石
              </button>
              {sel.length > 0 && (
                <button onClick={() => setSel([])} className="w-full py-1.5 rounded-lg border border-field-chalk/20 text-field-chalk/60 text-[11px]">
                  取消選取
                </button>
              )}
            </div>
            <div className={`mt-2 text-[11px] leading-relaxed ${ts.ok ? 'text-field-chalk/50' : 'text-field-chalk/40'}`}>{ts.text}</div>
            {msg && <div className="mt-2 text-[11px] text-red-300/85">{msg}</div>}
          </div>
        </div>

        {/* 雙方 */}
        <div className={`grid gap-3 mt-5 ${v.playerCount === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
          <Seat
            p={v.me}
            res={v.me.res}
            name={meName}
            role={v.role}
            isMe
            active={myTurn || discardMode || nobleMode}
            winPoints={v.winPoints}
            discardMode={discardMode}
            onDiscard={(gem) => act('sp_discard', { gem })}
            onBuyRes={
              myTurn && !discardMode && !nobleMode
                ? { can: v.affordable?.res || [], open: (idx) => setModal({ kind: 'card', card: v.me.res[idx], from: 'reserve', idx, afford: v.affordable?.res?.[idx] }) }
                : null
            }
          />
          {v.others.map((o) => (
            <Seat
              key={o.seat}
              p={o}
              name={o.name}
              role={o.seat}
              active={v.turn === o.seat && v.phase !== 'over'}
              winPoints={v.winPoints}
            />
          ))}
        </div>

        {/* 戰報 */}
        {v.log?.length > 0 && (
          <div className="mt-5 rounded-xl border border-field-chalk/12 bg-black/25 px-3 py-2 max-h-40 overflow-y-auto">
            {v.log.map((l, i) => (
              <div key={i} className={`text-[11px] leading-relaxed ${/🏆|👑|🏁/.test(l.text) ? 'text-field-floodlight/90' : 'text-field-chalk/45'}`}>
                {l.text}
              </div>
            ))}
          </div>
        )}

        <div className="mt-6 flex items-center gap-4">
          <button onClick={leave} className="text-field-chalk/30 text-[11px] underline underline-offset-4 hover:text-field-chalk/60">
            離開房間
          </button>
          {v.phase !== 'over' && (
            <button
              onClick={() => setConfirmSurrender(true)}
              className="px-3 py-1.5 rounded-lg border border-red-400/35 text-red-300/70 text-[11px] tracking-wider hover:border-red-400/70 hover:text-red-300 transition-colors"
            >
              🏳️ 投降
            </button>
          )}
        </div>
      </div>

      {/* 卡片動作 */}
      {modal?.kind === 'card' && modal.card && (
        <div className="fixed inset-0 z-[75] bg-black/80 flex items-center justify-center p-5" onClick={() => setModal(null)}>
          <div className="w-full max-w-sm max-h-[90vh] overflow-y-auto rounded-2xl border border-field-chalk/20 bg-[#141024] p-5 text-center" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-center mb-3">
              <div className="w-28">
                <DevCard card={modal.card} affordable={modal.afford} disabled />
              </div>
            </div>
            <div className="text-xs text-field-chalk/55 mb-1">
              {GEM_NAME[modal.card.col]}獎勵
              {modal.card.pv ? `　·　${modal.card.pv} 分` : ''}
            </div>
            <div className="text-[11px] text-field-chalk/40 mb-3">
              花費　{modal.card.cost.map((n, i) => (n ? `${n} ${GEM_NAME[i]}` : '')).filter(Boolean).join('、')}
            </div>
            <div className="mb-4">
              <PaymentPreview me={v.me} card={modal.card} />
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={() =>
                  act('sp_buy', modal.from === 'board' ? { from: 'board', lv: modal.lv, slot: modal.slot } : { from: 'reserve', idx: modal.idx })
                }
                disabled={!modal.afford || busy}
                className="py-2.5 rounded-xl border border-field-floodlight/60 text-field-floodlight text-sm tracking-widest disabled:opacity-25 enabled:hover:bg-field-floodlight/15"
              >
                購買
              </button>
              {modal.from === 'board' && (
                <button
                  onClick={() => act('sp_reserve', { from: 'board', lv: modal.lv, slot: modal.slot })}
                  disabled={busy || v.me.res.length >= 3}
                  className="py-2.5 rounded-xl border border-field-chalk/25 text-field-chalk/80 text-sm tracking-widest disabled:opacity-25"
                >
                  保留{v.gold > 0 ? '（＋1 黃金）' : ''}
                </button>
              )}
              <button onClick={() => setModal(null)} className="py-2 text-field-chalk/40 text-xs">
                返回
              </button>
            </div>
            {!modal.afford && <div className="mt-2 text-[11px] text-field-chalk/40">目前寶石不足以購買</div>}
          </div>
        </div>
      )}

      {/* 投降確認 */}
      {confirmSurrender && v.phase !== 'over' && (
        <div className="fixed inset-0 z-[78] bg-black/80 flex items-center justify-center p-5" onClick={() => setConfirmSurrender(false)}>
          <div className="w-full max-w-xs rounded-2xl border border-red-400/30 bg-[#180f14] p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <div className="text-4xl mb-3">🏳️</div>
            <div className="font-display text-xl font-bold text-field-chalk/90 mb-2">確定要投降嗎？</div>
            <div className="text-[11px] text-field-chalk/45 leading-relaxed mb-5">
              這局立刻結束，對手直接獲勝。
              <br />
              可以按「再來一局」重新開始。
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => {
                  setConfirmSurrender(false);
                  act('sp_surrender');
                }}
                disabled={busy}
                className="py-2.5 rounded-xl border border-red-400/60 bg-red-500/10 text-red-300 text-sm tracking-widest hover:bg-red-500/20 disabled:opacity-40"
              >
                投降認輸
              </button>
              <button onClick={() => setConfirmSurrender(false)} className="py-2 text-field-chalk/45 text-xs">
                再撐一下
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 終局結算 */}
      {v.phase === 'over' && (
        <div className="fixed inset-0 z-[70] bg-black/88 flex items-center justify-center p-5 overflow-y-auto">
          <div className="w-full max-w-sm my-auto rounded-2xl border border-field-chalk/20 bg-[#141024] p-5 text-center">
            {(() => {
              const surrendered = v.endReason === 'surrender';
              const title = surrendered
                ? v.iSurrendered
                  ? '你投降了'
                  : `${v.winnerName || ''} 獲勝`
                : v.winner === 'draw'
                  ? '平手'
                  : v.winner === v.role
                    ? '你獲勝了'
                    : `${v.winnerName} 獲勝`;
              const sub = surrendered
                ? v.iSurrendered
                  ? '棄子認輸，下一局再算帳'
                  : '有人舉了白旗'
                : v.winner === 'draw'
                  ? '分數與卡數完全相同'
                  : '十五分達成';
              return (
                <>
                  <img
                    src={surrendered ? '/splendor/end/surrender.jpg' : '/splendor/end/victory.jpg'}
                    alt=""
                    className="mx-auto rounded-xl border border-field-chalk/15 max-h-[38vh] w-auto object-contain mb-4"
                  />
                  <div
                    className="font-display text-3xl font-black mb-1"
                    style={{ color: surrendered ? '#ff8a8a' : '#f5cf6a' }}
                  >
                    {title}
                  </div>
                  <div className="text-[11px] text-field-chalk/40 mb-4">{sub}</div>
                </>
              );
            })()}

            <div className="space-y-1.5 mb-4">
              {(v.standings || []).map((r, i) => {
                const win = v.winner !== 'draw' && r.seat === v.winner;
                const isMe = r.seat === v.role;
                return (
                  <div
                    key={r.seat}
                    className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 ${
                      win ? 'border-[#f5cf6a]/60 bg-[#f5cf6a]/[0.08]' : 'border-field-chalk/12 bg-black/25'
                    }`}
                  >
                    <span className="font-display font-black text-lg w-5 text-left" style={{ color: win ? '#f5cf6a' : '#e9e6df55' }}>
                      {r.surrendered ? '—' : i + 1}
                    </span>
                    <span className="flex-1 text-left text-xs text-field-chalk/80">
                      {r.name}
                      {isMe && <span className="text-field-chalk/35 ml-1">（你）</span>}
                      {r.surrendered && <span className="text-red-300/70 ml-1">投降</span>}
                    </span>
                    <span className="text-[10px] text-field-chalk/35">{r.cards} 卡</span>
                    <span className="font-display font-black text-xl" style={{ color: win ? '#f5cf6a' : '#e9e6df99' }}>
                      {r.pts}
                    </span>
                  </div>
                );
              })}
            </div>

            {v.endReason !== 'surrender' && (
              <div className="text-[10px] text-field-chalk/25 mb-4">同分時買卡較少者勝</div>
            )}

            <button
              onClick={() => act('sp_rematch')}
              disabled={busy}
              className="w-full py-2.5 rounded-xl border border-field-floodlight/60 text-field-floodlight text-sm tracking-widest hover:bg-field-floodlight/15 disabled:opacity-40"
            >
              {v.rematch?.[v.role] ? '等待對手同意…' : '再來一局'}
            </button>
            <button onClick={leave} className="mt-3 text-field-chalk/40 text-xs underline underline-offset-4">
              離開房間
            </button>
          </div>
        </div>
      )}

      {nobleFx && (
        <NobleEntrance
          fx={nobleFx}
          onDone={() => {
            launch([
              {
                from: `[data-fly="noble-${nobleFx.idx}"]`,
                to: `[data-fly="seat-${nobleFx.by}"]`,
                w: 76,
                h: 76,
                node: (
                  <img
                    src={`/splendor/noble/${nobleFx.img}.jpg`}
                    alt=""
                    className="w-full h-full object-cover rounded-lg border-2"
                    style={{ borderColor: '#f5cf6a' }}
                  />
                ),
              },
            ]);
            setNobleFx(null);
          }}
        />
      )}
      <Chat code={session.code} token={session.token} chat={v.chat} role={v.chatRole} labels={labels} onView={setView} />
      <FlightLayer flights={flights} />
    </div>
  );
}
