function parseEnvCcList(): string[] | null {
  const raw = process.env.SOA_CC_RECIPIENTS;
  if (!raw) {
    return null;
  }
  const items = raw
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e.includes("@"));
  return items.length > 0 ? items : null;
}

const GLOBAL_CC = parseEnvCcList();

export const EMAIL_CONFIG = {
  FALLBACK_EMAIL: process.env.SOA_FALLBACK_EMAIL || "collection@tob-ins.com",
  SHARED_MAILBOX: process.env.AZURE_SHARED_MAILBOX || "collection@tob-ins.com",
  getCcRecipients(actingCode: string): string[] {
    if (GLOBAL_CC) {
      return GLOBAL_CC;
    }
    const DEFAULT_CC: Record<string, string[]> = {
      DIP: ["finance@tob-ins.com", "mkt.nonleasing@tob-ins.com"],
      DIG: [
        "finance@tob-ins.com",
        "mkt.nonleasing@tob-ins.com",
        "mkt.directgroup@tob-ins.com",
      ],
      DEFAULT: ["finance@tob-ins.com"],
    };
    return DEFAULT_CC[actingCode] || DEFAULT_CC.DEFAULT;
  },
} as const;
