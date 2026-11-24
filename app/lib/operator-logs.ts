export const LOG_CATEGORIES = ["Maintenance", "Operations", "Safety", "Quality", "Other"] as const;
export const LOG_STATUSES = ["Open", "Closed"] as const;
export const LOG_PRIORITIES = ["Low", "Medium", "High"] as const;

// Areas are machine names. These are always offered; any machine that has
// raised an alarm is added by the pages, so a new machine needs no code change.
export const DEFAULT_AREAS = ["r2d2", "r2d6"];

export const MAX_MESSAGE = 2000;

export type LogInput = {
  eventTime: Date;
  area: string;
  category: string;
  priority: string | null;
  status: string;
  message: string;
};

// Validates an untrusted request body. Returns the cleaned values or an error.
export function parseLogInput(body: unknown): { data: LogInput } | { error: string } {
  if (typeof body !== "object" || body === null) return { error: "Invalid request" };
  const b = body as Record<string, unknown>;

  const eventTime = new Date(String(b.eventTime ?? ""));
  if (Number.isNaN(eventTime.getTime())) return { error: "Event time is required" };

  const area = typeof b.area === "string" ? b.area.trim() : "";
  if (!area || area.length > 64) return { error: "Area is required" };

  if (!(LOG_CATEGORIES as readonly string[]).includes(b.category as string)) {
    return { error: "Category is invalid" };
  }
  if (!(LOG_STATUSES as readonly string[]).includes(b.status as string)) {
    return { error: "Status is invalid" };
  }

  const priority = b.priority === "" || b.priority == null ? null : String(b.priority);
  if (priority !== null && !(LOG_PRIORITIES as readonly string[]).includes(priority)) {
    return { error: "Priority is invalid" };
  }

  const message = typeof b.message === "string" ? b.message.trim() : "";
  if (!message) return { error: "Message is required" };
  if (message.length > MAX_MESSAGE) return { error: `Message must be ${MAX_MESSAGE} characters or fewer` };

  return {
    data: {
      eventTime,
      area,
      category: b.category as string,
      priority,
      status: b.status as string,
      message,
    },
  };
}
