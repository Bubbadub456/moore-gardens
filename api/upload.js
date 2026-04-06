import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  // Expect base64 image + filename from the client
  const { fileName, fileBase64, contentType } = req.body;

  const buffer = Buffer.from(fileBase64, 'base64');

  const { data, error } = await supabase.storage
    .from('photos') // your bucket name
    .upload(fileName, buffer, { contentType });

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ path: data.path });
}
