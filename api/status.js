// GET /api/status — is the upload server set up, and is this password right?
// With a correct password it also returns the current photos.json straight
// from GitHub (fresher than the deployed copy) for the edit list.

import { serverReady, isAuthorized, readPhotos, send, sendError } from './_lib.js';

export default async function handler(req, res) {
  try {
    const ready = serverReady();
    const hasHeader = Boolean(req.headers.authorization);
    const authorized = ready.password && hasHeader ? isAuthorized(req) : false;
    if (hasHeader && !authorized) await new Promise((r) => setTimeout(r, 600));

    const body = { ok: true, ready: ready.password && ready.github, authorized };
    if (authorized && ready.github && req.query?.photos === '1') {
      body.photos = await readPhotos();
    }
    return send(res, 200, body);
  } catch (err) {
    return sendError(res, err);
  }
}
