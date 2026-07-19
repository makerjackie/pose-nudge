export type AppLanguage = 'en' | 'ko' | 'ja' | 'zh' | 'zh-Hant' | 'tr';

export interface DetectionPreferences {
  batterySavingMode: boolean;
  notificationFrequency: number;
  turtleNeckSensitivity: number;
  shoulderSensitivity: number;
  monitoringInterval: number;
}

export interface CameraPreference {
  index: number;
  name: string;
  deviceId: string;
}

const KEYS = {
  language: 'pose_nudge_language',
  notificationFrequency: 'pose_nudge_notification_frequency',
  turtleNeckSensitivity: 'pose_nudge_turtle_neck_sensitivity',
  shoulderSensitivity: 'pose_nudge_shoulder_sensitivity',
  cameraIndex: 'pose_nudge_camera_index',
  cameraName: 'pose_nudge_camera_name',
  legacyCameraDevice: 'pose_nudge_camera',
  monitoringInterval: 'pose_nudge_monitoring_interval',
  batterySavingMode: 'pose_nudge_battery_saving_mode',
} as const;

const readPositiveInteger = (key: string, fallback: number): number => {
  const value = Number.parseInt(localStorage.getItem(key) ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const writeInteger = (key: string, value: number): void => {
  localStorage.setItem(key, String(Math.max(0, Math.trunc(value))));
};

export const normalizeAppLanguage = (value: string | undefined | null): AppLanguage => {
  const normalized = value?.toLowerCase() ?? '';
  if (normalized.startsWith('zh-hant') || normalized.startsWith('zh-tw') || normalized.startsWith('zh-hk')) return 'zh-Hant';
  if (normalized.startsWith('zh')) return 'zh';
  if (normalized.startsWith('ko')) return 'ko';
  if (normalized.startsWith('ja')) return 'ja';
  if (normalized.startsWith('tr')) return 'tr';
  return 'en';
};

export const normalizeCameraName = (value: string): string =>
  value.toLowerCase().replace(/\s+/g, ' ').trim();

export const appPreferences = {
  readLanguage(fallback?: string): AppLanguage {
    return normalizeAppLanguage(localStorage.getItem(KEYS.language) || fallback);
  },

  writeLanguage(language: AppLanguage): void {
    localStorage.setItem(KEYS.language, language);
  },

  readDetection(): DetectionPreferences {
    return {
      batterySavingMode: localStorage.getItem(KEYS.batterySavingMode) === 'true',
      notificationFrequency: readPositiveInteger(KEYS.notificationFrequency, 2),
      turtleNeckSensitivity: readPositiveInteger(KEYS.turtleNeckSensitivity, 2),
      shoulderSensitivity: readPositiveInteger(KEYS.shoulderSensitivity, 2),
      monitoringInterval: readPositiveInteger(KEYS.monitoringInterval, 3),
    };
  },

  writeDetection(preferences: DetectionPreferences): void {
    localStorage.setItem(KEYS.batterySavingMode, String(preferences.batterySavingMode));
    writeInteger(KEYS.notificationFrequency, preferences.notificationFrequency);
    writeInteger(KEYS.turtleNeckSensitivity, preferences.turtleNeckSensitivity);
    writeInteger(KEYS.shoulderSensitivity, preferences.shoulderSensitivity);
    writeInteger(KEYS.monitoringInterval, preferences.monitoringInterval);
  },

  readCamera(): CameraPreference {
    const rawIndex = Number.parseInt(localStorage.getItem(KEYS.cameraIndex) ?? '', 10);
    return {
      index: Number.isFinite(rawIndex) && rawIndex >= 0 ? rawIndex : 0,
      name: localStorage.getItem(KEYS.cameraName) ?? '',
      deviceId: localStorage.getItem(KEYS.legacyCameraDevice) ?? '',
    };
  },

  writeCamera(preference: Partial<CameraPreference>): void {
    if (preference.index !== undefined) writeInteger(KEYS.cameraIndex, preference.index);
    if (preference.name !== undefined) localStorage.setItem(KEYS.cameraName, preference.name);
    if (preference.deviceId !== undefined) localStorage.setItem(KEYS.legacyCameraDevice, preference.deviceId);
  },

  recordIntervalSeconds(): number {
    const preferences = this.readDetection();
    return preferences.monitoringInterval * (preferences.batterySavingMode ? 60 : 1);
  },
};

export const resolvePreferredVideoDevice = (
  devices: MediaDeviceInfo[],
  preference: CameraPreference = appPreferences.readCamera(),
): MediaDeviceInfo | undefined => {
  const videoInputs = devices.filter((device) => device.kind === 'videoinput');
  const normalizedTarget = normalizeCameraName(preference.name);
  const byName = normalizedTarget
    ? videoInputs.find((device) => {
        const label = normalizeCameraName(device.label);
        return label.length > 0 && (label.includes(normalizedTarget) || normalizedTarget.includes(label));
      })
    : undefined;
  const byDeviceId = videoInputs.find((device) => device.deviceId === preference.deviceId);
  return byName ?? byDeviceId ?? videoInputs[preference.index] ?? videoInputs[0];
};
