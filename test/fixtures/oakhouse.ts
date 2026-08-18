export interface FixtureRoom {
  id: string;
  number: string;
  status: "vacancy" | "novacancy";
  availability: string;
  monthlyPrice: string;
  area: string;
  roomType: string;
  floorPlan: string;
}

export const BASELINE_ROOMS: FixtureRoom[] = [
  { id: "11862", number: "113", status: "vacancy", availability: "Vacancy", monthlyPrice: "¥73,000", area: "9.9㎡", roomType: "Single Room", floorPlan: "1R" },
  { id: "11868", number: "205", status: "vacancy", availability: "Vacancy", monthlyPrice: "¥75,000", area: "10㎡", roomType: "Single Room", floorPlan: "1R" },
  { id: "11871", number: "208", status: "vacancy", availability: "Vacancy", monthlyPrice: "¥75,000", area: "10㎡", roomType: "Single Room", floorPlan: "1R" },
  { id: "11873", number: "210", status: "vacancy", availability: "2026/08/27 ~", monthlyPrice: "¥75,000", area: "10㎡", roomType: "Single Room", floorPlan: "1R" },
  { id: "11874", number: "211", status: "novacancy", availability: "Full", monthlyPrice: "¥75,000", area: "10㎡", roomType: "Single Room", floorPlan: "1R" },
];

export function roomRow(room: FixtureRoom): string {
  const digits = room.monthlyPrice.replace(/\D/g, "");
  const availabilityMarkup = room.status === "novacancy"
    ? "<span>" + room.availability + "</span>"
    : room.availability === "Vacancy"
      ? "<em>" + room.availability + "</em>"
      : "<em><span>" + room.availability + "</span></em>";
  return [
    '<tr id="' + room.id + '" class="p-room__caset__row" data-status="' + room.status + '" data-sort_price="' + digits + '" data-type="single">',
    '<td class="p-room__table__col ext-image"><div><div class="ext-spheader"><h3>' + room.number + '</h3>' + availabilityMarkup + '</div></div></td>',
    '<td class="p-room__table__col ext-left"><div><span><h4>Contract fee</h4><p><span class="ext-large">¥50,000</span></p></span></div></td>',
    '<td class="p-room__table__col ext-left"><div><span><h4>Monthly rent</h4><p class="ext-large"><span class="ext-large">' + room.monthlyPrice + '</span></p></span></div></td>',
    '<td class="p-room__table__col ext-center"><ul>',
    '<li class="has-label"><strong>Size</strong>' + room.area + '</li>',
    '<li class="has-label"><strong>Room type</strong><span>' + room.roomType + '</span></li>',
    '<li class="has-label"><strong>Floor plan</strong><span>' + room.floorPlan + '</span></li>',
    '</ul></td>',
    '</tr>',
  ].join("");
}

export function oakhousePage(rooms: FixtureRoom[]): string {
  return "<!doctype html><html><body><table id=\"room\"><tbody>" +
    rooms.map(roomRow).join("") +
    "</tbody></table></body></html>";
}

export const BASELINE_HTML = oakhousePage(BASELINE_ROOMS);
