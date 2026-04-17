import { head } from '@vercel/blob';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
    const blob = await head('latest-data.json', { token: BLOB_TOKEN });
    const response = await fetch(blob.url);
    const data = await response.json();

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(data);
  } catch (err) {
    res.status(404).json({ error: 'No data uploaded yet' });
  }
}
