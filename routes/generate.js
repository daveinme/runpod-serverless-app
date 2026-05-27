const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { RUNPOD_API_KEY, ENDPOINTS } = require('../config');
const RUNPOD_ENDPOINT_ID = ENDPOINTS.image;

const router = express.Router();
const OUTPUTS_DIR = path.join(__dirname, '../public/outputs');

function buildWorkflow(params) {
  const { positivePrompt, negativePrompt, width, height, steps, cfg, seed, checkpoint } = params;
  const actualSeed = seed === -1 ? Math.floor(Math.random() * 2 ** 32) : seed;

  return {
    "3": {
      "inputs": {
        "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0],
        "latent_image": ["5", 0], "seed": actualSeed,
        "steps": steps, "cfg": cfg,
        "sampler_name": "euler", "scheduler": "normal", "denoise": 1
      },
      "class_type": "KSampler"
    },
    "4": {
      "inputs": { "ckpt_name": checkpoint },
      "class_type": "CheckpointLoaderSimple"
    },
    "5": {
      "inputs": { "width": width, "height": height, "batch_size": 1 },
      "class_type": "EmptyLatentImage"
    },
    "6": {
      "inputs": { "clip": ["4", 1], "text": positivePrompt },
      "class_type": "CLIPTextEncode"
    },
    "7": {
      "inputs": { "clip": ["4", 1], "text": negativePrompt },
      "class_type": "CLIPTextEncode"
    },
    "8": { "inputs": { "samples": ["3", 0], "vae": ["4", 2] }, "class_type": "VAEDecode" },
    "9": { "inputs": { "images": ["8", 0], "filename_prefix": "ComfyUI" }, "class_type": "SaveImage" }
  };
}

async function pollJob(jobId) {
  const url = `https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}/status/${jobId}`;
  while (true) {
    await new Promise(r => setTimeout(r, 3000));
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${RUNPOD_API_KEY}` }
    });
    const data = await res.json();
    if (data.status === 'COMPLETED') return data;
    if (data.status === 'FAILED') throw new Error(data.error || 'Job fallito');
  }
}

router.post('/generate', async (req, res) => {
  try {
    const params = {
      positivePrompt: req.body.positivePrompt || 'beautiful scenery',
      negativePrompt: req.body.negativePrompt || 'text, watermark',
      width: parseInt(req.body.width) || 512,
      height: parseInt(req.body.height) || 512,
      steps: parseInt(req.body.steps) || 20,
      cfg: parseFloat(req.body.cfg) || 7,
      seed: parseInt(req.body.seed) ?? -1,
      checkpoint: req.body.checkpoint || 'v1-5-pruned-emaonly.ckpt',
    };

    // Avvia job su RunPod
    const runRes = await fetch(`https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RUNPOD_API_KEY}`
      },
      body: JSON.stringify({ input: { workflow: buildWorkflow(params) } })
    });

    const runData = await runRes.json();
    if (!runData.id) throw new Error(runData.detail || 'Errore avvio job');

    // Attendi risultato
    const result = await pollJob(runData.id);
    const output = result.output;

    let imgBase64 = null;
    if (output?.images?.[0]) imgBase64 = output.images[0];
    else if (output?.message) imgBase64 = output.message;
    else if (typeof output === 'string') imgBase64 = output;

    if (!imgBase64) throw new Error('Nessuna immagine nel risultato');

    let base64String = imgBase64;
    if (typeof imgBase64 === 'object') base64String = imgBase64.data || imgBase64.image || Object.values(imgBase64)[0];
    if (typeof base64String !== 'string') throw new Error('Formato immagine non riconosciuto');

    const base64Data = base64String.replace(/^data:image\/\w+;base64,/, '');
    const filename = `${Date.now()}.png`;
    const filepath = path.join(OUTPUTS_DIR, filename);
    fs.writeFileSync(filepath, Buffer.from(base64Data, 'base64'));

    // Salva metadati
    const metaFile = path.join(OUTPUTS_DIR, 'history.json');
    const history = fs.existsSync(metaFile)
      ? JSON.parse(fs.readFileSync(metaFile, 'utf8'))
      : [];

    history.unshift({
      filename,
      ts: Date.now(),
      userId: req.user?.id,
      ...params
    });

    fs.writeFileSync(metaFile, JSON.stringify(history, null, 2));

    res.json({ success: true, filename, url: `/outputs/${filename}` });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
