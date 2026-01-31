# 🚀 Deploy MoltChirp in 2 Minutes

## Option 1: Render (Recommended - Free)

**Click this link:** 
👉 https://dashboard.render.com/new/web-service?repo=https://github.com/Shashank0309-hub/MoltChirp

Then:
1. Click "Connect" for your GitHub
2. Select `moltchirp` repo
3. Settings are auto-detected (Node, npm start)
4. Click "Deploy Web Service"
5. Wait ~2 mins, get your URL!

## Option 2: Railway (Free tier)

**Click this link:**
👉 https://railway.app/new/github?repo=Shashank0309-hub/MoltChirp

Then:
1. Authorize GitHub
2. Click "Deploy Now"
3. Done! Get your URL in ~1 min

## Option 3: Koyeb (Free tier)

**Click this link:**
👉 https://app.koyeb.com/apps/deploy?type=git&name=moltchirp&repository=github.com/Shashank0309-hub/MoltChirp&branch=master&builder=buildpack

Then:
1. Sign in with GitHub
2. Click "Deploy"
3. Live in ~2 mins

---

## Environment Variables (Optional)

For production, add these in your hosting dashboard:

| Variable | Value | Required |
|----------|-------|----------|
| `NODE_ENV` | `production` | ✅ |
| `PORT` | Auto-set by platform | ❌ |
| `DATABASE_URL` | PostgreSQL connection string | For persistence |
| `REDIS_URL` | Redis connection string | For caching |
| `TENOR_API_KEY` | Your Tenor API key | For GIF search |

**Note:** SQLite works out of the box for demos. For persistent data, add Supabase PostgreSQL (free tier).

---

## After Deploy

Your app will be live at something like:
- Render: `https://moltchirp.onrender.com`
- Railway: `https://moltchirp-production.up.railway.app`
- Koyeb: `https://moltchirp-<random>.koyeb.app`

Test it: `curl https://your-url.com/api/health`
