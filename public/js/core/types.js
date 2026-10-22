// @ts-check
/**
 * Shared data shapes. This file only holds JSDoc typedefs; it has no runtime code.
 *
 * @typedef {Object} Quest
 * @property {number} id
 * @property {string} name
 * @property {string} tiny      smallest possible first step, for when the user is frozen
 * @property {string} g         category
 * @property {number} xp
 * @property {string} due       "YYYY-MM-DD" or "" for anytime
 * @property {string} time      "HH:MM" or ""
 * @property {string} repeat    see REPEATS in dates.js
 * @property {number} remind    minutes before due; -1 = off
 * @property {boolean} done
 * @property {number|null} doneAt
 * @property {number} [count]   how many times a repeating quest was completed
 *
 * @typedef {{ rar: Rarity, n: string, d: string, at: number }} LootItem
 * @typedef {"common" | "rare" | "epic" | "legendary"} Rarity
 *
 * @typedef {Object} Mood
 * @property {number} at
 * @property {string} day
 * @property {number} v   1-10
 * @property {number} s   scale (always 10 since v3 migration)
 * @property {string} [note]
 * @property {string} [via]
 *
 * @typedef {Object} LogEvent
 * @property {"quest" | "mood" | "freeze" | "badge"} t
 * @property {number} at
 * @property {string} day
 * @property {number} [xp]
 * @property {number} [id]
 * @property {string} [name]
 * @property {string} [g]
 * @property {number} [v]
 * @property {number} [s]
 * @property {string} [note]
 * @property {string} [via]
 *
 * @typedef {{ name: string, xp: number, at: number }} PendingReward
 *   XP earned outside the app (via Claude); the app rolls loot for it on next open.
 *
 * @typedef {Object} State
 * @property {number} v
 * @property {Quest[]} quests
 * @property {number} xp
 * @property {LootItem[]} inv
 * @property {number} dry      completions since the last drop (pity timer)
 * @property {number} nextId
 * @property {string[]} days   days with any XP, for streaks
 * @property {string} theme
 * @property {LogEvent[]} log  newest first
 * @property {Mood[]} moods
 * @property {Record<string, number>} badges  badge id → earned at
 * @property {PendingReward[]} [rewards]
 * @property {number} [updatedAt]
 */
export {};
