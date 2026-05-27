const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.ACCESS_KEY_ID,
    secretAccessKey: process.env.SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.BUCKET_NAME;

async function uploadBuffer(key, buffer, contentType) {
  await client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }));
}

async function deleteObject(key) {
  await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

async function getPresignedUrl(key, expiresIn = 3600) {
  return getSignedUrl(client, new PutObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn });
}

// URL pubblica (richiede bucket pubblico o custom domain R2)
function publicUrl(key) {
  return `/api/media/${encodeURIComponent(key)}`;
}

module.exports = { uploadBuffer, deleteObject, publicUrl };
