// ======================= 状态 =======================
export let me = null, settings = null;
export const setMe = v => (me = v);
export const setSettings = v => (settings = v);
export const R = { users: [] };
export const ui = { collapsed: false, openGroups: new Set(), dashRange: 'year', oppView: 'board', list: null, tabs: {} };
export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
