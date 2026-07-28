'use client';

/* ------------------------------------------------------------------
 * BO 系列賽共用元件
 *  ‧ SeriesBar：顯示系列賽比分（先 N 勝）
 *  ‧ MatchPointMeme：生死局（BO3 1:1、BO5 2:2）跳出派大星梗圖
 * ------------------------------------------------------------------ */

export default function SeriesBar({ series, labels = { a: '玩家 A', b: '玩家 B' }, me }) {
  if (!series || series.mode === 'BO1') {
    // BO1 不需要系列比分條，但仍標示賽制
    return (
      <div className="text-center text-[10px] tracking-[0.3em] text-field-chalk/30">單場定勝負</div>
    );
  }
  const opp = me === 'a' ? 'b' : 'a';
  const dots = (n) =>
    Array.from({ length: series.need }).map((_, i) => (
      <span
        key={i}
        className="inline-block w-2.5 h-2.5 rounded-full mx-0.5"
        style={{ background: i < n ? '#f5cf6a' : 'rgba(242,234,217,0.18)' }}
      />
    ));

  return (
    <div className="flex items-center justify-center gap-4 py-2 rounded-xl border border-field-chalk/12 bg-black/25">
      <div className="text-right">
        <div className="text-[10px] text-field-chalk/45">{labels[me]}（你）</div>
        <div className="mt-0.5">{dots(series.wins[me])}</div>
      </div>
      <div className="font-display font-black text-lg text-field-floodlight">
        {series.wins[me]}<span className="text-field-chalk/30 mx-1">:</span>{series.wins[opp]}
      </div>
      <div className="text-left">
        <div className="text-[10px] text-field-chalk/45">{labels[opp]}</div>
        <div className="mt-0.5">{dots(series.wins[opp])}</div>
      </div>
      <div className="text-[10px] text-field-chalk/30 border-l border-field-chalk/15 pl-3">{series.mode}<br />先 {series.need} 勝</div>
    </div>
  );
}

/* 生死局梗圖：派大星「你別緊張好不好」，短暫全螢幕強調 */
export function MatchPointMeme() {
  return (
    <div className="fixed inset-0 z-[65] pointer-events-none flex items-center justify-center" style={{ animation: 'memePulse 2.6s ease-out both' }}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative text-center" style={{ animation: 'memePop 600ms cubic-bezier(.34,1.56,.64,1) both' }}>
        <img src="/meme/matchpoint.png" alt="生死局" className="max-h-[46vh] w-auto rounded-2xl border-2 border-field-floodlight/50 shadow-2xl" />
        <div className="mt-3 font-display text-2xl font-black text-field-floodlight drop-shadow-lg">生死局．決勝的一場</div>
      </div>
    </div>
  );
}
