export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, options);
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/'))
      window.dispatchEvent(new Event('orbita:unauthorized'));
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(
      data?.error ?? 'Não foi possível conectar. Tente novamente.',
      response.status,
    );
  }
  return response.json() as Promise<T>;
}

export function jsonOptions(method: string, body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
