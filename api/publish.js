// POST /api/publish — add photos staged by /api/photo to the site in one commit.
// Body: { staged: [ { entry, blobs: { full, thumb } }, ... ] }

import {
  requireAuth, cleanMeta, assertId, assertSha, photoPaths,
  publishStaged, send, sendError, HttpError,
} from './_lib.js';

function rebuild(item) {
  // Everything is re-checked here: paths come from the id, never from the browser.
  const e = item?.entry || {};
  const id = assertId(e.id);
  const date = new Date(e.date);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, 'Bad photo date.');
  const width = Number.parseInt(e.width, 10);
  const height = Number.parseInt(e.height, 10);
  if (!(width > 0 && height > 0)) throw new HttpError(400, 'Bad photo size.');
  return {
    entry: { id, ...cleanMeta(e), date: date.toISOString(), ...photoPaths(id), width, height },
    blobs: { full: assertSha(item.blobs?.full), thumb: assertSha(item.blobs?.thumb) },
  };
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Use POST.');
    await requireAuth(req);
    const list = req.body?.staged;
    if (!Array.isArray(list) || !list.length) throw new HttpError(400, 'Nothing to publish.');
    if (list.length > 50) throw new HttpError(400, 'Please publish 50 photos or fewer at a time.');

    const staged = list.map(rebuild);
    const { added, commit } = await publishStaged(staged);
    return send(res, 200, {
      ok: true,
      commit,
      ids: staged.map((s) => s.entry.id),
      added: added.length,
      message: added.length
        ? `Saved ${added.length} photo${added.length === 1 ? '' : 's'}. Live in about a minute.`
        : 'Those photos were already saved.',
    });
  } catch (err) {
    return sendError(res, err);
  }
}
