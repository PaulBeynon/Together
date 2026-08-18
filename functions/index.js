/**
 * togetherChat — Cloud Function proxy for Together's note responses.
 *
 * Mirrors the claudeProxy pattern from Recipeasypeasy:
 * - API key lives server-side only (set via `firebase functions:secrets:set ANTHROPIC_API_KEY`)
 * - Per-user daily limit stored in Firestore to avoid runaway cost
 * - Client sends the note text + light context, gets back a short reply
 *
 * Deploy from your own machine (same as your other projects):
 *   firebase deploy --only functions:togetherChat
 *
 * Then set CLOUD_FUNCTION_URL in index.html to the deployed URL.
 */

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');

admin.initializeApp();
// This project's Firestore database was created with the ID 'together'
// rather than the default '(default)', so it needs to be referenced
// explicitly — admin.firestore() alone would look for '(default)' and fail.
const db = getFirestore('together');

const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const DAILY_LIMIT = 40; // generous — this is one person's personal app

const SYSTEM_PROMPT = `You are a warm, grounded companion inside "Together", a
personal daily check-in app for physical and mental health. The person has
just written a short note as part of a morning, midday, or evening check-in.

Reply in 1-3 short sentences, plain and conversational — never clinical,
never listy, never falsely upbeat. Respond to what they actually wrote, not
a generic template. If they mention food, movement, or mood, engage with
that specifically. Don't diagnose, don't give medical advice, and don't be
saccharine. Think: a steady friend who's paying attention, not a wellness
app. No emoji unless the person used one first.`;

exports.togetherChat = onRequest(
  { secrets: [ANTHROPIC_API_KEY], cors: true },
  async (req, res) => {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'POST only' });
    }

    const { uid, note, slot, mood, habit } = req.body || {};
    if (!uid || typeof note !== 'string' || !note.trim()) {
      return res.status(400).json({ error: 'uid and note are required' });
    }

    // ---- per-user daily limit ----
    const today = new Date().toISOString().slice(0, 10);
    const limitRef = db.doc(`users/${uid}/usage/${today}`);
    const limitSnap = await limitRef.get();
    const used = limitSnap.exists ? limitSnap.data().togetherChatCount || 0 : 0;

    if (used >= DAILY_LIMIT) {
      return res.status(429).json({ error: 'Daily limit reached' });
    }

    const contextLine = [
      slot ? `Check-in: ${slot}` : null,
      mood ? `Mood selected: ${mood}` : null,
      typeof habit === 'boolean' ? `Habit for this slot: ${habit ? 'done' : 'not done'}` : null
    ].filter(Boolean).join('. ');

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY.value(),
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 200,
          system: SYSTEM_PROMPT,
          messages: [
            { role: 'user', content: `${contextLine}\n\nNote: ${note}` }
          ]
        })
      });

      const data = await response.json();
      const reply = data?.content?.find(b => b.type === 'text')?.text?.trim();

      if (!reply) {
        return res.status(502).json({ error: 'No reply from model' });
      }

      await limitRef.set({ togetherChatCount: used + 1 }, { merge: true });

      return res.status(200).json({ reply });
    } catch (err) {
      console.error('togetherChat error:', err);
      return res.status(500).json({ error: 'Something went wrong' });
    }
  }
);
