const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { RUNPOD_API_KEY, ENDPOINTS } = require('../config');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
const OUTPUTS_DIR = path.join(__dirname, '../public/outputs');
const BASE_WORKFLOW = JSON.parse(fs.readFileSync(path.join(__dirname, '../api-workflow.json'), 'utf8'));

function buildVideoWorkflow(params, imageBase64) {
  const { prompt, negativePrompt, width, height, duration, framerate, seed, textToVideo } = params;
  const actualSeed = seed === -1 ? Math.floor(Math.random() * 2 ** 32) : seed;

  // Deep clone base workflow and patch only the variable nodes
  const workflow = JSON.parse(JSON.stringify(BASE_WORKFLOW));

  workflow["325"].inputs.noise_seed = actualSeed;
  workflow["326"].inputs.noise_seed = actualSeed + 1;
  workflow["352"].inputs.text = prompt;
  workflow["362"].inputs.text = negativePrompt;
  workflow["361"].inputs.value = width;
  workflow["348"].inputs.value = height;
  workflow["349"].inputs.value = framerate;
  workflow["350"].inputs.value = duration;
  workflow["351"].inputs.value = textToVideo;
  workflow["377"].inputs.image = imageBase64 ? `data:image/png;base64,${imageBase64}` : 'example.png';

  return workflow;
}

async function pollJob(jobId, endpointId) {
  const url = `https://api.runpod.ai/v2/${endpointId}/status/${jobId}`;
  while (true) {
    await new Promise(r => setTimeout(r, 5000));
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${RUNPOD_API_KEY}` }
    });
    const data = await res.json();
    if (data.status === 'COMPLETED') return data;
    if (data.status === 'FAILED') throw new Error(data.error || 'Job fallito');
  }
}

router.post('/generate-video', upload.single('image'), async (req, res) => {
  console.log('[generate-video] request received');
  const endpointId = ENDPOINTS.video;
  console.log('[generate-video] endpoint:', endpointId);
  if (!endpointId) return res.status(503).json({ success: false, error: 'Endpoint video non configurato' });

  try {
    const textToVideo = req.body.textToVideo === 'true';
    const params = {
      prompt: req.body.prompt || '',
      negativePrompt: req.body.negativePrompt || 'pc game, console game, video game, cartoon, ugly',
      width: parseInt(req.body.width) || 512,
      height: parseInt(req.body.height) || 896,
      duration: parseInt(req.body.duration) || 10,
      framerate: parseInt(req.body.framerate) || 25,
      seed: parseInt(req.body.seed) ?? -1,
      textToVideo,
    };

    // Convert uploaded image to base64 if provided
    let imageBase64 = null;
    if (req.file && !textToVideo) {
      imageBase64 = req.file.buffer.toString('base64');
    } else if (req.body.imageUrl && !textToVideo) {
      // Support passing an existing output image URL (e.g. /outputs/xxx.png)
      const imgPath = path.join(__dirname, '../public', req.body.imageUrl);
      if (fs.existsSync(imgPath)) {
        imageBase64 = fs.readFileSync(imgPath).toString('base64');
      }
    }

    const workflow = buildVideoWorkflow(params, imageBase64);

    const runRes = await fetch(`https://api.runpod.ai/v2/${endpointId}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RUNPOD_API_KEY}` },
      body: JSON.stringify({ input: { workflow } })
    });

    const runText = await runRes.text();
    console.log('[generate-video] runpod response:', runRes.status, runText.slice(0, 300));
    const runData = JSON.parse(runText);
    if (!runData.id) throw new Error(runData.detail || 'Errore avvio job');

    const result = await pollJob(runData.id, endpointId);
    const output = result.output;

    // Extract video — RunPod worker-comfyui returns videos as base64 in output.videos[]
    let videoBase64 = null;
    if (output?.videos?.[0]) videoBase64 = output.videos[0];
    else if (output?.video) videoBase64 = output.video;
    else if (typeof output === 'string') videoBase64 = output;

    if (!videoBase64) throw new Error('Nessun video nel risultato');

    if (typeof videoBase64 === 'object') {
      videoBase64 = videoBase64.data || videoBase64.video || Object.values(videoBase64)[0];
    }
    if (typeof videoBase64 !== 'string') throw new Error('Formato video non riconosciuto');

    const base64Data = videoBase64.replace(/^data:video\/\w+;base64,/, '');
    const filename = `${Date.now()}.mp4`;
    const buffer = Buffer.from(base64Data, 'base64');
    const userId = req.user.id;
    const r2Key = `outputs/${userId}/${filename}`;

    const { uploadBuffer, publicUrl } = require('../r2');
    await uploadBuffer(r2Key, buffer, 'video/mp4');

    // Save metadata
    const metaFile = path.join(OUTPUTS_DIR, 'history.json');
    const history = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : [];
    history.unshift({
      filename,
      r2Key,
      type: 'video',
      ts: Date.now(),
      userId,
      ...params
    });
    fs.writeFileSync(metaFile, JSON.stringify(history, null, 2));

    const url = publicUrl(r2Key);
    res.json({ success: true, filename, url });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
