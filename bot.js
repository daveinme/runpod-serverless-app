const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

const TELEGRAM_BOT_TOKEN = '***REMOVED***';
const SERVER_URL = 'http://localhost:3000';

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// Per-user session state
const sessions = {};

function getSession(chatId) {
  if (!sessions[chatId]) {
    sessions[chatId] = {
      mode: null,        // 'img' | 'video'
      step: null,        // quale parametro stiamo raccogliendo
      pendingImage: null, // file_id immagine per video
      params: {
        // immagine
        positivePrompt: 'masterpiece, best quality, highly detailed, RAW photo',
        negativePrompt: 'worst quality, low quality, normal quality, lowres, bad anatomy, bad hands, text, watermark',
        width: 512,
        height: 512,
        steps: 20,
        cfg: 7,
        seed: -1,
        checkpoint: 'v1-5-pruned-emaonly.ckpt',
        // video
        prompt: '',
        negativePromptVideo: 'pc game, console game, video game, cartoon, ugly',
        videoWidth: 512,
        videoHeight: 896,
        duration: 10,
        framerate: 25,
        videoSeed: -1,
      }
    };
  }
  return sessions[chatId];
}

// ── Keyboards ──

function mainKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🖼 Genera Immagine', callback_data: 'mode_img' }],
      [{ text: '🎬 Genera Video', callback_data: 'mode_video' }],
      [{ text: '⚙️ Parametri Immagine', callback_data: 'params_img' }, { text: '⚙️ Parametri Video', callback_data: 'params_video' }],
    ]
  };
}

function imgParamsKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '✏️ Prompt positivo', callback_data: 'set_positivePrompt' }],
      [{ text: '🚫 Prompt negativo', callback_data: 'set_negativePrompt' }],
      [{ text: '📐 Width', callback_data: 'set_width' }, { text: '📐 Height', callback_data: 'set_height' }],
      [{ text: '🔢 Steps', callback_data: 'set_steps' }, { text: '🎚 CFG', callback_data: 'set_cfg' }],
      [{ text: '🎲 Seed', callback_data: 'set_seed' }],
      [{ text: '← Indietro', callback_data: 'back_main' }],
    ]
  };
}

function videoParamsKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '✏️ Prompt', callback_data: 'set_prompt' }],
      [{ text: '🚫 Negative', callback_data: 'set_negativePromptVideo' }],
      [{ text: '📐 Width', callback_data: 'set_videoWidth' }, { text: '📐 Height', callback_data: 'set_videoHeight' }],
      [{ text: '⏱ Durata (s)', callback_data: 'set_duration' }, { text: '🎞 FPS', callback_data: 'set_framerate' }],
      [{ text: '🎲 Seed', callback_data: 'set_videoSeed' }],
      [{ text: '← Indietro', callback_data: 'back_main' }],
    ]
  };
}

function formatImgParams(p) {
  return `*Parametri Immagine*\n` +
    `Prompt: \`${p.positivePrompt.substring(0, 60)}...\`\n` +
    `Negative: \`${p.negativePrompt.substring(0, 40)}...\`\n` +
    `Size: \`${p.width}×${p.height}\`\n` +
    `Steps: \`${p.steps}\` · CFG: \`${p.cfg}\` · Seed: \`${p.seed}\``;
}

function formatVideoParams(p) {
  return `*Parametri Video*\n` +
    `Prompt: \`${(p.prompt || '—').substring(0, 60)}\`\n` +
    `Negative: \`${p.negativePromptVideo.substring(0, 40)}...\`\n` +
    `Size: \`${p.videoWidth}×${p.videoHeight}\`\n` +
    `Durata: \`${p.duration}s\` · FPS: \`${p.framerate}\` · Seed: \`${p.videoSeed}\``;
}

// ── /start ──
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, '👋 *Diffusion Studio*\nCosa vuoi generare?', {
    parse_mode: 'Markdown',
    reply_markup: mainKeyboard()
  });
});

// ── /img shortcut ──
bot.onText(/\/img(.*)/, (msg, match) => {
  const chatId = msg.chat.id;
  const s = getSession(chatId);
  const prompt = match[1].trim();
  if (prompt) {
    s.params.positivePrompt = prompt;
    generateImage(chatId, s.params);
  } else {
    s.mode = 'img';
    s.step = 'positivePrompt';
    bot.sendMessage(chatId, '✏️ Inserisci il *prompt positivo*:', { parse_mode: 'Markdown' });
  }
});

// ── /video shortcut ──
bot.onText(/\/video(.*)/, (msg, match) => {
  const chatId = msg.chat.id;
  const s = getSession(chatId);
  const prompt = match[1].trim();
  if (prompt) {
    s.params.prompt = prompt;
    s.mode = 'video';
    bot.sendMessage(chatId, '📸 Invia un\'immagine di partenza (oppure scrivi `skip` per text-to-video):', { parse_mode: 'Markdown' });
    s.step = 'awaitImage';
  } else {
    s.mode = 'video';
    s.step = 'prompt';
    bot.sendMessage(chatId, '✏️ Inserisci il *prompt* per il video:', { parse_mode: 'Markdown' });
  }
});

// ── Callback queries ──
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const s = getSession(chatId);
  const data = query.data;

  bot.answerCallbackQuery(query.id);

  if (data === 'mode_img') {
    s.mode = 'img';
    s.step = 'positivePrompt';
    bot.sendMessage(chatId, '✏️ Inserisci il *prompt positivo* (o /skip per usare quello salvato):', { parse_mode: 'Markdown' });

  } else if (data === 'mode_video') {
    s.mode = 'video';
    s.step = 'prompt';
    bot.sendMessage(chatId, '✏️ Inserisci il *prompt* per il video:', { parse_mode: 'Markdown' });

  } else if (data === 'params_img') {
    bot.sendMessage(chatId, formatImgParams(s.params), {
      parse_mode: 'Markdown',
      reply_markup: imgParamsKeyboard()
    });

  } else if (data === 'params_video') {
    bot.sendMessage(chatId, formatVideoParams(s.params), {
      parse_mode: 'Markdown',
      reply_markup: videoParamsKeyboard()
    });

  } else if (data === 'back_main') {
    bot.sendMessage(chatId, 'Menu principale:', { reply_markup: mainKeyboard() });

  } else if (data.startsWith('set_')) {
    const field = data.replace('set_', '');
    s.step = field;
    const labels = {
      positivePrompt: 'prompt positivo',
      negativePrompt: 'prompt negativo',
      width: 'width (es: 512)',
      height: 'height (es: 512)',
      steps: 'steps (1-150)',
      cfg: 'CFG scale (1-30)',
      seed: 'seed (-1 = random)',
      prompt: 'prompt video',
      negativePromptVideo: 'negative prompt video',
      videoWidth: 'width video (es: 512)',
      videoHeight: 'height video (es: 896)',
      duration: 'durata in secondi (2-30)',
      framerate: 'frame rate (8-50)',
      videoSeed: 'seed (-1 = random)',
    };
    bot.sendMessage(chatId, `✏️ Inserisci ${labels[field] || field}:`);
  }
});

// ── Text messages ──
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const s = getSession(chatId);

  // Ignora comandi
  if (msg.text && msg.text.startsWith('/')) return;

  // Gestione immagine inviata per video
  if (msg.photo && s.mode === 'video' && s.step === 'awaitImage') {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    s.pendingImage = fileId;
    s.step = 'readyVideo';
    bot.sendMessage(chatId, '✅ Immagine ricevuta. Genero il video...', { reply_markup: { remove_keyboard: true } });
    await generateVideo(chatId, s.params, fileId);
    return;
  }

  if (!msg.text) return;
  const text = msg.text.trim();

  // Nessun step attivo
  if (!s.step) {
    bot.sendMessage(chatId, 'Usa /start per il menu, /img <prompt> per un\'immagine, /video <prompt> per un video.');
    return;
  }

  // Step: prompt immagine
  if (s.step === 'positivePrompt') {
    if (text.toLowerCase() !== 'skip') s.params.positivePrompt = text;
    s.step = null;
    await generateImage(chatId, s.params);
    return;
  }

  // Step: prompt video
  if (s.step === 'prompt') {
    s.params.prompt = text;
    s.step = 'awaitImage';
    bot.sendMessage(chatId, '📸 Invia un\'immagine di partenza (oppure scrivi `skip` per text-to-video):', { parse_mode: 'Markdown' });
    return;
  }

  // Step: attesa immagine per video
  if (s.step === 'awaitImage') {
    if (text.toLowerCase() === 'skip') {
      s.step = null;
      s.pendingImage = null;
      await generateVideo(chatId, s.params, null);
    }
    return;
  }

  // Step: modifica parametri
  if (s.step) {
    const numFields = ['width', 'height', 'steps', 'cfg', 'seed', 'videoWidth', 'videoHeight', 'duration', 'framerate', 'videoSeed'];
    if (numFields.includes(s.step)) {
      const val = parseFloat(text);
      if (isNaN(val)) { bot.sendMessage(chatId, '⚠️ Valore non valido, inserisci un numero.'); return; }
      s.params[s.step] = val;
    } else {
      s.params[s.step] = text;
    }
    const isVideoParam = ['prompt', 'negativePromptVideo', 'videoWidth', 'videoHeight', 'duration', 'framerate', 'videoSeed'].includes(s.step);
    s.step = null;
    bot.sendMessage(chatId, '✅ Parametro salvato.', {
      reply_markup: isVideoParam ? videoParamsKeyboard() : imgParamsKeyboard()
    });
  }
});

// ── Generate image ──
async function generateImage(chatId, params) {
  const msg = await bot.sendMessage(chatId, '⏳ Generazione immagine in corso...');
  try {
    const res = await fetch(`${SERVER_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        positivePrompt: params.positivePrompt,
        negativePrompt: params.negativePrompt,
        width: params.width,
        height: params.height,
        steps: params.steps,
        cfg: params.cfg,
        seed: params.seed,
        checkpoint: params.checkpoint,
      })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    const imgPath = path.join(__dirname, 'public', data.url);
    await bot.deleteMessage(chatId, msg.message_id);
    await bot.sendPhoto(chatId, imgPath, {
      caption: `✅ *${params.width}×${params.height}* · ${params.steps} steps · CFG ${params.cfg}\n\`${params.positivePrompt.substring(0, 100)}\``,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔄 Rigenera', callback_data: 'mode_img' }, { text: '🎬 Crea Video', callback_data: 'mode_video' }],
          [{ text: '🏠 Menu', callback_data: 'back_main' }]
        ]
      }
    });
  } catch (err) {
    bot.editMessageText(`❌ Errore: ${err.message}`, { chat_id: chatId, message_id: msg.message_id });
  }
}

// ── Generate video ──
async function generateVideo(chatId, params, imageFileId) {
  const msg = await bot.sendMessage(chatId, '⏳ Generazione video in corso... (può richiedere diversi minuti)');
  try {
    const form = new FormData();
    form.append('prompt', params.prompt || '');
    form.append('negativePrompt', params.negativePromptVideo);
    form.append('width', params.videoWidth);
    form.append('height', params.videoHeight);
    form.append('duration', params.duration);
    form.append('framerate', params.framerate);
    form.append('seed', params.videoSeed);
    form.append('textToVideo', imageFileId ? 'false' : 'true');

    if (imageFileId) {
      const fileLink = await bot.getFileLink(imageFileId);
      const imgRes = await fetch(fileLink);
      const imgBuffer = await imgRes.buffer();
      form.append('image', imgBuffer, { filename: 'input.jpg', contentType: 'image/jpeg' });
    }

    const res = await fetch(`${SERVER_URL}/api/generate-video`, {
      method: 'POST',
      body: form,
      headers: form.getHeaders()
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    const videoPath = path.join(__dirname, 'public', data.url);
    await bot.deleteMessage(chatId, msg.message_id);
    await bot.sendVideo(chatId, videoPath, {
      caption: `✅ *${params.videoWidth}×${params.videoHeight}* · ${params.duration}s · ${params.framerate}fps\n\`${(params.prompt || '').substring(0, 100)}\``,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔄 Rigenera', callback_data: 'mode_video' }],
          [{ text: '🏠 Menu', callback_data: 'back_main' }]
        ]
      }
    });
  } catch (err) {
    bot.editMessageText(`❌ Errore: ${err.message}`, { chat_id: chatId, message_id: msg.message_id });
  }
}

console.log('🤖 Bot Telegram avviato');
