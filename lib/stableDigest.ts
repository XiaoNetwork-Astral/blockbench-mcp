type CryptoModule = typeof import("node:crypto");

function canonical(value: unknown): string {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") return "null";
  if (typeof value === "number" && !Number.isFinite(value)) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonical(record[key])}`
  ).join(",")}}`;
}

export function stableSha256(value: unknown): string {
  const crypto = requireNativeModule("crypto") as CryptoModule | undefined;
  if (!crypto) throw new Error("Blockbench did not grant access to the crypto module.");
  return crypto.createHash("sha256").update(canonical(value)).digest("hex");
}

export function bytesSha256(value: string | Uint8Array): string {
  const crypto = requireNativeModule("crypto") as CryptoModule | undefined;
  if (!crypto) throw new Error("Blockbench did not grant access to the crypto module.");
  return crypto.createHash("sha256").update(value).digest("hex");
}
