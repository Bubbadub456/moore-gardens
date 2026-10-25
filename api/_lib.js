// Shared helpers for the photo API. Files starting with "_" are not routes on Vercel.
//
// How posting works: each photo is resized on the server (which also strips
// location data), saved to GitHub as a git blob, then one commit adds the
// image files and updates photos.json. Vercel redeploys the site from that
// commit, so a new photo is live about a minute later.

import crypto from 'node:crypto';
import sharp from 'sharp';

const REPO = process.env.GITHUB_REPO || 'Bubbadub456/moore-gardens';
const BRANCH = process.env.GITHUB_BRANCH || 'main';
const AUTHOR = { name: 'Bubbadub456', email: 'bubbainfo@pm.me' };

export const FULL_SIZE = 1800; // longest edge of the lightbox image
export const THUMB_SIZE = 720; // shortest edge of the grid thumbnail
const MAX_TAGS = 8;

// ---------- responses ----------

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(body);
}

export function sendError(res, err) {
  const status = err.status && err.status < 600 ? err.status : 500;
  const message = err instanceof HttpError ? err.message : `Something went wrong: ${err.message}`;
  if (!(err instanceof HttpError)) console.error(err);
  return send(res, status, { ok: false, message });
}

// ---------- auth ----------

export function serverReady() {
  return {
    password: Boolean(process.env.UPLOAD_PASSWORD),
    github: Boolean(process.env.GITHUB_TOKEN),
  };
}

function digest(s) {
  return crypto.createHash('sha256').update(String(s)).digest();
}

// Returns true/false for a request's "Authorization: Bearer <password>" header.
export function isAuthorized(req) {
  const expected = process.env.UPLOAD_PASSWORD;
  if (!expected) return false;
  const header = req.headers.authorization || '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  return crypto.timingSafeEqual(digest(given), digest(expected));
}

// Throws unless the server is configured and the request has the right password.
export async function requireAuth(req) {
  const ready = serverReady();
  if (!ready.password || !ready.github) {
    throw new HttpError(503, 'The upload server is not set up yet (missing password or GitHub token in Vercel).');
  }
  if (!isAuthorized(req)) {
    await new Promise((r) => setTimeout(r, 600)); // slow down guessing
    throw new HttpError(401, 'Wrong password.');
  }
}

// ---------- input cleanup ----------

function cleanText(value, max) {
  if (value == null) return null;
  const s = String(value).replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}

function cleanNote(value) {
  if (value == null) return null;
  const s = String(value).replace(/\r\n/g, '\n').trim();
  return s ? s.slice(0, 1000) : null;
}

export function cleanTags(value) {
  let list = [];
  if (Array.isArray(value)) list = value;
  else if (typeof value === 'string') list = value.split(/[,#\n]/);
  const seen = new Set();
  for (const t of list) {
    const tag = String(t).toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 30);
    if (tag) seen.add(tag);
  }
  return [...seen].slice(0, MAX_TAGS);
}

// Accepts `note` or the old `thought` field name.
export function cleanMeta(body, { requireTitle = true } = {}) {
  const title = cleanText(body.title, 120);
  if (requireTitle && !title) throw new HttpError(400, 'Add a title for the photo.');
  return {
    title,
    tags: cleanTags(body.tags),
    plant: cleanText(body.plant, 120),
    note: cleanNote(body.note ?? body.thought),
  };
}

const ID_RE = /^\d{4}-\d{2}-\d{2}-[a-z0-9]{6}$/;
const SHA_RE = /^[0-9a-f]{40}$/;

export function newId(date = new Date()) {
  const day = date.toISOString().slice(0, 10);
  const rand = crypto.randomBytes(6).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '').padEnd(6, '0').slice(0, 6);
  return `${day}-${rand}`;
}

export function assertId(id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new HttpError(400, 'Bad photo id.');
  return id;
}

export function assertSha(sha) {
  if (typeof sha !== 'string' || !SHA_RE.test(sha)) throw new HttpError(400, 'Bad file reference.');
  return sha;
}

export function photoPaths(id) {
  return { src: `photos/full/${id}.jpg`, thumb: `photos/thumb/${id}.jpg` };
}

// ---------- images ----------

export function decodeImage(value) {
  if (typeof value !== 'string' || !value) throw new HttpError(400, 'No image was sent.');
  const b64 = value.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  const buf = Buffer.from(b64, 'base64');
  if (buf.length < 100) throw new HttpError(400, 'The image looks empty.');
  return buf;
}

// Makes the lightbox image and the grid thumbnail. sharp drops all metadata
// (including GPS location) unless asked to keep it, and rotate() applies the
// camera's orientation first so nothing comes out sideways.
export async function processImage(buf) {
  let base;
  try {
    base = sharp(buf, { failOn: 'none' }).rotate();
    await base.metadata();
  } catch {
    throw new HttpError(415, 'That file is not an image the server can read. Send a JPEG or PNG.');
  }
  try {
    const full = await base
      .clone()
      .resize({ width: FULL_SIZE, height: FULL_SIZE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    const thumb = await base
      .clone()
      .resize({ width: THUMB_SIZE, height: THUMB_SIZE, fit: 'outside', withoutEnlargement: true })
      .jpeg({ quality: 72, mozjpeg: true })
      .toBuffer();
    return { full: full.data, thumb, width: full.info.width, height: full.info.height };
  } catch {
    throw new HttpError(415, 'That image format is not supported. Send a JPEG or PNG (HEIC photos need converting first).');
  }
}

// ---------- GitHub ----------

// Forgive common paste mistakes in the Vercel setting: spaces, quote marks, a leading "Bearer".
function githubToken() {
  const unquote = (s) => s.trim().replace(/^["']+|["']+$/g, '').trim();
  return unquote(unquote(String(process.env.GITHUB_TOKEN || '')).replace(/^bearer\s+/i, ''));
}

// Explains a rejected token without revealing it (only shown after the password check).
function tokenProblem() {
  const t = githubToken();
  if (/^github_pat_/.test(t) && t.length < 80) {
    return `The saved token looks cut off (${t.length} characters; these are usually 93). Copy it again in full.`;
  }
  if (/^(github_pat_|gh[pousr]_)/.test(t)) {
    return 'The saved token looks complete, so it has probably expired or been deleted. Make a new one.';
  }
  return 'The saved value does not look like a GitHub token (those start with "github_pat_"). Paste the token itself.';
}

async function gh(path, { method = 'GET', body, raw = false } = {}) {
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${githubToken()}`,
      Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'moore-gardens-uploader',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let detail = text.slice(0, 200);
    try { detail = JSON.parse(text).message || detail; } catch {}
    const message = res.status === 401
      ? `GitHub rejected the token saved in Vercel. ${tokenProblem()} Then redeploy the site.`
      : `GitHub said: ${detail}`;
    // Always 502 to the browser, so a GitHub auth problem never looks like a wrong password.
    const err = new HttpError(502, message);
    err.githubStatus = res.status;
    throw err;
  }
  return raw ? res.text() : res.json();
}

export async function createBlob(buffer) {
  const blob = await gh('/git/blobs', {
    method: 'POST',
    body: { content: buffer.toString('base64'), encoding: 'base64' },
  });
  return blob.sha;
}

async function readPhotosAt(commitSha) {
  try {
    const text = await gh(`/contents/photos.json?ref=${commitSha}`, { raw: true });
    const list = JSON.parse(text);
    return Array.isArray(list) ? list : [];
  } catch (err) {
    if (err.githubStatus === 404) return [];
    throw err;
  }
}

export async function readPhotos() {
  const ref = await gh(`/git/ref/heads/${BRANCH}`);
  return readPhotosAt(ref.object.sha);
}

// Makes one commit on the branch. `change(photos)` gets the current
// photos.json list and returns { photos, add: [{path, sha}], remove: [path], message },
// or null when there is nothing to change.
// If someone else committed in the meantime, it re-reads and tries again, so
// two uploads at once don't overwrite each other.
export async function commitPhotos(change) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const ref = await gh(`/git/ref/heads/${BRANCH}`);
    const headSha = ref.object.sha;
    const head = await gh(`/git/commits/${headSha}`);
    const current = await readPhotosAt(headSha);

    const planned = change(current);
    if (!planned) return { commit: null, photos: current };
    const { photos, add = [], remove = [], message } = planned;
    const jsonSha = await createBlob(Buffer.from(JSON.stringify(photos, null, 2) + '\n'));
    const entries = [
      { path: 'photos.json', mode: '100644', type: 'blob', sha: jsonSha },
      ...add.map((f) => ({ path: f.path, mode: '100644', type: 'blob', sha: f.sha })),
      ...remove.map((path) => ({ path, mode: '100644', type: 'blob', sha: null })),
    ];
    const tree = await gh('/git/trees', { method: 'POST', body: { base_tree: head.tree.sha, tree: entries } });
    const commit = await gh('/git/commits', {
      method: 'POST',
      body: { message, tree: tree.sha, parents: [headSha], author: AUTHOR, committer: AUTHOR },
    });
    try {
      await gh(`/git/refs/heads/${BRANCH}`, { method: 'PATCH', body: { sha: commit.sha, force: false } });
      return { commit: commit.sha, photos };
    } catch (err) {
      if (err.githubStatus === 422 && attempt < 4) continue; // branch moved; retry on top of it
      throw err;
    }
  }
  throw new HttpError(409, 'Could not save after several tries. Please try again.');
}

// Adds staged photos (already uploaded as blobs) to photos.json in one commit.
// Photos whose id is already in photos.json are skipped, so retrying is safe.
export async function publishStaged(staged) {
  let added = [];
  const result = await commitPhotos((current) => {
    const existing = new Set(current.map((p) => p.id));
    const fresh = staged.filter((s) => !existing.has(s.entry.id));
    added = fresh.map((s) => s.entry);
    if (!fresh.length) return null;
    const photos = [...added, ...current].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const add = fresh.flatMap((s) => [
      { path: s.entry.src, sha: s.blobs.full },
      { path: s.entry.thumb, sha: s.blobs.thumb },
    ]);
    const names = added.map((p) => p.title);
    const message = names.length === 1 ? `Add photo: ${names[0]}` : `Add ${names.length} photos: ${names.join(', ')}`.slice(0, 200);
    return { photos, add, message };
  });
  return { ...result, added };
}
