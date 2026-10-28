# 🎬 Micro Drama Pitcher

Turn ideas into pitch-ready micro dramas with AI-generated scripts, images, and video.

## Architecture

- **Backend**: Node.js/Express → Amazon Bedrock (Nova 2 Lite + Stable Image Ultra + Nova Reel)
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
| Amazon Bedrock | AWS credentials with access to `us.amazon.nova-2-lite-v1:0` (text), `stability.stable-image-ultra-v1:1` (image), and `amazon.nova-reel-v1:1` (video) |
| AWS S3 | A bucket in us-east-1 for video output (`S3_VIDEO_BUCKET`) |
| Twelve Labs | API key from [twelvelabs.io](https://twelvelabs.io) (optional, for video) |

### Enabling Bedrock Models
In the AWS Console → Bedrock → Model access, request access to:
- Amazon Nova 2 Lite (text generation)
- Stability Stable Image Ultra (image generation)
- Amazon Nova Reel (video generation)

## How It Works

1. Enter a micro drama idea
2. Nova 2 Lite generates a structured 3-5 scene script
3. Stable Image Ultra generates a cinematic image for each scene
4. (Optional) Nova Reel generates a video clip from the first scene description (text-to-video)
5. Everything is displayed in a pitch-deck style view
