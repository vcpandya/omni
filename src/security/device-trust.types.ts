// ── Device Trust / MDM — Types ──────────────────────────────────

export type DeviceTrustLevel = "trusted" | "verified" | "known" | "untrusted";

export type DeviceComplianceCheck = {
  checkId: string;
  passed: boolean;
  detail: string;
  weight: number;
};

export type DeviceComplianceReport = {
  deviceId: string;
  trustLevel: DeviceTrustLevel;
  trustScore: number;
  checks: DeviceComplianceCheck[];
  reportedAt: number;
  osVersion?: string;
  encryptionEnabled?: boolean;
  firewallEnabled?: boolean;
};

export type DeviceTrustPolicy = {
  minTrustLevel?: DeviceTrustLevel;
  requireEncryption?: boolean;
  requireFirewall?: boolean;
  maxOsAgeDays?: number;
  remoteWipeEnabled?: boolean;
};
