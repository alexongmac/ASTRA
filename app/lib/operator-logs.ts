export const LOG_CATEGORIES = [
  "Maintenance",
  "Operations",
  "Safety",
  "Quality",
  "Other",
] as const;
export const LOG_STATUSES = ["Open", "Closed", "On-Hold", "Cancelled"] as const;
export const LOG_PRIORITIES = ["Low", "Medium", "High"] as const;

// The Area dropdown options. Edit this list to add or rename an area.
export const DEFAULT_AREAS = [
  "Area 1",
  "Area 2",
  "Area 3",
  "Area 4",
  "Area 5",
  "Area 6",
  "Area 7",
  "Area 8",
  "Area 9",
  "Area 10",
] as const;

// The Machine dropdown options. Edit this list to add or rename a machine.
export const LOG_MACHINES = ["r2d2", "r2d4", "r2d5", "r2d6"] as const;

export const MAX_MESSAGE = 2000;

export type LogInput = {
  eventTime: Date;
  area: string;
  machine: string | null;
  category: string;
  priority: string | null;
  status: string;
  message: string;
};

// Validates an untrusted request body. Returns the cleaned values or an error.
export function parseLogInput(
  body: unknown,
): { data: LogInput } | { error: string } {
  if (typeof body !== "object" || body === null)
    return { error: "Invalid request" };
  const b = body as Record<string, unknown>;

  const eventTime = new Date(String(b.eventTime ?? ""));
  if (Number.isNaN(eventTime.getTime()))
    return { error: "Event time is required" };

  const area = typeof b.area === "string" ? b.area.trim() : "";
  if (!area || area.length > 64) return { error: "Area is required" };

  // Optional: some entries (plant-wide notes) do not concern one machine.
  const machine = b.machine === "" || b.machine == null ? null : String(b.machine);
  if (machine !== null && !(LOG_MACHINES as readonly string[]).includes(machine)) {
    return { error: "Machine is invalid" };
  }

  if (!(LOG_CATEGORIES as readonly string[]).includes(b.category as string)) {
    return { error: "Category is invalid" };
  }
  if (!(LOG_STATUSES as readonly string[]).includes(b.status as string)) {
    return { error: "Status is invalid" };
  }

  const priority =
    b.priority === "" || b.priority == null ? null : String(b.priority);
  if (
    priority !== null &&
    !(LOG_PRIORITIES as readonly string[]).includes(priority)
  ) {
    return { error: "Priority is invalid" };
  }

  const message = typeof b.message === "string" ? b.message.trim() : "";
  if (!message) return { error: "Message is required" };
  if (message.length > MAX_MESSAGE)
    return { error: `Message must be ${MAX_MESSAGE} characters or fewer` };

  return {
    data: {
      eventTime,
      area,
      machine,
      category: b.category as string,
      priority,
      status: b.status as string,
      message,
    },
  };
}
