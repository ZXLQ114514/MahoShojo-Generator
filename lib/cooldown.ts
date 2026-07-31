import { useState, useEffect, useCallback } from 'react';

const COOLDOWN_SYNC_EVENT = 'mahoshojo:cooldown-sync';

export type ProviderCooldownMode = 'system' | 'custom';

type CooldownSnapshot = {
  endTime: number | null;
  remainingTime: number;
};

type CooldownSyncDetail = {
  key: string;
  endTime: number | null;
};

type CooldownStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

type ProviderCooldownNoticeInput = {
  currentMode: ProviderCooldownMode;
  currentIsCooldown: boolean;
  otherRemainingTime: number;
};

type UseProviderModeCooldownOptions = {
  baseKey: string;
  currentMode: ProviderCooldownMode;
  systemDurationMs: number;
  customDurationMs: number;
  runtimeSettingKey?: 'system' | 'battle';
};

type PublicCooldownSettings = {
  systemSeconds: number;
  customSeconds: number;
  battleSeconds: number;
};

let publicCooldownSettingsPromise: Promise<PublicCooldownSettings | null> | null = null;

const loadPublicCooldownSettings = async (): Promise<PublicCooldownSettings | null> => {
  if (publicCooldownSettingsPromise) return publicCooldownSettingsPromise;
  publicCooldownSettingsPromise = fetch('/api/public-settings', { cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) return null;
      const payload = (await response.json()) as { publicAiCooldown?: Partial<PublicCooldownSettings> };
      const settings = payload.publicAiCooldown;
      if (!settings) return null;
      const readSeconds = (value: unknown, fallback: number): number => {
        const parsed = typeof value === 'number' ? value : Number(value);
        return Number.isFinite(parsed) && parsed >= 0 ? Math.min(86400, Math.trunc(parsed)) : fallback;
      };
      return {
        systemSeconds: readSeconds(settings.systemSeconds, 60),
        customSeconds: readSeconds(settings.customSeconds, 3),
        battleSeconds: readSeconds(settings.battleSeconds, 120),
      };
    })
    .catch(() => null)
    .finally(() => {
      publicCooldownSettingsPromise = null;
    });
  return publicCooldownSettingsPromise;
};

export const getOtherProviderCooldownMode = (mode: ProviderCooldownMode): ProviderCooldownMode =>
  mode === 'custom' ? 'system' : 'custom';

export const buildProviderCooldownStorageKey = (baseKey: string, mode: ProviderCooldownMode): string =>
  `${baseKey}:${mode}`;

const getProviderCooldownModeLabel = (mode: ProviderCooldownMode): string =>
  mode === 'custom' ? '自定义通道' : '默认通道';

const getCooldownStorage = (): CooldownStorage | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const storage = globalThis.localStorage;
    if (
      !storage
      || typeof storage.getItem !== 'function'
      || typeof storage.setItem !== 'function'
      || typeof storage.removeItem !== 'function'
    ) {
      return null;
    }

    return storage;
  } catch {
    return null;
  }
};

export const getProviderCooldownNoticeText = ({
  currentMode,
  currentIsCooldown,
  otherRemainingTime,
}: ProviderCooldownNoticeInput): string | null => {
  if (otherRemainingTime <= 0) return null;

  const currentLabel = getProviderCooldownModeLabel(currentMode);
  const otherLabel = getProviderCooldownModeLabel(getOtherProviderCooldownMode(currentMode));

  if (currentIsCooldown) {
    return `${otherLabel}也在冷却中 (${otherRemainingTime}s)。`;
  }

  return `${otherLabel}冷却中 (${otherRemainingTime}s)，当前${currentLabel}仍可使用。`;
};

const getLocalStorageItem = (key: string): number | null => {
  const storage = getCooldownStorage();
  if (!storage) {
    return null;
  }
  const item = storage.getItem(key);
  if (!item) return null;
  const parsed = Number.parseInt(item, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const setLocalStorageItem = (key: string, value: number | null) => {
  const storage = getCooldownStorage();
  if (!storage) {
    return;
  }
  if (value === null) {
    storage.removeItem(key);
    return;
  }
  storage.setItem(key, value.toString());
};

const emitCooldownSync = (key: string, endTime: number | null) => {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
    return;
  }

  try {
    const event = new CustomEvent<CooldownSyncDetail>(COOLDOWN_SYNC_EVENT, {
      detail: { key, endTime },
    });
    window.dispatchEvent(event);
  } catch {
    // 忽略极端环境下不支持 CustomEvent 的情况
  }
};

export const readCooldownSnapshot = (key: string): CooldownSnapshot => {
  const endTime = getLocalStorageItem(key);
  if (!endTime) {
    return { endTime: null, remainingTime: 0 };
  }

  const remaining = endTime - Date.now();
  if (remaining <= 0) {
    setLocalStorageItem(key, null);
    return { endTime: null, remainingTime: 0 };
  }

  return {
    endTime,
    remainingTime: Math.ceil(remaining / 1000),
  };
};

export const writeCooldownSnapshot = (key: string, endTime: number | null): CooldownSnapshot => {
  setLocalStorageItem(key, endTime);
  emitCooldownSync(key, endTime);
  return readCooldownSnapshot(key);
};

export const subscribeCooldownKey = (key: string, onChange: () => void): (() => void) => {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return () => {};
  }

  const handleSync = (event: Event) => {
    const detail = (event as CustomEvent<CooldownSyncDetail>).detail;
    if (detail?.key !== key) return;
    onChange();
  };

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== key) return;
    onChange();
  };

  window.addEventListener(COOLDOWN_SYNC_EVENT, handleSync as EventListener);
  window.addEventListener('storage', handleStorage);

  return () => {
    window.removeEventListener(COOLDOWN_SYNC_EVENT, handleSync as EventListener);
    window.removeEventListener('storage', handleStorage);
  };
};

export const useCooldown = (key: string, duration: number) => {
  const isDevelopment = process.env.NODE_ENV === 'development';

  const [cooldownEndTime, setCooldownEndTime] = useState<number | null>(() =>
    isDevelopment ? null : readCooldownSnapshot(key).endTime
  );
  const [remainingTime, setRemainingTime] = useState<number>(() =>
    isDevelopment ? 0 : readCooldownSnapshot(key).remainingTime
  );

  const syncFromStorage = useCallback(() => {
    if (isDevelopment) {
      setCooldownEndTime(null);
      setRemainingTime(0);
      return;
    }

    const snapshot = readCooldownSnapshot(key);
    setCooldownEndTime(snapshot.endTime);
    setRemainingTime(snapshot.remainingTime);
  }, [isDevelopment, key]);

  useEffect(() => {
    syncFromStorage();
  }, [syncFromStorage]);

  useEffect(() => {
    if (isDevelopment) return;
    return subscribeCooldownKey(key, syncFromStorage);
  }, [isDevelopment, key, syncFromStorage]);

  useEffect(() => {
    if (isDevelopment || !cooldownEndTime) return;

    const calculateRemainingTime = () => {
      const remaining = cooldownEndTime - Date.now();
      if (remaining <= 0) {
        writeCooldownSnapshot(key, null);
        setCooldownEndTime(null);
        setRemainingTime(0);
      } else {
        setRemainingTime(Math.ceil(remaining / 1000));
      }
    };

    calculateRemainingTime();
    const interval = setInterval(calculateRemainingTime, 1000);

    return () => clearInterval(interval);
  }, [cooldownEndTime, isDevelopment, key]);

  const startCooldown = useCallback((overrideDuration?: number) => {
    if (isDevelopment) return;

    const rawDuration = typeof overrideDuration === 'number' ? overrideDuration : duration;
    const effectiveDuration = Math.max(0, Math.floor(rawDuration));
    const endTime = effectiveDuration > 0 ? Date.now() + effectiveDuration : null;
    const snapshot = writeCooldownSnapshot(key, endTime);
    setCooldownEndTime(snapshot.endTime);
    setRemainingTime(snapshot.remainingTime);
  }, [duration, isDevelopment, key]);

  const isCooldown = !isDevelopment && remainingTime > 0;

  return { isCooldown, startCooldown, remainingTime };
};

export const useProviderModeCooldown = ({
  baseKey,
  currentMode,
  systemDurationMs,
  customDurationMs,
  runtimeSettingKey = 'system',
}: UseProviderModeCooldownOptions) => {
  const [runtimeDurations, setRuntimeDurations] = useState({ systemDurationMs, customDurationMs });

  useEffect(() => {
    let active = true;
    void loadPublicCooldownSettings().then((settings) => {
      if (!active || !settings) return;
      setRuntimeDurations({
        systemDurationMs: (runtimeSettingKey === 'battle' ? settings.battleSeconds : settings.systemSeconds) * 1000,
        customDurationMs: settings.customSeconds * 1000,
      });
    });
    return () => { active = false; };
  }, [runtimeSettingKey]);

  const systemCooldown = useCooldown(
    buildProviderCooldownStorageKey(baseKey, 'system'),
    runtimeDurations.systemDurationMs,
  );
  const customCooldown = useCooldown(
    buildProviderCooldownStorageKey(baseKey, 'custom'),
    runtimeDurations.customDurationMs,
  );

  const currentCooldown = currentMode === 'custom' ? customCooldown : systemCooldown;
  const otherCooldown = currentMode === 'custom' ? systemCooldown : customCooldown;

  return {
    ...currentCooldown,
    currentDurationMs: currentMode === 'custom' ? runtimeDurations.customDurationMs : runtimeDurations.systemDurationMs,
    otherMode: getOtherProviderCooldownMode(currentMode),
    otherIsCooldown: otherCooldown.isCooldown,
    otherRemainingTime: otherCooldown.remainingTime,
  };
};
