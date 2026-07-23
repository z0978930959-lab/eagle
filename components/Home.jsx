'use client';

import { useState } from 'react';
import Game from './Game';
import Bingo from './Bingo';
import Splendor from './Splendor';

/* 遊戲入口：選擇棒球對戰、賓果對決或璀璨寶石。
 * 進入遊戲後左上角有「⌂」可回到選單（對局進度存在 sessionStorage，
 * 回選單再進來會接續原本的對局）。 */

const MODES = [
  {
    key: 'baseball',
    icon: '⚾',
    title: '棒球對戰',
    desc: '中職六隊逐球心理戰——配球 vs 即時揮棒',
  },
  {
    key: 'bingo',
    icon: '🎯',
    title: '賓果對決',
    desc: '5×5 盤面攻防——圈一號雙盤同動，先五連線者勝',
  },
  {
    key: 'splendor',
    icon: '💎',
    title: '璀璨寶石',
    desc: '收寶石、養折扣、搶貴族——雙人規則，先到 15 分致勝',
  },
];

export default function Home() {
  const [mode, setMode] = useState(null); // null | 'baseball' | 'bingo' | 'splendor'

  if (mode) {
    return (
      <div className="relative">
        {mode === 'baseball' ? <Game /> : mode === 'bingo' ? <Bingo /> : <Splendor />}
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
        <div className="font-display text-5xl font-black tracking-wide mb-2">資訊軟體開發</div>
        <div className="text-field-chalk/50 text-sm mb-10">選擇要進入的開發模組</div>

        <div className="flex flex-col gap-4">
          {MODES.map((m) => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              className="rounded-2xl border-2 border-field-chalk/20 bg-black/30 hover:border-field-floodlight hover:scale-[1.02] active:scale-[0.99] transition-all px-6 py-6 text-left"
            >
              <div className="text-3xl mb-1">{m.icon}</div>
              <div className="font-display text-xl font-bold">{m.title}</div>
              <div className="text-xs text-field-chalk/50 mt-1">{m.desc}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
