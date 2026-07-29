/* ------------------------------------------------------------------
 * 遊戲類型註冊表
 *
 * 每種連線遊戲在此登記自己的 create / join / role / view / actions，
 * 讓 create/join/state/action 四支路由用同一套分派邏輯處理，
 * 不必為每款遊戲堆疊巢狀判斷。
 *
 * host seat：建房者的座位鍵（回傳 token 用）。
 * ------------------------------------------------------------------ */

import { createSplendorRoom, joinSplendorRoom, splendorRoleOf, splendorViewFor,
  actSpTake, actSpBuy, actSpReserve, actSpDiscard, actSpNoble, actSpCoin, actSpSurrender, actSpRematch } from './splendorLogic';
import { createMissionRoom, joinMissionRoom, missionRoleOf, missionViewFor,
  actMissionPickRole, actMissionClue, actMissionGuess, actMissionStop, actMissionSticker } from './missionLogic';
import { createPokerRoom, joinPokerRoom, pokerRoleOf, pokerViewFor,
  actPokerBet, actPokerDraw, actPokerNextGame, actPokerRematch, actPokerSticker, actPokerNextRound } from './pokerGame';
import { createEcardRoom, joinEcardRoom, ecardRoleOf, ecardViewFor,
  actEcardChooseRole, actEcardSetStake, actEcardPlay, actEcardReorder, actEcardSticker, actEcardNextRound, actEcardNextGame, actEcardRematch } from './ecardLogic';

export const GAME_TYPES = {
  splendor: {
    type: 'splendor',
    label: '璀璨寶石',
    hostSeat: 's0',
    create: (opts) => createSplendorRoom(opts),
    join: (room) => joinSplendorRoom(room),
    roleOf: splendorRoleOf,
    viewFor: splendorViewFor,
    actions: {
      sp_take: actSpTake,
      sp_buy: actSpBuy,
      sp_reserve: actSpReserve,
      sp_discard: actSpDiscard,
      sp_noble: actSpNoble,
      sp_coin: actSpCoin,
      sp_surrender: actSpSurrender,
      sp_rematch: (room, role) => actSpRematch(room, role),
    },
  },

  mission: {
    type: 'mission',
    label: '密語連線',
    hostSeat: 'a',
    create: (opts) => createMissionRoom(opts),
    join: (room) => joinMissionRoom(room),
    roleOf: missionRoleOf,
    viewFor: missionViewFor,
    actions: {
      ms_pick_role: actMissionPickRole,
      ms_clue: actMissionClue,
      ms_guess: actMissionGuess,
      ms_stop: (room, role) => actMissionStop(room, role),
      ms_sticker: actMissionSticker,
    },
  },

  poker: {
    type: 'poker',
    label: '17 撲克',
    hostSeat: 'a',
    create: (opts) => createPokerRoom(opts),
    join: (room) => joinPokerRoom(room),
    roleOf: pokerRoleOf,
    viewFor: pokerViewFor,
    actions: {
      pk_bet: actPokerBet,
      pk_draw: actPokerDraw,
      pk_next: (room, role) => actPokerNextGame(room, role),
      pk_rematch: (room, role) => actPokerRematch(room, role),
      pk_sticker: actPokerSticker,
      pk_next_round: (room, role) => actPokerNextRound(room, role),
    },
  },

  ecard: {
    type: 'ecard',
    label: 'E 卡',
    hostSeat: 'a',
    create: (opts) => createEcardRoom(opts),
    join: (room) => joinEcardRoom(room),
    roleOf: ecardRoleOf,
    viewFor: ecardViewFor,
    actions: {
      ec_role: actEcardChooseRole,
      ec_stake: actEcardSetStake,
      ec_play: actEcardPlay,
      ec_reorder: actEcardReorder,
      ec_sticker: actEcardSticker,
      ec_next_round: (room, role) => actEcardNextRound(room, role),
      ec_next: (room, role) => actEcardNextGame(room, role),
      ec_rematch: (room, role) => actEcardRematch(room, role),
    },
  },
};

// 由 mode 字串取得該遊戲定義
export function gameByMode(mode) {
  return GAME_TYPES[mode] || null;
}

// 由既有 room 物件的 type 取得定義
export function gameByRoom(room) {
  return room && room.type ? GAME_TYPES[room.type] || null : null;
}

// 這些 type 走註冊表分派；其餘（棒球 baseball）走原本的專用邏輯
export function isRegistered(mode) {
  return !!GAME_TYPES[mode];
}
