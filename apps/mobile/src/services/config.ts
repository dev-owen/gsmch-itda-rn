export const APP_SCHEME = 'itda';
// The app reads the Itda database. Only the server synchronizes the bulletin.
export const API_ORIGIN = (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8787').replace(/\/$/, '');

if (!/^https?:\/\//.test(API_ORIGIN)) throw new Error('API 주소는 http 또는 https여야 합니다.');
