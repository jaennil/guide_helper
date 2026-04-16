import { API_BASE_URL } from "./config";
import { clearStoredTokens, getStoredTokens, refreshAccessToken } from "./auth";

interface RequestOptions extends RequestInit {
  auth?: boolean;
}

async function parseResponse<T>(response: Response): Promise<T> {
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

function buildHeaders(current: HeadersInit | undefined, accessToken?: string) {
  const headers = new Headers(current);

  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  return headers;
}

export async function requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { auth = true, ...requestInit } = options;
  const tokens = auth ? await getStoredTokens() : null;
  const execute = async (accessToken?: string) =>
    fetch(`${API_BASE_URL}${path}`, {
      ...requestInit,
      headers: buildHeaders(requestInit.headers, accessToken),
    });

  let response = await execute(tokens?.access_token);

  if (response.status === 401 && auth && tokens?.refresh_token) {
    try {
      const refreshedTokens = await refreshAccessToken(tokens.refresh_token);
      response = await execute(refreshedTokens.access_token);
    } catch (error) {
      await clearStoredTokens();
      throw error;
    }
  }

  return parseResponse<T>(response);
}
