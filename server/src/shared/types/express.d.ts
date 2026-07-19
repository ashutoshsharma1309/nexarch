/**
 * Express request augmentation.
 *
 * `req.id` is assigned by the request-context middleware for every request
 * and echoed in the `X-Request-Id` response header and error envelopes, so a
 * client-reported failure can be joined against server logs.
 */
declare global {
  namespace Express {
    interface Request {
      /** Correlation id (UUID v4) assigned at the edge of the pipeline. */
      id: string;
    }
  }
}

export {};
