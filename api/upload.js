import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  let step = 'init';
  try {
    const supabaseStorage = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    const supabaseDb = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_DB_KEY || process.env.SUPABASE_SERVICE_KEY
    );

    const { fileName, fileBase64, contentType, title, tags, plant, thought } = req.body;

    if (!fileBase64 || !fileName) {
      return res.status(400).json({ error: 'Missing fileName or fileBase64' });
    }

    step = 'decode';
    const buffer = Buffer.from(fileBase64, 'base64');

    // 1. Upload file to storage
    step = 'storage';
    const { data, error } = await supabaseStorage.storage
      .from('photos')
      .upload(fileName, buffer, { contentType });

    if (error) return res.status(500).json({ error: `storage: ${error.message}` });

    // 2. Build public URL and insert into gallery table
    step = 'insert';
    const photo_url = `${process.env.SUPABASE_URL}/storage/v1/object/public/photos/${fileName}`;

    const { error: insertError } = await supabaseDb
      .from('gallery')
      .insert({
        title: title || 'Untitled',
        tags: tags || [],
        photo_url,
        thought_note: thought || null,
      });

    if (insertError) return res.status(500).json({ error: `insert: ${insertError.message}` });

    return res.status(200).json({ path: data.path, photo_url });

  } catch (err) {
    return res.status(500).json({ error: `crash at ${step}: ${err.message}` });
  }
}
