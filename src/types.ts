export const INTENT_NAMES = [
  "greet",
  "help",
  "set_pickup",
  "set_destination",
  "request_ride",
  "estimate_trip",
  "confirm",
  "deny",
  "cancel_ride",
  "check_status",
  "update_location",
  "choose_location",
  "chitchat",
  "unknown",
] as const;

export type IntentName = (typeof INTENT_NAMES)[number];

export const ACTION_NAMES = [
  "geocode",
  "reverse_geocode",
  "directions",
  "fare_estimate",
  "create_booking",
  "cancel_booking",
  "booking_status",
] as const;

export type ActionName = (typeof ACTION_NAMES)[number];

export const ACTION_TARGETS = ["location_api", "laravel"] as const;
export type ActionTarget = (typeof ACTION_TARGETS)[number];

export type Place = {
  raw: string | null;
  formatted: string | null;
  lat: number | null;
  lng: number | null;
};

export type LocationSuggestion = {
  index: number;
  label: string;
  formatted: string;
  lat: number;
  lng: number;
  kind: "exact" | "area";
  type: string;
};

export type PendingLocation = {
  role: "pickup" | "destination";
  query: string;
  suggestions: LocationSuggestion[];
};

export type Slots = {
  pickup: Place | null;
  destination: Place | null;
  when: string | null;
  vehicleType: string | null;
  bookingRef: string | null;
};

export type Intent = {
  name: IntentName;
  confidence: number;
  slots: Slots;
  missingSlots: string[];
};

export type ProposedAction = {
  id: string;
  name: ActionName;
  target: ActionTarget;
  requiresApproval: boolean;
  confirmed: boolean;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body: Record<string, unknown>;
};

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type DeviceContext = {
  currentLat?: number;
  currentLng?: number;
  locale?: string;
};

export type ConversationSession = {
  id: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  slots: Slots;
  lastIntent: IntentName | null;
  pendingActions: ProposedAction[];
  awaitingResults: ProposedAction[];
  pendingLocation: PendingLocation | null;
  pendingPickupConfirm: boolean;
  summary: string;
};

export type StructuredTurn = {
  sessionId: string;
  transcript: string | null;
  reply: {
    text: string;
    audioBase64: string | null;
    audioMime: string | null;
  };
  intent: Intent;
  slots: Slots;
  proposedActions: ProposedAction[];
  memory: {
    summary: string;
    turnCount: number;
  };
  messages: ChatMessage[];
  locationSuggestions: LocationSuggestion[];
  pendingLocation: PendingLocation | null;
  pendingPickupConfirm: boolean;
  uiHint: {
    screen: "chat" | "confirm" | "trip_preview" | "status" | "location_pick";
    promptUser: boolean;
  };
  engine: "groq" | "gemini" | "ollama" | "openai" | "fallback";
};

export type ActionResult = {
  actionId: string;
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
};
