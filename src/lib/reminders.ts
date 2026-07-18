export type ReminderPreferences = {
  native_notification: boolean;
  floating_window: boolean;
  screen_dim: boolean;
  sound: boolean;
  sustained_bad_seconds: number;
  cooldown_seconds: number;
  display_seconds: number;
  dim_opacity: number;
};

export const REMINDER_PREFERENCES_KEY = 'oneposture_reminder_preferences';

export const defaultReminderPreferences: ReminderPreferences = {
  native_notification: true,
  floating_window: true,
  screen_dim: false,
  sound: true,
  sustained_bad_seconds: 12,
  cooldown_seconds: 180,
  display_seconds: 8,
  dim_opacity: 0.34,
};

export const loadReminderPreferences = (): ReminderPreferences => {
  try {
    const stored = localStorage.getItem(REMINDER_PREFERENCES_KEY);
    if (!stored) return defaultReminderPreferences;
    return { ...defaultReminderPreferences, ...JSON.parse(stored) };
  } catch {
    return defaultReminderPreferences;
  }
};

export const saveReminderPreferences = (preferences: ReminderPreferences) => {
  localStorage.setItem(REMINDER_PREFERENCES_KEY, JSON.stringify(preferences));
};
