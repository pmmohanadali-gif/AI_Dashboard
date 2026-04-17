export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return res.status(500).json({ error: 'BLOB_READ_WRITE_TOKEN not set' });

  let body = '';
  await new Promise((resolve, reject) => {
    req.on('data', c => body += c);
    req.on('end', resolve);
    req.on('error', reject);
  });

  const { filename } = JSON.parse(body || '{}');
  if (!filename) return res.status(400).json({ error: 'Missing filename' });

  res.status(200).json({
    uploadUrl: `https://blob.vercel-storage.com/${encodeURIComponent(filename)}`,
    token,
  });
}
