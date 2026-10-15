export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** User text never becomes FTS syntax. Each Unicode token is a quoted prefix. */
export function parseSearch(value: string) {
  const query = value.trim();
  if (query.length > 120) throw new HttpError(400, 'Use até 120 caracteres na busca.');
  const tokens = query.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (tokens.length > 12) throw new HttpError(400, 'Use até 12 palavras na busca.');
  return {
    query,
    match: tokens.map((token) => `"${token}"*`).join(' AND '),
    hasTokens: tokens.length > 0,
  };
}

export function integerParam(
  value: string | null,
  fallback: number,
  maximum: number,
  name: string,
) {
  if (value === null) return fallback;
  if (!/^[1-9]\d*$/.test(value)) throw new HttpError(400, `${name} inválido.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum)
    throw new HttpError(400, `${name} inválido.`);
  return parsed;
}
