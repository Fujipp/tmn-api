import express from "express";
import cors from "cors";
import { chromium } from "playwright";

const app = express();
app.use(cors());
app.use(express.json());

const API_KEY = process.env.API_KEY || ""; // ใส่คีย์ไว้ป้องกันสาธารณะได้

let browser;
async function ensureBrowser() {
  if (browser && browser.isConnected()) return browser;
  browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  return browser;
}

app.get("/healthz", (req, res) => res.send("ok"));

app.get("/tmw/test", async (req, res) => {
  try {
    const b = await ensureBrowser();
    const page = await b.newPage({ locale: "th-TH" });
    await page.goto("https://example.com", { waitUntil: "domcontentloaded", timeout: 30000 });
    const title = await page.title();
    res.json({ ok: true, title });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/** ตรวจสอบยอดก่อนแลก */
app.post("/tmw/verify", async (req, res) => {
  try {
    if (API_KEY && req.get("x-api-key") !== API_KEY) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }
    const voucherUrl = req.body?.voucherUrl;
    const phone = String(req.body?.mobile || "").replace(/\D/g, "");
    if (!voucherUrl) return res.status(400).json({ ok: false, error: "missing voucherUrl" });
    if (phone.length !== 10) return res.status(400).json({ ok: false, error: "mobile must be 10 digits" });

    const hash = (() => { try { return new URL(voucherUrl).searchParams.get("v") || ""; } catch { return ""; } })();
    if (!hash) return res.status(400).json({ ok: false, error: "invalid voucherUrl (no v=…)" });

    const b = await ensureBrowser();
    const context = await b.newContext({
      locale: "th-TH",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();
    await page.setExtraHTTPHeaders({
      "Accept-Language": "th-TH,th;q=0.9,en-US;q=0.8,en;q=0.7",
      "DNT": "1",
    });

    await page.goto(`https://gift.truemoney.com/campaign/?v=${hash}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector("body", { timeout: 30000 });
    await page.waitForTimeout(800);

    const ver = await page.evaluate(async ({ hash, phone }) => {
      const r = await fetch(`/campaign/vouchers/${hash}/verify?mobile=${phone}`, {
        method: "GET",
        headers: { "Accept": "application/json, text/plain, */*" },
        credentials: "include",
      });
      const txt = await r.text();
      try { return { ok: r.ok, json: JSON.parse(txt), status: r.status }; }
      catch { return { ok: false, json: { _nonjson: true, text: txt.slice(0, 700) }, status: r.status }; }
    }, { hash, phone });

    await context.close();

    if (!ver.ok) return res.status(400).json({ ok: false, error: `verify HTTP ${ver.status}`, raw: ver.json });
    if (ver.json?._nonjson) return res.status(502).json({ ok: false, error: "verify non-JSON", raw: ver.json });

    const amount = Number(ver.json?.data?.amount_baht ?? ver.json?.amount ?? 0);
    res.json({ ok: true, amount_baht: amount, raw: ver.json });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e).slice(0, 400) });
  }
});

/** แลกอั่งเปา */
app.post("/tmw/redeem", async (req, res) => {
  try {
    // Optional auth
    if (API_KEY && req.get("x-api-key") !== API_KEY) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    const voucherUrl = req.body?.voucherUrl;
    const phone = String(req.body?.mobile || "").replace(/\D/g, "");
    if (!voucherUrl) return res.status(400).json({ ok: false, error: "missing voucherUrl" });
    if (phone.length !== 10) return res.status(400).json({ ok: false, error: "mobile must be 10 digits" });

    let hash = "";
    try { hash = new URL(voucherUrl).searchParams.get("v") || ""; } catch {}
    if (!hash) return res.status(400).json({ ok: false, error: "invalid voucherUrl (no v=…)" });

    const b = await ensureBrowser();
    const context = await b.newContext({
      locale: "th-TH",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();
    await page.setExtraHTTPHeaders({
      "Accept-Language": "th-TH,th;q=0.9,en-US;q=0.8,en;q=0.7",
      "DNT": "1",
    });

    // เปิดหน้า voucher ก่อน ให้สคริปต์ตั้งคุกกี้
    await page.goto(`https://gift.truemoney.com/campaign/?v=${hash}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector("body", { timeout: 30000 });
    await page.waitForTimeout(1200);

    // ยิง configuration -> verify -> redeem ใน origin เดียวกัน พร้อม credentials
    const result = await page.evaluate(async ({ hash, phone }) => {
      const common = {
        headers: {
          "Accept": "application/json, text/plain, */*",
          "X-Requested-With": "XMLHttpRequest",
        },
        credentials: "include",
      };
      async function asJson(url, init) {
        const r = await fetch(url, init);
        const txt = await r.text();
        try { return { ok: r.ok, json: JSON.parse(txt), status: r.status }; }
        catch { return { ok: r.ok, json: { _nonjson: true, text: txt.slice(0, 700) }, status: r.status }; }
      }

      // 1) configuration
      const cfg = await asJson(`/campaign/vouchers/configuration`, { method: "GET", ...common });
      if (!cfg.ok || cfg.json._nonjson) return { step: "configuration", resp: cfg };

      // 2) verify
      const ver = await asJson(`/campaign/vouchers/${hash}/verify?mobile=${phone}`, {
        method: "GET", ...common, referrer: `https://gift.truemoney.com/campaign/?v=${hash}`
      });
      if (!ver.ok || ver.json._nonjson) return { step: "verify", resp: ver };

      // 3) redeem
      const redeem = await asJson(`/campaign/vouchers/${hash}/redeem`, {
        method: "POST",
        headers: { ...common.headers, "Content-Type": "application/json;charset=UTF-8" },
        credentials: "include",
        referrer: "https://gift.truemoney.com/campaign/card",
        body: JSON.stringify({ mobile: phone, voucher_hash: hash }),
      });

      return { step: "redeem", resp: redeem };
    }, { hash, phone });

    await context.close();

    // ตรวจผลและ map ค่าให้ถูกต้อง
    if (result?.resp?.json?._nonjson) {
      return res.status(502).json({ ok: false, error: `${result.step} non-JSON`, raw: result.resp.json });
    }
    if (!result?.resp?.ok) {
      return res.status(400).json({ ok: false, error: `${result.step} HTTP ${result?.resp?.status}`, raw: result.resp.json });
    }

    const jr = result.resp.json;

    // ✅ TrueMoney ใช้รูปแบบ status เป็น object { code, message }
    const okCode = jr?.status?.code === "SUCCESS";
    if (!okCode) {
      return res.status(400).json({
        ok: false,
        error: jr?.status?.message || "redeem failed",
        raw: jr,
      });
    }

    // ดึงข้อมูลยอดจาก my_ticket ถ้าได้, ไม่งั้นลองฟิลด์อื่น
    const amount =
      Number(jr?.data?.my_ticket?.amount_baht ??
             jr?.data?.amount_baht ??
             jr?.amount ?? 0);

    // สถานะคูปองเพื่อกันบวกซ้ำ
    const v = jr?.data?.voucher || {};
    const total = Number(v?.amount_baht || 0);
    const redeemedAmt = Number(v?.redeemed_amount_baht || 0);
    const alreadyRedeemed = v?.available === 0 || redeemedAmt >= total;

    return res.json({
      ok: true,
      amount_baht: amount,
      voucher_id: v?.voucher_id || null,
      link: v?.link || null,
      redeemed: Boolean(v?.redeemed),
      available: v?.available,
      already_redeemed: alreadyRedeemed,
      raw: jr,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e).slice(0, 400) });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("API on :" + PORT));
