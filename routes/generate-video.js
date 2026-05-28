const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { RUNPOD_API_KEY, ENDPOINTS } = require('../config');
const { insert: insertGeneration } = require('../generations');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
const BASE_WORKFLOW = JSON.parse(fs.readFileSync(path.join(__dirname, '../api-workflow.json'), 'utf8'));

function buildVideoWorkflow(params, imageFilename) {
  const { prompt, negativePrompt, width, height, duration, framerate, seed, textToVideo } = params;
  const actualSeed = seed === -1 ? Math.floor(Math.random() * 2 ** 32) : seed;

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
  workflow["377"].inputs.image = imageFilename || 'example.png';

  return workflow;
}

async function pollJob(jobId, endpointId, jobStart) {
  const url = `https://api.runpod.ai/v2/${endpointId}/status/${jobId}`;
  while (true) {
    await new Promise(r => setTimeout(r, 5000));
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${RUNPOD_API_KEY}` }
    });
    const text = await res.text();
    const data = JSON.parse(text);
    if (data.status === 'COMPLETED' || data.status === 'FAILED') {
      const elapsed = Date.now() - jobStart;
      console.log(`[pollJob] ${data.status} — execTime: ${data.executionTime}ms — totalWait: ${elapsed}ms`);
    }
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
    let imageFilename = null;
    if (req.file && !textToVideo) {
      imageBase64 = req.file.buffer.toString('base64');
      imageFilename = `input_${Date.now()}.png`;
    } else if (req.body.imageUrl && !textToVideo) {
      const imgPath = path.join(__dirname, '../public', req.body.imageUrl);
      if (fs.existsSync(imgPath)) {
        imageBase64 = fs.readFileSync(imgPath).toString('base64');
        imageFilename = `input_${Date.now()}.png`;
      }
    }

    const workflow = buildVideoWorkflow(params, imageFilename);
    const requestBody = { input: { workflow } };
    if (imageBase64 && imageFilename) {
      requestBody.input.images = [{ name: imageFilename, image: imageBase64 }];
    }

    const runRes = await fetch(`https://api.runpod.ai/v2/${endpointId}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RUNPOD_API_KEY}` },
      body: JSON.stringify(requestBody)
    });

    const runText = await runRes.text();
    const runData = JSON.parse(runText);
    const jobStart = Date.now();
    console.log(`[generate-video] job queued: ${runData.id}`);
    if (!runData.id) throw new Error(runData.detail || 'Errore avvio job');

    const result = await pollJob(runData.id, endpointId, jobStart);
    const output = result.output;

    // Extract video — handler returns output.outputs[{filename, type, data}]
    let videoBase64 = null;
    if (output?.outputs?.length > 0) {
      const item = output.outputs[0];
      videoBase64 = item.data || null;
    } else if (output?.videos?.[0]) {
      const item = output.videos[0];
      videoBase64 = typeof item === 'string' ? item : item.data;
    } else if (output?.video) {
      videoBase64 = output.video;
    } else if (typeof output === 'string') {
      videoBase64 = output;
    }

    if (!videoBase64) throw new Error('Nessun video nel risultato');
    if (typeof videoBase64 !== 'string') throw new Error('Formato video non riconosciuto');

    const base64Data = videoBase64.replace(/^data:video\/\w+;base64,/, '');
    const filename = `${Date.now()}.mp4`;
    const buffer = Buffer.from(base64Data, 'base64');
    console.log(`[generate-video] video decoded: ${buffer.length} bytes`);
    const userId = req.user.id;
    const userEmail = req.user.email;
    const today = new Date().toISOString().slice(0, 10);
    const r2Key = `outputs/${userEmail}/${today}/${filename}`;

    const { uploadBuffer, publicUrl } = require('../r2');
    console.log(`[generate-video] uploading to R2: ${r2Key}`);
    await uploadBuffer(r2Key, buffer, 'video/mp4');
    const url = publicUrl(r2Key);
    console.log(`[generate-video] uploaded OK: ${url}`);

    insertGeneration({
      userId, filename, r2Key, type: 'video',
      prompt: params.prompt, width: params.width, height: params.height,
      duration: params.duration, framerate: params.framerate
    });

    res.json({ success: true, filename, url });

  } catch (err) {
    console.error('[generate-video] ERROR:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
