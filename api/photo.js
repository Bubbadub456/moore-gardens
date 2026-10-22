// POST /api/photo — resize one photo and save it to GitHub (not yet on the site).
// Body: { image: base64 JPEG/PNG, title, tags, plant, note }
// Returns { staged } to pass to /api/publish, so a batch becomes one commit.
// Add ?publish=1 (or "publish": true) to put it on the site right away;
// the iPhone Shortcut does this.

import {
  requireAuth, cleanMeta, decodeImage, processImage, createBlob,
  newId, photoPaths, publishStaged, send, sendError, HttpError,
} from './_lib.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Use POST.');
    await requireAuth(req);
    const body = req.body && typeof req.body === 'object' ? req.body : {};

    const meta = cleanMeta(body);
    const image = await processImage(decodeImage(body.image));
    const [full, thumb] = await Promise.all([createBlob(image.full), createBlob(image.thumb)]);

    const id = newId();
    const entry = {
      id,
      title: meta.title,
      date: new Date().toISOString(),
      tags: meta.tags,
      plant: meta.plant,
      note: meta.note,
      ...photoPaths(id),
      width: image.width,
      height: image.height,
    };
    const staged = { entry, blobs: { full, thumb } };

    const publishNow = body.publish === true || req.query?.publish === '1';
    if (!publishNow) return send(res, 200, { ok: true, staged });

    await publishStaged([staged]);
    return send(res, 200, {
      ok: true,
      entry,
      message: `Posted “${entry.title}”. It will be on the site in about a minute.`,
    });
  } catch (err) {
    return sendError(res, err);
  }
}
