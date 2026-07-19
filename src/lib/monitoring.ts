import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification';
import { appPreferences } from '@/lib/preferences';
import { loadReminderPreferences } from '@/lib/reminders';

const NOTIFICATION_PERMISSION_REQUESTED_KEY = 'oneposture_notification_permission_requested_v2';

interface MonitoringStatus {
  active: boolean;
}

export const requestReminderPermission = async (force = false): Promise<boolean> => {
  try {
    if (await isPermissionGranted()) return true;
    if (!force && localStorage.getItem(NOTIFICATION_PERMISSION_REQUESTED_KEY) === 'true') return false;

    localStorage.setItem(NOTIFICATION_PERMISSION_REQUESTED_KEY, 'true');
    return (await requestPermission()) === 'granted';
  } catch (error) {
    console.error('Failed to request notification permission:', error);
    return false;
  }
};

export const configureMonitoring = async (): Promise<boolean> => {
  const detection = appPreferences.readDetection();
  const camera = appPreferences.readCamera();
  const reminders = loadReminderPreferences();

  await Promise.all([
    invoke('set_battery_saving_mode', { mode: detection.batterySavingMode }),
    invoke('set_selected_camera', { index: camera.index }),
    invoke(
      'set_monitoring_interval',
      detection.batterySavingMode
        ? { intervalMins: detection.monitoringInterval }
        : { intervalSecs: detection.monitoringInterval },
    ),
    invoke('set_detection_settings', {
      frequency: detection.batterySavingMode ? 1 : detection.notificationFrequency,
      turtleSensitivity: detection.turtleNeckSensitivity,
      shoulderSensitivity: detection.shoulderSensitivity,
    }),
    invoke('set_reminder_preferences', { preferences: reminders }),
  ]);

  if (reminders.native_notification) void requestReminderPermission();
  return getMonitoringActive();
};

export const getMonitoringActive = async (): Promise<boolean> =>
  (await invoke<MonitoringStatus>('get_monitoring_status')).active;

export const setMonitoringActive = async (active: boolean): Promise<boolean> => {
  if (active && loadReminderPreferences().native_notification) await requestReminderPermission();
  await invoke(active ? 'start_monitoring' : 'stop_monitoring');
  return getMonitoringActive();
};

export const onMonitoringChange = (
  listener: (active: boolean) => void,
): Promise<UnlistenFn> =>
  listen<MonitoringStatus>('monitoring-state-changed', (event) => listener(event.payload.active));
