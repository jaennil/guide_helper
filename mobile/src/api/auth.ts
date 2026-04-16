import { API_BASE_URL } from "./config";
import { deleteJsonFile, readJsonFile, writeJsonFile } from "../storage/jsonStore";

const AUTH_FILE_NAME = "auth-session.json";

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

interface RefreshResponse {
  access_token: string;
  token_type: string;
}

async function postJson<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let parsed: T | { message?: string } | null = null;

  if (text) {
    try {
      parsed = JSON.parse(text) as T;
    } catch {
      parsed = { message: text };
    }
  }

  if (!response.ok) {
    throw new Error(
      typeof parsed === "object" && parsed !== null && "message" in parsed
        ? String((parsed as Record<string, unknown>).message)
        : `Request failed with status ${response.status}`,
    );
  }

  return parsed as T;
}

export async function getStoredTokens() {
  return readJsonFile<AuthTokens>(AUTH_FILE_NAME);
}

export async function storeTokens(tokens: AuthTokens) {
  await writeJsonFile(AUTH_FILE_NAME, tokens);
}

export async function clearStoredTokens() {
  await deleteJsonFile(AUTH_FILE_NAME);
}

export async function login(email: string, password: string) {
  const tokens = await postJson<AuthTokens>("/api/v1/auth/login", { email, password });
  await storeTokens(tokens);
  return tokens;
}

export async function register(email: string, password: string) {
  const tokens = await postJson<AuthTokens>("/api/v1/auth/register", { email, password });
  await storeTokens(tokens);
  return tokens;
}

export async function refreshAccessToken(refreshToken: string) {
  const response = await postJson<RefreshResponse>("/api/v1/auth/refresh", {
    refresh_token: refreshToken,
  });
  const currentTokens = await getStoredTokens();

  if (!currentTokens) {
    throw new Error("No refresh session available");
  }

  const nextTokens: AuthTokens = {
    ...currentTokens,
    access_token: response.access_token,
    token_type: response.token_type,
  };

  await storeTokens(nextTokens);
  return nextTokens;
}
