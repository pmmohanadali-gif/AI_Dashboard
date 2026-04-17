import { put } from '@vercel/blob';

// Tell Vercel to allow up to 50MB body
export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
    maxDuration: 60,
  },
};

async function readStream(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return res.status(500).json({ error: 'BLOB_READ_WRITE_TOKEN not set' });

  try {
    const body = await readStream(req);
    const contentType = req.headers['content-type'] || '';
    const filename = req.headers['x-filename'];

    if (!filename) return res.status(400).json({ error: 'Missing x-filename header' });

    // Store directly to Vercel Blob
    await put(filename, body, {
      access: 'public',
      token,
      addRandomSuffix: false,
      contentType: 'text/plain',
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
