import { invoke } from '@tauri-apps/api/core';

export interface LicenseStatus {
  edition: 'free' | 'trial' | 'pro';
  active: boolean;
  commercial_ready: boolean;
  can_use_app: boolean;
  trial_active: boolean;
  trial_started_at?: number;
  trial_ends_at?: number;
  trial_days_remaining: number;
  license_id?: string;
  expires_at?: number;
  message?: string;
}

export const LICENSE_STATUS_CHANGED_EVENT = 'oneposture-license-status-changed';

export const getLicenseStatus = (): Promise<LicenseStatus> =>
  invoke<LicenseStatus>('get_license_status');

export const activateLicense = (licenseKey: string): Promise<LicenseStatus> =>
  invoke<LicenseStatus>('activate_license', { licenseKey });

export const announceLicenseStatus = (status: LicenseStatus) => {
  window.dispatchEvent(new CustomEvent<LicenseStatus>(LICENSE_STATUS_CHANGED_EVENT, { detail: status }));
};
