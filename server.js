// server.js — Understudy backend for Replit
// Handles: (1) proxying Gemini calls so the API key never reaches the browser
//          (2) a free-trial counter + Stripe paywall gate
// Using Google's Gemini free tier (no cost, no card) instead of a paid API.

const express = require("express");
const cors = require("cors");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const Stripe = require("stripe");
const Database = require("@replit/database");

const app = express();
const db = new Database();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Calls Gemini's free tier. `messages` is [{role: "user"|"assistant", content}],
// same shape the frontend already sends — this just translates it.
async function callGemini(messages, system, maxTokens) {
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: system,
    generationConfig: { maxOutputTokens: maxTokens },
  });
  const history = messages.slice(0, -1).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const chat = model.startChat({ history });
  const result = await chat.sendMessage(messages[messages.length - 1].content);
  return result.response.text();
}

const FREE_REHEARSALS = 3; // how many free debriefs before paywall kicks in
const PRICE_ID = process.env.STRIPE_PRICE_ID; // from Stripe dashboard, e.g. price_123

// Stripe webhook needs the raw body, so it's declared BEFORE express.json()
app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        req.headers["stripe-signature"],
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      return res.status(400).send(`Webhook error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const email = session.customer_details?.email;
      if (email) {
        await db.set(`paid:${email}`, true);
        // remember which email this Stripe customer belongs to, so later
        // subscription events (which only include a customer id) can find them
        await db.set(`customer:${session.customer}`, email);
      }
    }

    // Fires when a subscription is canceled (immediately, or at period end
    // depending on your Stripe settings) — this is the auto-revoke.
    if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object;
      const email = await db.get(`customer:${subscription.customer}`);
      if (email) {
        await db.set(`paid:${email}`, false);
      }
    }

    // Fires on renewal/status changes — covers failed payments (card declined,
    // expired card, etc.) where Stripe marks the subscription past_due/unpaid/
    // canceled without a separate "deleted" event.
    if (event.type === "customer.subscription.updated") {
      const subscription = event.data.object;
      const email = await db.get(`customer:${subscription.customer}`);
      if (email) {
        const stillActive = ["active", "trialing"].includes(subscription.status);
        await db.set(`paid:${email}`, stillActive);
      }
    }
    res.json({ received: true });
  }
);

app.use(cors());
app.use(express.json());

// --- Helper: has this user paid or still have free tries left? ---
async function canUseApp(email) {
  if (email) {
    const paid = await db.get(`paid:${email}`);
    if (paid) return { allowed: true, paid: true };
  }
  const key = `trials:${email || "anon"}`;
  const used = (await db.get(key)) || 0;
  if (used < FREE_REHEARSALS) return { allowed: true, paid: false, used };
  return { allowed: false, paid: false, used };
}

// --- Roleplay turn ---
app.post("/api/chat", async (req, res) => {
  const { messages, system, email } = req.body;
  const status = await canUseApp(email);
  if (!status.allowed) {
    return res.status(402).json({ error: "paywall", message: "Free rehearsals used up." });
  }

  try {
    const text = await callGemini(messages, system, 300);
    res.json({ text });
  } catch (err) {
    res.status(500).json({ error: "model_error", message: err.message });
  }
});

// --- Debrief (counts as the "use" that consumes a free trial) ---
app.post("/api/debrief", async (req, res) => {
  const { messages, system, email } = req.body;
  const status = await canUseApp(email);
  if (!status.allowed) {
    return res.status(402).json({ error: "paywall", message: "Free rehearsals used up." });
  }

  try {
    const text = await callGemini(messages, system, 900);

    // consume a free trial only if not already paid
    if (!status.paid) {
      const key = `trials:${email || "anon"}`;
      await db.set(key, (status.used || 0) + 1);
    }

    res.json({ text });
  } catch (err) {
    res.status(500).json({ error: "model_error", message: err.message });
  }
});

// --- Create a Stripe Checkout session ---
app.post("/api/create-checkout-session", async (req, res) => {
  const { email } = req.body;
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card"],
    customer_email: email,
    line_items: [{ price: PRICE_ID, quantity: 1 }],
    success_url: `${req.headers.origin}?paid=true`,
    cancel_url: `${req.headers.origin}?paid=false`,
  });
  res.json({ url: session.url });
});

// Serve the frontend (public/index.html + public/app.js)
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Understudy backend running on ${PORT}`));
