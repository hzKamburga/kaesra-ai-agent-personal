# Kaesra AI Agent (Node.js)

Cok amacli bir Node.js AI agent iskeleti:

- Web arastirma (Tavily / SerpAPI / DuckDuckGo fallback)
- Chrome extension + localhost bridge ile tarayici icinden agent kontrolu
- Gorev zamanlama (tek seferlik veya periyodik)
- Masaustu uygulama acma ve opsiyonel shell komutlari
- Sablondan veya AI ile proje olusturma
- Herhangi bir HTTP API ile calisma

## 1) Kurulum

```bash
npm install
cp .env.example .env
```

`.env` icinde en az bir AI provider ayarla:

```env
AI_PROVIDER=openai
AI_MODEL=gpt-4.1-mini
OPENAI_API_KEY=...
```

Opsiyonel bridge/scheduler ayarlari:

```env
BRIDGE_HOST=127.0.0.1
BRIDGE_PORT=3434
BRIDGE_API_TOKEN=
SCHEDULER_TICK_MS=15000
DESKTOP_ALLOW_SHELL=false
```

## 2) Komutlar

### CLI UI (interaktif panel)

```bash
npm run ui
```

UI iceriginde hizli akislar:
- AI ask / chat
- Research
- Task olusturma/listeleme/calistirma/silme
- Chrome bridge hizli aksiyonlari
- Desktop uygulama arama/acma
- API quick call

### Chat ve Ask

```bash
npm run chat
node src/index.js ask "yarin sabah toplantilarimi ozetle"
```

### Arastirma

```bash
npm run research -- "nodejs ai agent"
node src/index.js research "playwright chrome extension" --max-results 8 --summarize
```

### Tarayici otomasyonu (CLI)

```bash
node src/index.js browse --action search --query "nodejs agent"
node src/index.js browse --action extract --url "https://example.com"
node src/index.js browse --action screenshot --url "https://example.com" --output-path artifacts/example.png
```

### Gorev zamanlama

```bash
node src/index.js task list
node src/index.js task create "sabah raporu" "gundem haberlerini ozetle" --run-at "2026-02-10T06:30:00Z"
node src/index.js task create "saatlik kontrol" "mail kutumu ozetle" --interval-ms 3600000
node src/index.js task run <taskId>
```

### Bridge server (Chrome extension icin)

```bash
npm run bridge
```

Alternatif:

```bash
node src/index.js bridge --host 127.0.0.1 --port 3434 --tick-ms 15000
```

### Gercek Chrome sekmesini CLI/AI ile yonetme

Bridge calisirken ve extension yukluyken:

```bash
node src/index.js chrome status
node src/index.js chrome active
node src/index.js chrome navigate https://example.com
node src/index.js chrome open https://news.ycombinator.com
node src/index.js chrome extract --max-chars 5000
node src/index.js chrome scroll --direction down --amount 1200
node src/index.js chrome click-text "Sign in"
node src/index.js chrome send clickSelector --input '{"selector":"a"}'
node src/index.js chrome send fillSelector --input '{"selector":"input#search","value":"guild discord bot altyapisi","pressEnter":true,"submit":true}'
```

Agent tarafindan tool ile kullanmak icin (chat/ask): `chrome_live` tool'u mevcuttur.

### Proje olusturma

```bash
node src/index.js project templates
node src/index.js project scaffold node-api benim-api
node src/index.js project scaffold python-cli veri-analiz-cli --target-dir "D:\\Yeni klasor (4)"
node src/index.js project generate crm-bot "express tabanli CRM API, JWT auth ve SQLite olsun"
node src/index.js project generate casino-sim "python cli kumar simulasyonu" --target-dir "D:\\Yeni klasor (4)"
```

Agent tarafinda proje testlemek icin `project` araci `mode=test` destekler (Python icin `python -m py_compile`, Node icin `node --check`).
Istersen `mode=test` icinde `command` ve `input` da verilebilir (ornek: `python main.py`).
Agent `project` araci ile dis klasorlerde `mode=write|edit|delete` islemleri de yapabilir.

### API cagrisi

```bash
node src/index.js api GET https://api.github.com/repos/nodejs/node
node src/index.js api POST https://httpbin.org/post --body '{"x":1}'
```

### Desktop uygulama yonetimi

Tum yuklu programlari listele:

```bash
node src/index.js desktop apps --installed --limit 500
node src/index.js desktop apps --installed --query "cursor" --refresh
```

Program ac (isimle veya id ile):

```bash
node src/index.js desktop open --app-name "Google Chrome"
node src/index.js desktop open --id "startapp:googlechrome"
node src/index.js desktop open notepad.exe
node src/index.js desktop open --app-name "cursor" --refresh
```

Not: Windows envanteri Start Menu + Registry + App Paths + PATH kaynaklarini kullanir.
`--query` sonucu bos donerse hedefe ozel derin tarama (deep scan) yapilir. Gerekirse `--no-deep-scan` ile kapatabilirsin.

Shell komutu calistir (opsiyonel, tehlikeli):

```bash
node src/index.js desktop shell "Get-Date"
```

## 3) Chrome Extension

- Klasor: `chrome-extension/`
- Kurulum:
1. `npm run bridge` ile bridge'i baslat.
2. Chrome -> `chrome://extensions` -> `Developer mode` ac.
3. `Load unpacked` -> `chrome-extension/` klasorunu sec.
4. Eklenti popup'inda bridge URL/token ayarini yap.
5. Extension kodu degistiyse `chrome://extensions` ekranindan eklentiyi `Reload` et.

Popup ozellikleri:
- Chat bar uzerinden ajana prompt gonderme
- Aktif sekmeyi ozetletme
- Gorev olusturma/listeleme/simdi calistirma
- Masaustu uygulamasi acma
- CLI/AI komutlari geldiginde izin penceresi (izin ver/reddet/bir daha sorma)

## 4) Mimari

- `src/index.js`: CLI giris noktasi
- `src/agent/`: Tool-calling agent
- `src/llm/`: Provider soyutlamasi
- `src/tools/`: research, browser, api, project, file, desktop, scheduler
- `src/services/`: bridge server + task store + scheduler daemon
- `chrome-extension/`: Chrome eklentisi

## 5) Guvenlik Notlari

- `desktop` shell komutu varsayilan olarak kapali (`DESKTOP_ALLOW_SHELL=false`).
- Shell komutlarini acarsan agent bilgisayarda komut calistirabilir; sadece guvendigin promptlari kullan.
- Bridge'e token koymak icin `.env` icinde `BRIDGE_API_TOKEN` ayarla.
- `file` araci workspace disina yazamaz.

## 6) Hizli test

```bash
npm run check
node src/index.js tools
node src/index.js task list
```
