import {
  ROOM_STATUSES,
  SCHEMA_VERSION,
  getAvailableRoomIds,
  normalizeText,
  type Room,
  type Snapshot,
} from "./model";

type TextField =
  | "number"
  | "availability"
  | "monthlyPrice"
  | "area"
  | "roomType"
  | "floorPlan";

interface PendingRoom {
  room: Room;
  fallbackPrice: string;
}

export class OakhouseParseError extends Error {
  override name = "OakhouseParseError";
}

class RoomCollector {
  readonly rooms: Room[] = [];
  private current: PendingRoom | null = null;
  private error: OakhouseParseError | null = null;
  private readonly ids = new Set<string>();

  start(element: Element): void {
    if (this.current !== null) {
      this.fail("Nested Oakhouse room row");
      return;
    }

    const id = normalizeText(element.getAttribute("id") ?? "");
    const status = normalizeText(element.getAttribute("data-status") ?? "");
    this.current = {
      room: {
        id,
        number: "",
        status,
        availability: "",
        monthlyPrice: "",
        area: "",
        roomType: "",
        floorPlan: "",
      },
      fallbackPrice: normalizeText(
        element.getAttribute("data-sort_price") ?? "",
      ),
    };

    element.onEndTag(() => this.finish());
  }

  append(field: TextField, text: string): void {
    if (this.current === null) {
      this.fail("Room field found outside a room row");
      return;
    }
    this.current.room[field] += text;
  }

  assertValid(): void {
    if (this.error) {
      throw this.error;
    }
  }

  private finish(): void {
    if (this.current === null) {
      this.fail("Room row closed without state");
      return;
    }

    const pending = this.current;
    this.current = null;
    const room = pending.room;

    room.id = normalizeText(room.id);
    room.number = normalizeText(room.number);
    room.status = normalizeText(room.status);
    room.availability = normalizeAvailability(
      normalizeText(room.availability),
      room.status,
    );
    room.monthlyPrice = normalizeText(room.monthlyPrice);
    room.area = normalizeArea(room.area);
    room.roomType = normalizeText(room.roomType);
    room.floorPlan = normalizeText(room.floorPlan);

    if (!room.monthlyPrice && /^\d+$/.test(pending.fallbackPrice)) {
      room.monthlyPrice =
        "¥" + Number(pending.fallbackPrice).toLocaleString("en-US");
    }
    if (!room.number || !room.status) {
      this.fail("Room row is missing number or status");
      return;
    }
    if (!room.id) {
      room.id = "number:" + room.number;
    }
    if (!ROOM_STATUSES.includes(
      room.status as (typeof ROOM_STATUSES)[number],
    )) {
      this.fail("Unknown Oakhouse room status: " + room.status);
      return;
    }
    for (const field of [
      "availability",
      "monthlyPrice",
      "area",
      "roomType",
      "floorPlan",
    ] as const) {
      if (!room[field]) {
        this.fail("Room " + room.id + " is missing " + field);
        return;
      }
    }
    if (this.ids.has(room.id)) {
      this.fail("Duplicate Oakhouse room id: " + room.id);
      return;
    }

    this.ids.add(room.id);
    this.rooms.push(room);
  }

  private fail(message: string): void {
    this.error ??= new OakhouseParseError(message);
  }
}

class RowHandler implements HTMLRewriterElementContentHandlers {
  constructor(private readonly collector: RoomCollector) {}

  element(element: Element): void {
    this.collector.start(element);
  }
}

class FieldHandler implements HTMLRewriterElementContentHandlers {
  constructor(
    private readonly collector: RoomCollector,
    private readonly field: TextField,
  ) {}

  text(text: Text): void {
    this.collector.append(this.field, text.text);
  }
}

function normalizeAvailability(value: string, status: string): string {
  if (status === "vacancy" && /^vacancy$/i.test(value)) {
    return "Available now";
  }
  return value;
}

function normalizeArea(value: string): string {
  return normalizeText(value)
    .replace(/^Size\s*/i, "")
    .replace(/\s*㎡/g, " m²");
}

export async function parseOakhouseHtml(
  html: string,
  sourceUrl: string,
  checkedAt: string,
): Promise<Snapshot> {
  const collector = new RoomCollector();
  const rewriter = new HTMLRewriter()
    .on("tr.p-room__caset__row", new RowHandler(collector))
    .on(
      "tr.p-room__caset__row .ext-spheader h3",
      new FieldHandler(collector, "number"),
    )
    .on(
      "tr.p-room__caset__row .ext-spheader em",
      new FieldHandler(collector, "availability"),
    )
    .on(
      "tr.p-room__caset__row .ext-spheader > span",
      new FieldHandler(collector, "availability"),
    )
    .on(
      "tr.p-room__caset__row > td:nth-child(3) p.ext-large > span.ext-large",
      new FieldHandler(collector, "monthlyPrice"),
    )
    .on(
      "tr.p-room__caset__row > td:nth-child(4) li:nth-child(1)",
      new FieldHandler(collector, "area"),
    )
    .on(
      "tr.p-room__caset__row > td:nth-child(4) li:nth-child(2) span",
      new FieldHandler(collector, "roomType"),
    )
    .on(
      "tr.p-room__caset__row > td:nth-child(4) li:nth-child(3) span",
      new FieldHandler(collector, "floorPlan"),
    );

  const response = new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
  await rewriter.transform(response).text();
  collector.assertValid();

  if (collector.rooms.length === 0) {
    throw new OakhouseParseError("No Oakhouse room rows found");
  }

  const allRooms = Object.fromEntries(
    collector.rooms.map((room) => [room.id, room]),
  );
  const availableRoomIds = getAvailableRoomIds(allRooms);

  return {
    schemaVersion: SCHEMA_VERSION,
    sourceUrl,
    checkedAt,
    parsedRoomCount: collector.rooms.length,
    availableRoomCount: availableRoomIds.length,
    allRooms,
    availableRoomIds,
  };
}
