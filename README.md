# OTOVOICE

Node.js voice conversation layer. It listens, talks, extracts intent, and returns a structured result. It does **not** book rides, calculate fares, or touch a database.

```
NODE.JS
  Voice / Speech / LLM / Prompt / Conversation
  Intent extraction / Structured output
  NO MySQL · NO booking logic · NO fare calculation · NO direct DB

        structured result
                │
                ▼
MOBILE APP  →  Laravel → MySQL
            →  Location API → Google Maps
```

## What this service does

- Speech-to-text and text-to-speech
- Multi-turn conversation (in-memory sessions)
- Intent and slot extraction
- Structured actions the mobile app may execute after approval

## What this service never does

- MySQL or any other database
- Booking business rules
- Fare / ETA / distance math
- Direct calls to Laravel or Google Maps

## Run

```bash
npm install
copy .env.example .env
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) for the local voice console.

The default engine is **Groq** (free). Get a key at [console.groq.com/keys](https://console.groq.com/keys) and set `GROQ_API_KEY`.

Other free options:

```env
LLM_PROVIDER=gemini
GEMINI_API_KEY=...
```

```env
LLM_PROVIDER=ollama
OLLAMA_CHAT_MODEL=llama3.2
```

OpenAI is not used unless you set `LLM_PROVIDER=openai`. The local console speaks with the browser, so TTS does not need a paid API.

## Mobile contract

`POST /v1/conversation/turn`

Send JSON `{ "sessionId?", "text", "speak?", "context?" }` or multipart with an `audio` file.

Response:

```json
{
  "sessionId": "uuid",
  "transcript": "Book a ride from Marina to the airport",
  "reply": { "text": "I can prepare a booking request.", "audioBase64": null, "audioMime": null },
  "intent": { "name": "request_ride", "confidence": 0.8, "slots": {}, "missingSlots": [] },
  "proposedActions": [
    {
      "id": "uuid",
      "name": "create_booking",
      "target": "laravel",
      "requiresApproval": true,
      "confirmed": false,
      "method": "POST",
      "path": "/bookings",
      "body": {}
    }
  ],
  "uiHint": { "screen": "confirm", "promptUser": true }
}
```

The mobile app:

1. Shows `reply.text` in the voice UI
2. Executes only catalogued `proposedActions` (`laravel` or `location_api`)
3. Asks the rider before any `requiresApproval: true` action
4. Posts results back to `POST /v1/conversation/:sessionId/action-result`

## Action catalog

| Action | Target | Approval |
| --- | --- | --- |
| `geocode` | Location API | no |
| `reverse_geocode` | Location API | no |
| `directions` | Location API | no |
| `fare_estimate` | Laravel | no |
| `create_booking` | Laravel | yes |
| `cancel_booking` | Laravel | yes |
| `booking_status` | Laravel | no |

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness and engine |
| `POST` | `/v1/conversation/turn` | One voice/text turn |
| `GET` | `/v1/conversation/:sessionId` | Session snapshot |
| `POST` | `/v1/conversation/:sessionId/action-result` | Mobile reports API results |
| `DELETE` | `/v1/conversation/:sessionId` | End session |
| `POST` | `/v1/speech/transcribe` | Audio → text |
| `POST` | `/v1/speech/speak` | Text → audio |

Sessions live in memory only and expire after `SESSION_TTL_MS` (default 30 minutes).
