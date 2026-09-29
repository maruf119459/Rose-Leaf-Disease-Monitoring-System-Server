# Rose Field Monitor — Server & ESP32 Firmware

This package contains:
- `server/` — the Node.js/Express backend (MongoDB Atlas, Firebase Admin, Socket.IO, and the ResNet50 disease-detection API), designed to run on Render.
- `esp32/` — the ESP32 Arduino firmware that reads the field sensors and posts readings to the server.

---

## 1. Prerequisites

- Node.js 18+ and npm installed locally (for testing before deploying)
- A MongoDB Atlas cluster (free tier is fine to start)
- A Firebase project with Email/Password authentication enabled
- Python 3.9+ (only needed once, to convert your trained model — see Section 3)
- Arduino IDE (for the ESP32 firmware)
- A Render account (https://render.com)

---

## 2. Server dependency installation

```bash
cd server
npm install
```

This installs everything listed in `package.json`:
`express`, `socket.io`, `mongoose`, `firebase-admin`, `@tensorflow/tfjs-node`, `multer`, `helmet`, `compression`, `express-rate-limit`, `cors`, `morgan`, `dotenv`, `uuid`.

> `@tensorflow/tfjs-node` downloads a prebuilt native binary during install. This is normal and can take a few minutes.

---

## 3. Converting your trained ResNet50 model for the server

The server runs your model using TensorFlow.js in Node.js, **not** Python. Your trained `ResNet50_rose_disease.h5` file must be converted once before it can be used here.

```bash
pip install tensorflow tensorflowjs --break-system-packages

# 1. Strip the Lambda preprocessing layer (see the script's docstring for why)
python server/scripts/export_for_tfjs.py

# 2. Convert the resulting deploy model to TensorFlow.js format
tensorflowjs_converter --input_format=keras resnet50_deploy.h5 tfjs_model/

# 3. Move the generated folder into the server
mv tfjs_model server/inference/tfjs_model
```

After this, `server/inference/tfjs_model/` should contain `model.json` and one or more `group1-shard*.bin` files.

---

## 4. Environment variables

```bash
cd server
cp .env.example .env
```

Fill in `.env`:

| Variable | Where to get it |
|---|---|
| `MONGO_URI` | MongoDB Atlas → Connect → Drivers → copy the connection string, replace `<username>`/`<password>` |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Firebase Console → Project Settings → Service accounts → Generate new private key → paste the **entire file contents as one line** |
| `ALLOWED_ORIGINS` | Your app's Capacitor origin, e.g. `capacitor://localhost` |
| `INFERENCE_WORKERS` | Start with `2`; raise it if your Render plan has more CPU cores |

---

## 5. Running locally (before deploying)

```bash
cd server
npm run dev
```

Visit `http://localhost:5000/health` — you should see `{"status":"ok", ...}`. Watch the terminal for `[Inference] Model ready` before testing the `/api/detect` endpoint.

---

## 6. Hosting the server on Render

1. Push the `server/` folder to a GitHub repository (make sure `tfjs_model/`, `node_modules/`, and `.env` are committed appropriately — see the note below on model file size).
2. In the Render dashboard, click **New +** → **Web Service**.
3. Connect your GitHub repository and select it.
4. Configure the service:
   - **Root Directory:** `server` (if the repo contains more than just the server folder)
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** at least the Starter plan is recommended — `@tensorflow/tfjs-node` inference is CPU-intensive and the free tier's limited resources will make detection slow.
5. Under **Environment**, add every variable from your `.env` file (paste `FIREBASE_SERVICE_ACCOUNT_JSON` as a single-line value exactly as in `.env`).
6. Click **Create Web Service**. Render will install dependencies and start the server; watch the deploy logs for `[Inference] Model ready`.
7. Once live, your server's base URL will look like `https://your-app-name.onrender.com` — use this in the mobile app's API configuration and in the ESP32 firmware (`SERVER_BASE_URL`).

**Note on the model file:** the converted `tfjs_model/` folder can be tens of megabytes. If it exceeds GitHub's per-file limits, use [Git LFS](https://git-lfs.com/) to commit it, or upload it to a storage bucket and have the server download it once on startup instead of bundling it in the repo — either approach works with the existing `MODEL_PATH` environment variable.

---

## 7. Creating a device token for your ESP32

The device token ties sensor readings to the correct user account (per the app's 1 user = 1 device design).

1. Sign up in the mobile app as normal (Firebase account + profile form).
2. The app's signup call to `POST /api/users` returns a `deviceToken` in the response — copy it.
   (Alternatively, call `POST /api/users/me/device-token/regenerate` while logged in to get a fresh one.)
3. Paste this token into the ESP32 sketch (`DEVICE_TOKEN`), described next.

---

## 8. Running the ESP32 code

1. **Install the ESP32 board package:** Arduino IDE → File → Preferences → Additional Board Manager URLs → add:
   `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
   Then Tools → Board → Boards Manager → search "esp32" → install "esp32 by Espressif Systems".
2. **Install required libraries:** Sketch → Include Library → Manage Libraries → install:
   - `DHT sensor library` (by Adafruit)
   - `Adafruit Unified Sensor`
   - `ArduinoJson` (version 6.x)
3. **Open** `esp32/rose_monitor_esp32.ino` in the Arduino IDE.
4. **Edit the configuration block** at the top of the file:
   - `WIFI_SSID` / `WIFI_PASSWORD` — your field WiFi credentials
   - `SERVER_BASE_URL` — your Render URL from Section 6
   - `DEVICE_TOKEN` — the token from Section 7
5. **Select your board:** Tools → Board → ESP32 Arduino → "ESP32 Dev Module" (or the exact variant printed on your board).
6. **Select the port:** Tools → Port → choose the COM/tty port your ESP32 appears on once connected via USB.
7. **Wire the sensors** exactly as described in the comment block at the top of the `.ino` file (also matches the project's circuit diagram): LDR → GPIO34, DHT22 → GPIO4, soil moisture AO/DO → GPIO35/GPIO25, rain module AO/DO → GPIO32/GPIO33.
8. Click **Upload**. Once flashing finishes, open the **Serial Monitor** (115200 baud) to confirm it connects to WiFi and successfully posts a reading (`Server responded: 201`).
9. Power the board from the battery pack (via the buck converter and switch, as wired in the circuit diagram) for field deployment — the USB connection was only needed for programming.

---

## 9. How load is handled

- **Inference worker pool** (`inference/modelWorkerPool.js`): runs the CNN in separate worker threads so one user's disease-detection request never blocks sensor ingestion or other users' requests. Scale `INFERENCE_WORKERS` to your Render instance's CPU count.
- **MongoDB connection pooling** (`config/db.js`): reuses a pool of up to 50 database connections instead of opening one per request.
- **Rate limiting**: a generous global limit on `/api/*`, plus a stricter limit specifically on `/api/detect` since inference is the most expensive operation.
- **Compression + streamed CSV export**: reduces bandwidth and avoids loading an entire history into memory when a user exports data.
- **Stateless design**: no data is written to local disk (images are processed in memory only), so if you need even more capacity later, you can scale to multiple Render instances behind Render's load balancer without any code changes.
