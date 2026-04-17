# izam AI Dashboard

## Deploy in 5 steps

### 1. Install dependencies
```bash
cd izam-dashboard
npm install
```

### 2. Push to GitHub
```bash
git init
git add .
git commit -m "initial"
gh repo create izam-dashboard --private --source=. --push
```
> If you don't have `gh` CLI: create repo manually on github.com, then:
```bash
git remote add origin https://github.com/YOUR_USERNAME/izam-dashboard.git
git push -u origin main
```

### 3. Deploy to Vercel
```bash
npm install -g vercel   # if not installed
vercel
```
Follow the prompts — link to your GitHub repo when asked.

### 4. Add Vercel Blob storage
In your Vercel project dashboard:
- Go to **Storage** tab → **Create Database** → **Blob**
- Name it anything (e.g. `izam-data`)
- Click **Connect to Project**
- This automatically adds `BLOB_READ_WRITE_TOKEN` to your environment variables

### 5. Redeploy
```bash
vercel --prod
```

## Usage
1. Open your deployed URL
2. Click **Upload Batch CSV** → upload `AiPortalBatchItem-DDMMYYYY.csv`
3. Click **Upload Action Log CSV** → upload `AiActionLog-DDMMYYYY.csv`
4. Dashboard updates instantly
5. Next day: upload again — latest version always overwrites the stored files

## Environment Variables (set automatically by Vercel Blob)
| Variable | Description |
|---|---|
| `BLOB_READ_WRITE_TOKEN` | Auto-set when you connect Blob storage |
