const CFG_KEY = 'autobot_config';

interface AutoBotConfig {
  username: string;
  age: number;
  paypalEmail: string;
  photoUrl: string;
  mockPrice: string;
}

function loadCfg(): Partial<AutoBotConfig> {
  try { return JSON.parse(localStorage.getItem(CFG_KEY) || '{}'); } catch { return {}; }
}

const saved = loadCfg();

export const CFG: AutoBotConfig = {
  username: saved.username ?? '',
  age: saved.age ?? 22,
  paypalEmail: saved.paypalEmail ?? 'autobot_test@gmail.com',
  photoUrl: saved.photoUrl ?? 'https://file.archat.us/cai/user_custom_avatar/2100048298/e41dd7af-75e5-43c4-a88f-d3521824879e.jpg',
  mockPrice: saved.mockPrice ?? '10',
};

export function saveCfg() {
  localStorage.setItem(CFG_KEY, JSON.stringify(CFG));
}

export function isInApp(): boolean {
  return !!((window as any).pwaBridge && (window as any).pwaBridge.inited);
}

interface AuthState {
  userState?: string;
  token?: string;
  userInfo?: { userId?: number; username?: string };
  cash?: number;
}

export function getAuth(): AuthState | null {
  try { return JSON.parse(localStorage.getItem('auth-storage') || 'null')?.state || null; } catch { return null; }
}

export function getToken(): string {
  return localStorage.getItem('haven_token') || '';
}

export function getUserId(): number | null {
  return getAuth()?.userInfo?.userId || null;
}
