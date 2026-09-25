import { z } from "zod";
import { ACTION_NAMES, INTENT_NAMES } from "../types.js";

export const placeSchema = z.object({
  raw: z.string().nullable(),
  formatted: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
});

export const slotsSchema = z.object({
  pickup: placeSchema.nullable(),
  destination: placeSchema.nullable(),
  when: z.string().nullable(),
  vehicleType: z.string().nullable(),
  bookingRef: z.string().nullable(),
});

export const llmTurnSchema = z.object({
  replyText: z
    .string()
    .describe("Short spoken reply. Never claim a booking or fare was completed."),
  intentName: z.enum(INTENT_NAMES),
  confidence: z.number().min(0).max(1),
  slotUpdates: slotsSchema,
  missingSlots: z.array(z.string()),
  suggestedActions: z.array(z.enum(ACTION_NAMES)),
});

export const turnRequestSchema = z.object({
  sessionId: z.preprocess(
    (value) => (value === "" || value == null ? undefined : value),
    z.string().uuid().optional(),
  ),
  text: z.string().min(1).optional(),
  speak: z.boolean().optional(),
  context: z
    .object({
      currentLat: z.number().optional(),
      currentLng: z.number().optional(),
      locale: z.string().optional(),
    })
    .optional(),
});

export const actionResultSchema = z.object({
  actionId: z.string().min(1),
  ok: z.boolean(),
  data: z.record(z.unknown()).optional(),
  error: z.string().optional(),
});

export type LlmTurn = z.infer<typeof llmTurnSchema>;
