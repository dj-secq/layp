import * as SecureStore from "expo-secure-store";
import { bytesToBase64, decodeKey } from "./crypto";
import { parseHostPort } from "./protocol";

export const STORE_HOST = "layp.host";
export const STORE_PORT = "layp.port";
export const STORE_KEY = "layp.key";
export const STORE_PHONE = "layp.phoneId";

export type Session = { host: string; port: number; key: Uint8Array; phoneId: "phone" };

export async function loadSession(): Promise<Session | null> {
  const host = await SecureStore.getItemAsync(STORE_HOST);
  const portText = await SecureStore.getItemAsync(STORE_PORT);
  const keyText = await SecureStore.getItemAsync(STORE_KEY);
  const phoneId = await SecureStore.getItemAsync(STORE_PHONE);
  if (!host || !portText || !keyText || phoneId !== "phone") return null;
  const parsed = parseHostPort(host, portText);
  const key = decodeKey(keyText);
  if (!parsed || !key) return null;
  return { host: parsed.host, port: parsed.port, key, phoneId: "phone" };
}

export async function savePair(session: Session): Promise<void> {
  await SecureStore.setItemAsync(STORE_HOST, session.host);
  await SecureStore.setItemAsync(STORE_PORT, String(session.port));
  await SecureStore.setItemAsync(STORE_KEY, bytesToBase64(session.key));
  await SecureStore.setItemAsync(STORE_PHONE, session.phoneId);
}

export async function saveHost(host: string, port: number): Promise<void> {
  await SecureStore.setItemAsync(STORE_HOST, host);
  await SecureStore.setItemAsync(STORE_PORT, String(port));
}

export async function clearKey(): Promise<void> {
  await SecureStore.deleteItemAsync(STORE_KEY);
  await SecureStore.deleteItemAsync(STORE_PHONE);
}
