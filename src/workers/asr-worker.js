import { pipeline } from '@huggingface/transformers';

const MODEL_ID = 'onnx-community/whisper-tiny.en';

let transcriber = null;

// Transformers.js reports progress per-file (tokenizer, config, onnx weights,
// ...); this aggregates them into a single 0-100 percentage for the UI.
const fileProgress = new Map();

function reportProgress(data) {
  if (data.status === 'progress' && typeof data.total === 'number') {
    fileProgress.set(data.file, { loaded: data.loaded, total: data.total });
  }
  else if (data.status === 'done') {
    const existing = fileProgress.get(data.file);

    if (existing) {
      fileProgress.set(data.file, { loaded: existing.total, total: existing.total });
    }
  }
  else {
    return;
  }

  let loaded = 0;
  let total = 0;

  for (const entry of fileProgress.values()) {
    loaded += entry.loaded;
    total += entry.total;
  }

  const percent = total > 0 ? Math.round((loaded / total) * 100) : 0;
  self.postMessage({ type: 'progress', percent });
}

async function loadModel() {
  if (transcriber) {
    self.postMessage({ type: 'ready' });
    return;
  }

  try {
    transcriber = await pipeline('automatic-speech-recognition', MODEL_ID, {
      device: 'wasm',
      // The default q8 decoder hits a known onnxruntime-web WASM bug
      // ("Missing required scale ... MatMulNBits") on this model's export.
      // fp32 encoder + q4 merged decoder is the documented workaround:
      // https://github.com/huggingface/transformers.js/issues/1707
      dtype: {
        encoder_model: 'fp32',
        decoder_model_merged: 'q4',
      },
      progress_callback: reportProgress,
    });
    self.postMessage({ type: 'ready' });
  }
  catch (err) {
    self.postMessage({ type: 'error', message: err.message });
  }
}

async function transcribe(audio) {
  if (!transcriber) {
    self.postMessage({ type: 'error', message: 'Model is not loaded yet.' });
    return;
  }

  try {
    const output = await transcriber(audio);
    self.postMessage({ type: 'result', text: output.text.trim() });
  }
  catch (err) {
    self.postMessage({ type: 'error', message: err.message });
  }
}

self.onmessage = (event) => {
  const { type } = event.data;

  if (type === 'load') {
    loadModel();
  }
  else if (type === 'transcribe') {
    transcribe(event.data.audio);
  }
};
