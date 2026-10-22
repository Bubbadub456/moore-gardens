// POST /api/edit — change or remove a photo that's already on the site.
// Body: { id, title?, tags?, plant?, note? }  or  { id, remove: true }

import {
  requireAuth, assertId, cleanMeta, commitPhotos, send, sendError, HttpError,
} from './_lib.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Use POST.');
    await requireAuth(req);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const id = assertId(body.id);
    const remove = body.remove === true;

    let found = null;
    const { commit } = await commitPhotos((current) => {
      found = current.find((p) => p.id === id) || null;
      if (!found) throw new HttpError(404, 'That photo is not on the site anymore.');

      if (remove) {
        return {
          photos: current.filter((p) => p.id !== id),
          remove: [found.src, found.thumb].filter(Boolean),
          message: `Remove photo: ${found.title}`,
        };
      }

      // Only change the fields that were sent.
      const meta = cleanMeta({ ...found, ...body }, { requireTitle: true });
      const updated = { ...found, ...meta };
      return {
        photos: current.map((p) => (p.id === id ? updated : p)),
        message: `Edit photo: ${updated.title}`,
      };
    });

    return send(res, 200, {
      ok: true,
      commit,
      message: remove ? `Removed “${found.title}”.` : 'Saved. The site updates in about a minute.',
    });
  } catch (err) {
    return sendError(res, err);
  }
}
