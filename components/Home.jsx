'use client';

import { useState } from 'react';
import Game from './Game';
import Bingo from './Bingo';
import Splendor from './Splendor';
import Mission from './Mission';
import Poker from './Poker';
import Ecard from './Ecard';
import Tournament from './Tournament';

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
  {
    key: 'mission',
    icon: '🔗',
    title: '密語連線',
    desc: '雙人合作猜詞——輪流給提示，找齊關鍵人物、閃避炸彈客',
  },
  {
    key: 'poker',
    icon: '🃏',
    title: '17 張撲克',
    desc: 'JQKA＋鬼牌——下注、換牌、比牌型，六回合定勝負',
  },
  {
    key: 'ecard',
    icon: '👑',
    title: 'E 卡',
    desc: '皇帝奴隸市民三者相剋——心理博弈，賭一把翻盤',
  },
  {
    key: 'tournament',
    icon: '🏆',
    title: '綜合比賽',
    desc: '賓果＋E卡＋17撲克隨機三場——先贏兩場者奪冠',
  },
];

export default function Home() {
  const [mode, setMode] = useState(null); // null | 'baseball' | 'bingo' | 'splendor'

  if (mode) {
    const screen = {
      baseball: <Game />,
      bingo: <Bingo />,
      splendor: <Splendor />,
      mission: <Mission />,
      poker: <Poker />,
      ecard: <Ecard />,
      tournament: <Tournament />,
    }[mode];
    return (
      <div className="relative">
        {screen}
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
