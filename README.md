# InstruMap — Deployment Guide

## Prerequisites

- Docker Desktop installed and running
- Google Vision API credentials file (`google_credentials.json`)

## Setup

1. Copy `.env.example` to `.env`:
   ```
   cp .env.example .env
   ```

2. Place your Google Vision API credentials file in this folder:
   ```
   MTO/google_credentials.json
   ```

3. Build and start all services:
   ```
   docker compose up --build
   ```

4. Open the app in your browser:
   ```
   http://localhost
   ```

## How to use

1. **(Optional) Enter project details** — click "Project Details" in the left sidebar to fill in project name, client, etc. These appear on the Excel deliverables.

2. **Open P&ID** — click "Open Files" and select one or more PDF drawings.

3. **Set reference point** — click on any instrument circle in the drawing to set the calibration reference.

4. **Extract & Download** — click the "Extract & Download" button. The results ZIP (Excel files) downloads automatically when processing is complete.

## Stopping

```
docker compose down
```

To also remove stored data (batch results, Redis data):
```
docker compose down -v
```

## Updating

Pull the latest files and rebuild:
```
docker compose up --build
```
