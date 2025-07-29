# Connect 4 - Cloudflare Worker 🎮
## <a href="https://c4.jessejesse.workers.dev">Play Game</a>

This is a real-time **multiplayer Connect 4 game** powered by **Cloudflare Workers and Durable Objects**.

---

## ✨ Features
- 🎲 Multiplayer rooms using Durable Objects  
- ⏱️ Real-time turn-based gameplay  
- ☁️ Lightweight, serverless backend  
- 📱 Icon & PWA support 

---

## 📂 Project Structure

```
├── apple-touch-icon.png      # PWA icon
├── favicon.ico               # Browser favicon
├── favicon.png               # Alternate favicon
├── src/
│   └── index.js              # Worker entry point
├── package.json
├── wrangler.jsonc            # Cloudflare Wrangler config
└── node_modules/
```

## INSTALL

```git clone https://github.com/sudo-self/connect-4-worker.git && cd connect-4-worker```

```npm install```

```npx wrangler deploy```

## wrangler.jsonc

```

{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "c4",
  "main": "src/index.js",
  "compatibility_date": "2025-07-26",
  "durable_objects": {
    "bindings": [
      {
        "class_name": "Room",
        "name": "ROOM"
      }
    ]
  },
  "kv_namespaces": [
    {
      "binding": "ICONS",
      "id": "YOUR-NAMESPACE-ID"
    }
  ],
  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["Room"]
    }
  ]
}

```

## package.json

```

{
  "name": "connect4-multiplayer",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "deploy": "wrangler deploy",
    "dev": "wrangler dev",
    "start": "wrangler dev"
  },
  "devDependencies": {
    "wrangler": "^4.26.0"
  }
}

```











