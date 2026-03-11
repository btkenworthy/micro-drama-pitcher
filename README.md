# 🎬 Micro Drama Pitcher

Turn ideas into pitch-ready micro dramas with AI-generated scripts, images, and video.

## Architecture

- **Backend**: Node.js/Express → Amazon Bedrock (Nova) + Twelve Labs
- **Frontend**: React + Vite

## Setup

### 1. Backend
```bash
cd server
cp .env.example .env
# Edit .env with your AWS credentials and Twelve Labs API key
npm install
npm start
```

### 2. Frontend
```bash
cd client
npm install
npm run dev
```

Open http://localhost:5173

## Required Credentials

| Service | What you need |
|---------|--------------|
| Amazon Bedrock | AWS credentials with access to `amazon.nova-lite-v1:0` (text) and `amazon.nova-canvas-v1:0` (image) |
| Twelve Labs | API key from [twelvelabs.io](https://twelvelabs.io) (optional, for video) |

### Enabling Bedrock Models
In the AWS Console → Bedrock → Model access, request access to:
- Amazon Nova Lite (text generation)
- Amazon Nova Canvas (image generation)

## How It Works

1. Enter a micro drama idea
2. Nova Lite generates a structured 3-5 scene script
3. Nova Canvas generates a cinematic image for each scene
4. (Optional) Twelve Labs generates a short video clip
5. Everything is displayed in a pitch-deck style view
