// ── Trusted Skill Repository — Types ────────────────────────────

export type SkillTrustLevel = "verified" | "community" | "local" | "untrusted";

export type SkillTrustEntry = {
  skillKey: string;
  source: string;
  contentHash: string;
  trustLevel: SkillTrustLevel;
  verifiedAt: number;
  verifiedBy?: string;
  quarantined?: boolean;
  quarantineReason?: string;
};

export type SkillTrustManifest = {
  version: 1;
  updatedAt: number;
  entries: Record<string, SkillTrustEntry>;
};
