'use client';

import { useState } from 'react';
import Game from './Game';
import Bingo from './Bingo';

/* 遊戲入口：選擇棒球對戰或賓果對決。
 * 進入遊戲後左上角有「⌂」可回到選單（對局進度存在 sessionStorage，
 * 回選單再進來會接續原本的對局）。 */
export default function Home() {
  const [mode, setMode] = useState(null); // null | 'baseball' | 'bingo'

  if (mode) {
    return (
      <div className="relative">
        {mode === 'baseball' ? <Game /> : <Bingo />}
        <button
          onClick={() => setMode(null)}
          title="回遊戲選單（對局會保留）"
          className="fixed top-3 left-3 z-[70] w-9 h-9 rounded-full bg-black/50 border border-field-chalk/25 text-field-chalk/70 text-lg leading-none hover:border-field-floodlight hover:text-field-floodlight"
        >
          ⌂
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative overflow-hidden">
      <div className="absolute inset-0 grass-stripes floodlight-glow bg-gradient-to-b from-field-grass2 via-field-grass to-field-night" />
      <div className="relative z-10 max-w-md mx-auto px-6 py-20 text-center">
        <div className="font-display text-5xl font-black tracking-wide mb-2">中職對戰</div>
        <div className="text-field-chalk/50 text-sm mb-10">選一個遊戲，開房揪朋友對決</div>

        <div className="flex flex-col gap-4">
          <button
            onClick={() => setMode('baseball')}
            className="rounded-2xl border-2 border-field-chalk/20 bg-black/30 hover:border-field-floodlight hover:scale-[1.02] active:scale-[0.99] transition-all px-6 py-6 text-left"
          >
            <div className="text-3xl mb-1">⚾</div>
            <div className="font-display text-xl font-bold">棒球對戰</div>
            <div className="text-xs text-field-chalk/50 mt-1">中職六隊逐球心理戰——配球 vs 即時揮棒</div>
          </button>

          <button
            onClick={() => setMode('bingo')}
            className="rounded-2xl border-2 border-field-chalk/20 bg-black/30 hover:border-field-floodlight hover:scale-[1.02] active:scale-[0.99] transition-all px-6 py-6 text-left"
          >
            <div className="text-3xl mb-1">🎯</div>
            <div className="font-display text-xl font-bold">賓果對決</div>
            <div className="text-xs text-field-chalk/50 mt-1">5×5 盤面攻防——圈一號雙盤同動，先五連線者勝</div>
          </button>
        </div>
      </div>
    </div>
  );
}
