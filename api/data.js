import { list } from '@vercel/blob';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const { blobs } = await list({ token: process.env.BLOB_READ_WRITE_TOKEN, prefix: 'latest-data.json' });
    const match = blobs.find(b => b.pathname === 'latest-data.json');
    if (!match) return res.status(404).json({ error: 'No data yet' });

    const response = await fetch(match.url);
    const data = await response.json();

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(data);
  } catch (err) {
    res.status(404).json({ error: 'No data uploaded yet' });
  }
}
