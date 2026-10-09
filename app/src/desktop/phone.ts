import { invoke } from "@tauri-apps/api/core";

export type PhoneBind = { host: string; port: number; otherIpv4: string[] };

export type PhoneStatus = {
  on: boolean;
  host: string;
  port: number;
  otherIpv4: string[];
  offerExpiresAt: string | null;
  keyExists: boolean;
};

export type PairingOffer = { code: string; expiresAt: string };

export function phoneSetEnabled(on: boolean): Promise<PhoneBind> {
  return invoke("phone_set_enabled", { on });
}

export function phoneStatus(): Promise<PhoneStatus> {
  return invoke("phone_status");
}

export function phonePairingOffer(replace: boolean): Promise<PairingOffer> {
  return invoke("phone_pairing_offer", { replace });
}

export function phoneForget(): Promise<void> {
  return invoke("phone_forget");
}

export function phoneKick(): Promise<void> {
  return invoke("phone_kick");
}
