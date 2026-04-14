import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (req.body?.key !== 'sweet') return res.status(401).json({ error: 'unauthorized' });

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const results = [];

  for (const fileName of ['.jpg', 'test-photo.jpg']) {
    const { data, error } = await supabase.storage
      .from('photos')
      .remove([fileName]);

    results.push({ fileName, data, error: error?.message || null });
  }

  return res.status(200).json({ results });
}
