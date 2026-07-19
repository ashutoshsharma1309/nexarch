/**
 * Request correlation.
 *
 * First middleware in the pipeline: stamps every request with a UUID, echoes
 * it as `X-Request-Id`, and makes it available to the logger, the success
 * helper, and the error handler. Incoming `X-Request-Id` headers from
 * trusted proxies are honored so traces survive hop boundaries.
 */
import { randomUUID } from 'node:crypto';

import type { RequestHandler } from 'express';

const REQUEST_ID_HEADER = 'X-Request-Id';
const INCOMING_ID_PATTERN = /^[\w.-]{1,128}$/;

export const requestContext: RequestHandler = (req, res, next) => {
  const incoming = req.get(REQUEST_ID_HEADER);
  req.id = incoming && INCOMING_ID_PATTERN.test(incoming) ? incoming : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, req.id);
  next();
};
