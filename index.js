// collector/index.js
// ORÁCULO COLLECTOR — MULTI-MESAS (74+)
// Lê todas as mesas do GamblingCounting e envia para ORÁCULO API

import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

puppeteer.use(StealthPlugin());

/* =========================
   CONFIG
========================= */

const TARGET_URL = "https://gamblingcounting.com/roulette";
const POLL_INTERVAL = 1500; // 1.5s
const SCROLL_INTERVAL = 60 * 1000; // 1 minuto

// URL da sua API do Oráculo no Render:
const ORACULO_API_URL = process.env.ORACULO_API_URL || "https://oraculo-api-vqn8.onrender.com";

// Endpoint correto:
const ENDPOINT_EVENTO = `${ORACULO_API_URL}/oraculo/evento`;

/* =========================
   CONTROLE
========================= */

const LAST_NUMBER_BY_MESA = new Map();
const MESAS_VISTAS = new Set();

/* =========================
   HELPERS
========================= */

async function sendToOracle(payload) {
  try {
    const res = await fetch(ENDPOINT_EVENTO, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      console.log("❌ Erro ao enviar evento:", res.status);
    }
  } catch (err) {
    console.log("❌ Falha no envio para API:", err.message);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* =========================
   BOOT
========================= */

console.log("🚀 [COLLECTOR] Iniciando coletor multi-mesas...");
console.log("🌐 URL alvo:", TARGET_URL);
console.log("🔗 API destino:", ENDPOINT_EVENTO);

const browser = await puppeteer.launch({
  headless: false,
  defaultViewport: null,
  args: [
    "--disable-blink-features=AutomationControlled",
    "--no-sandbox",
    "--disable-setuid-sandbox"
  ]
});

const page = await browser.newPage();

await page.setUserAgent(
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
);

await page.setViewport({ width: 1366, height: 768 });

console.log("🟢 [COLLECTOR] Abrindo site...");
await page.goto(TARGET_URL, { waitUntil: "domcontentloaded" });

console.log("⚠️ [COLLECTOR] IMPORTANTE:");
console.log("👉 Clique MANUALMENTE em: Show All (98)");
console.log("👉 Depois disso o coletor começa a ler tudo sozinho.");

/* =========================
   SCROLL KEEP ALIVE
========================= */

setInterval(async () => {
  try {
    console.log("🌀 [SCROLL] Keep-alive scroll...");
    await page.evaluate(async () => {
      await new Promise(resolve => {
        const total = document.body.scrollHeight;
        let pos = window.scrollY;

        const step = 300;
        const timer = setInterval(() => {
          window.scrollBy(0, step);
          pos += step;

          if (pos >= total) {
            clearInterval(timer);
            window.scrollTo(0, 0);
            resolve();
          }
        }, 100);
      });
    });
  } catch (err) {
    console.warn("⚠️ [SCROLL] Falha:", err.message);
  }
}, SCROLL_INTERVAL);

/* =========================
   FRAME DETECTOR
========================= */

async function getLiveFrame() {
  const frames = page.frames();

  for (const frame of frames) {
    try {
      const ok = await frame.$(".live-game__block__last__roulette");
      if (ok) {
        console.log("✅ [COLLECTOR] Frame correto encontrado!");
        return frame;
      }
    } catch {}
  }

  return null;
}

/* =========================
   READ MESAS
========================= */

async function readMesas(frame) {
  try {
    return await frame.evaluate(() => {
      const mesas = [];
      const blocks = document.querySelectorAll(".live-game__block");

      blocks.forEach((block, index) => {
        const roulette = block.querySelector(".live-game__block__last__roulette");
        if (!roulette) return;

        const first = roulette.querySelector(".roulette-number");
        if (!first) return;

        const txt = first.textContent?.trim();
        const numero = parseInt(txt, 10);
        if (Number.isNaN(numero)) return;

        const titleEl = block.querySelector(".live-game__block__title__text");

        const mesaNome = titleEl ? titleEl.innerText.trim() : `Mesa ${index}`;
        const mesaId = block.id ? block.id.trim() : `mesa_${index}`;

        mesas.push({
          mesaId,
          mesaNome,
          numero
        });
      });

      return mesas;
    });
  } catch {
    return [];
  }
}

/* =========================
   START
========================= */

let frame = null;

while (!frame) {
  frame = await getLiveFrame();
  if (!frame) await sleep(1000);
}

/* =========================
   LOOP
========================= */

console.log("🔥 [COLLECTOR] Iniciando leitura contínua...");

while (true) {
  const mesas = await readMesas(frame);

  if (!mesas.length) {
    console.log("⚠️ [COLLECTOR] Nenhuma mesa encontrada ainda...");
    await sleep(POLL_INTERVAL);
    continue;
  }

  console.log(`📡 [COLLECTOR] Mesas detectadas: ${mesas.length}`);

  for (const mesa of mesas) {
    const last = LAST_NUMBER_BY_MESA.get(mesa.mesaId);

    if (last === mesa.numero) {
      continue;
    }

    LAST_NUMBER_BY_MESA.set(mesa.mesaId, mesa.numero);
    MESAS_VISTAS.add(mesa.mesaId);

    console.log(
      "🎰 [MESA]",
      mesa.mesaId,
      "|",
      mesa.mesaNome,
      "→",
      mesa.numero,
      "| únicas:",
      MESAS_VISTAS.size
    );

    // ENVIA EVENTO PARA ORÁCULO API
    await sendToOracle({
      mesaId: mesa.mesaId,
      mesaNome: mesa.mesaNome,
      ultimoNumero: mesa.numero
    });
  }

  await sleep(POLL_INTERVAL);
}
