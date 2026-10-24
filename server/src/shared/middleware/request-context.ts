/**
 * Request correlation.
 *
 * First middleware in the pipeline: stamps every request with a UUID, echoes
 * it as `X-Request-Id`, and makes it available to the logger, the success
 * helper, and the error handler. Incoming `X-Request-Id` headers from
 * trusted proxies are honored so traces survive hop boundaries.
 *
 * The rest of the request runs inside an ambient log context seeded with
 * that same id, so the logger can stamp it on lines emitted anywhere
 * downstream — including the background work the request detaches and
 * leaves running after the response, which is the case `req.id` alone could
 * never cover.
 */
import { randomUUID } from 'node:crypto';

import type { RequestHandler } from 'express';

import { runWithLogContext } from '../logger/context.js';

const REQUEST_ID_HEADER = 'X-Request-Id';
const INCOMING_ID_PATTERN = /^[\w.-]{1,128}$/;

export const requestContext: RequestHandler = (req, res, next) => {
  const incoming = req.get(REQUEST_ID_HEADER);
  req.id = incoming && INCOMING_ID_PATTERN.test(incoming) ? incoming : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, req.id);
  runWithLogContext({ requestId: req.id }, next);
};
