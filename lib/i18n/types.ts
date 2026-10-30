// lib/i18n/types.ts
//
// `es.ts` is the source of truth. Dictionary has the same nested shape with
// every value a string (string literals widened). en.ts and de.ts are typed
// `Dictionary`, so a missing or extra key fails `npm run type-check`.
// Interpolation uses `{name}` placeholders (see fmt()); no function values.

import type { es } from "./es";

type Widen<T> = T extends string ? string : { [K in keyof T]: Widen<T[K]> };

export type Dictionary = Widen<typeof es>;
