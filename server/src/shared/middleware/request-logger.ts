/**
 * HTTP access logging via Morgan, routed through the Winston transport so
 * access lines and application logs share one stream and one format policy.
 */
import morgan from 'morgan';
import type { RequestHandler } from 'express';

import { config } from '../config/index.js';
import { httpLogStream } from '../logger/index.js';

morgan.token('id', (req) => (req as { id?: string }).id ?? '-');

const format = config.isProduction
  ? ':id :remote-addr :method :url :status :res[content-length] :response-time ms'
  : ':method :url :status :response-time ms';

export const requestLogger: RequestHandler = morgan(format, {
  stream: httpLogStream,
  // Probes fire every few seconds in orchestrated environments; logging them
  // in production would drown real traffic.
  skip: (req) => config.isProduction && req.url.startsWith('/api/v1/health'),
});
