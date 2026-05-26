import { Request } from 'express';

export type KeyExtractor = { name: string; extract: (req: Request) => string };

export const keyExtractors = {
  byIp: (req: Request): string => {
    return req.ip ?? 'unknown';
  },

  byApiKey: (req: Request): string => {
    const apiKey = req.headers['x-api-key'] as string | undefined;
    if (apiKey) return apiKey;
    const authHeader = req.headers['authorization'];
    if (typeof authHeader === 'string' && authHeader.startsWith('ApiKey ')) {
      return authHeader.slice(7);
    }
    return keyExtractors.byIp(req);
  },
};
