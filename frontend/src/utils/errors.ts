interface ResponseLike {
  response?: {
    data?: unknown;
    status?: number;
  };
}

function isResponseLike(value: unknown): value is ResponseLike {
  return typeof value === 'object' && value !== null && 'response' in value;
}

export function getErrorStatus(error: unknown): number | undefined {
  return isResponseLike(error) ? error.response?.status : undefined;
}

export function getErrorMessage(error: unknown, fallback: string): string {
  if (isResponseLike(error)) {
    const data = error.response?.data;

    if (typeof data === 'string' && data.trim()) {
      return data.trim();
    }

    if (typeof data === 'object' && data !== null) {
      const payload = data as { message?: unknown; error?: unknown };
      if (typeof payload.message === 'string' && payload.message.trim()) {
        return payload.message.trim();
      }
      if (typeof payload.error === 'string' && payload.error.trim()) {
        return payload.error.trim();
      }
    }
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return fallback;
}
