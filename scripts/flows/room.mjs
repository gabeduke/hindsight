// The Listening Room as a person finds a take in it: a spine on the shelf
// wall, or a row of the List, whichever the room shows. A phone starts on
// the List (J2.7; docs/architecture/rooms.md, *The library*), a tablet and
// wider on the wall.

// SPINES matches both, shown or not, for code that runs in the page.
export const SPINES = '#view-room .room-cassette, #takes .take.spine:not(.folded)';

// aTake is the first take the room shows, to tap or hold.
export const aTake = (page) => page.locator(SPINES.split(', ').map((s) => `${s}:visible`).join(', ')).first();
