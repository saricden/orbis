# ![Orbis - XR Environment Generator](https://saricden.com/assets/orbis-og.jpg)

A simple XR project designed to run in the Quest 3 headset's browser. Describe the environment you wish to be in to bring it to life around you using a local speech-to-text model for dictation and Google's Nano Banana 2 model for panoramic image generation. Not publicly hosted due to high API usage costs for image generation.

## App features

- Setup view w/ local model installer
- Speech to text to describe your scene
- Spherical image generation rendered in 3D VR space

## Tech stack

- Three.js 3D rendering
- WebXR interaction
- Transformers.js local model on a web worker
- onnx-community/whisper-tiny.en model for dictation

## Installing locally

```bash
git clone git@github.com:saricden/orbis.git
cd orbis
npm install
```

Copy `.env.example` to `.env` and update the following values:

```
# API key for Google Gemini
GEMINI_KEY=
# Comma-separated list of origins allowed to call the panorama-generation
# function (it calls a paid model, so this is locked down deliberately).
ALLOWED_ORIGINS=
# Optional password protection (true/false, desired password)
REQUIRE_PASSWORD=
APP_PASSWORD=
```

## Notes on AI usage

I want to note for the sake of transparency that much of this project was coded using Claude Code Sonnet 5. I wrote about my shifting views on agentic coding [here](https://saricden.com/from-skepticism-to-cautious-optimism-my-foray-into-coding-agents/).
