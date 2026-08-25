const MODEL_ID = 'gemini-3.1-flash-image';
const GEMINI_INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';

// Wraps the user's spoken description into a panorama-generation prompt.
// Kept server-side so the client only ever sends/receives plain text/images.
const SYSTEM_PROMPT =
  'You are generating an immersive background environment for a virtual reality experience. ' +
  'Create a seamless 360-degree equirectangular panorama photograph of the following scene, ' +
  'as if the viewer is standing in the middle of it. The image must wrap around continuously, ' +
  'with the content at the far left edge matching up with the content at the far right edge so ' +
  'there is no visible seam. Do not include any text, watermark, logos, UI elements, or people ' +
  'looking directly at the camera. Scene description: ';

function jsonResponse(body, status, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

function getAllowedOrigins() {
  return (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export default async (req) => {
  // This calls a paid image model, so cross-origin access is locked down to
  // an explicit allowlist (ALLOWED_ORIGINS) rather than left open.
  const allowedOrigins = getAllowedOrigins();
  const origin = req.headers.get('origin');
  const originAllowed = Boolean(origin) && allowedOrigins.includes(origin);

  if (req.method === 'OPTIONS') {
    if (!originAllowed) {
      return new Response(null, { status: 403 });
    }

    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (!originAllowed) {
    return jsonResponse({ error: 'Origin not allowed.' }, 403);
  }

  const corsHeaders = { 'Access-Control-Allow-Origin': origin };

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405, corsHeaders);
  }

  const apiKey = process.env.GEMINI_KEY;

  if (!apiKey) {
    return jsonResponse({ error: 'Server is missing the GEMINI_KEY environment variable.' }, 500, corsHeaders);
  }

  let prompt = '';

  try {
    const body = await req.json();
    prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  }
  catch {
    // Falls through to the empty-prompt check below.
  }

  if (!prompt) {
    return jsonResponse({ error: 'Missing "prompt" in request body.' }, 400, corsHeaders);
  }

  let geminiResponse;

  try {
    geminiResponse = await fetch(GEMINI_INTERACTIONS_URL, {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL_ID,
        input: [{ type: 'text', text: `${SYSTEM_PROMPT}${prompt}` }],
        response_format: {
          type: 'image',
          mime_type: 'image/jpeg',
          // Widest ratio the model supports; closest available match to the
          // 2:1 an equirectangular panorama would ideally use.
          aspect_ratio: '21:9',
          image_size: '2K',
        },
      }),
    });
  }
  catch (err) {
    return jsonResponse({ error: `Failed to reach Gemini API: ${err.message}` }, 502, corsHeaders);
  }

  const data = await geminiResponse.json();

  if (!geminiResponse.ok) {
    const message = data?.error?.message || JSON.stringify(data);
    return jsonResponse({ error: `Gemini API error: ${message}` }, geminiResponse.status, corsHeaders);
  }

  // Prefer the SDK-documented convenience field; fall back to scanning the
  // raw step output in case the REST shape differs from it.
  const image =
    data.output_image ??
    data.steps?.flatMap((step) => step.content ?? []).find((part) => part.type === 'image');

  if (!image?.data) {
    return jsonResponse({ error: 'Gemini response did not include an image.', raw: data }, 502, corsHeaders);
  }

  return jsonResponse({ data: image.data, mimeType: image.mime_type ?? 'image/jpeg' }, 200, corsHeaders);
};
