import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const { fileName, fileBase64, contentType, title, tags, plant, thought } = req.body;

  const buffer = Buffer.from(fileBase64, 'base64');

  // 1. Upload file to storage
  const { data, error } = await supabase.storage
    .from('photos')
    .upload(fileName, buffer, { contentType });

  if (error) return res.status(500).json({ error: error.message });

  // 2. Build public URL and insert into gallery table
  const photo_url = `${process.env.SUPABASE_URL}/storage/v1/object/public/photos/${fileName}`;

  const { error: insertError } = await supabase
    .from('gallery')
    .insert({
      title: title || 'Untitled',
      tags: tags || [],
      photo_url,
      thought_note: thought || null,
    });

  if (insertError) return res.status(500).json({ error: insertError.message });

  return res.status(200).json({ path: data.path, photo_url });
}
