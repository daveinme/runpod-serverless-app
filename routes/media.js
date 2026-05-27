const express = require('express');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');

const router = express.Router();

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.ACCESS_KEY_ID,
    secretAccessKey: process.env.SECRET_ACCESS_KEY,
  },
});

// GET /api/media/outputs%2F1%2Fxxx.mp4
router.get('/media/:key(*)', async (req, res) => {
  try {
    const key = decodeURIComponent(req.params.key);

    // Sicurezza: l'utente può accedere solo ai propri file
    const expectedPrefix = `outputs/${req.user.id}/`;
    if (!key.startsWith(expectedPrefix)) {
      return res.status(403).json({ error: 'Non autorizzato' });
    }

    const cmd = new GetObjectCommand({ Bucket: process.env.BUCKET_NAME, Key: key });
    const response = await client.send(cmd);

    res.setHeader('Content-Type', response.ContentType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    response.Body.pipe(res);
  } catch (err) {
    res.status(404).json({ error: 'File non trovato' });
  }
});

module.exports = router;
