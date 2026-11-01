# Rentabilidad: checklist for staging

Do it once on desktop, once on your phone (or the browser at 390 px wide).
Use a demo restaurant, never a real client. Tick each line, or write what you saw.

## Who can see it

- [ ] Sign in as an owner, an admin or a manager: **Rentabilidad** is in the menu and the page opens.
- [ ] Sign in as an analyst or a viewer: there is **no** Rentabilidad in the menu (desktop and phone Gestión).
- [ ] As an analyst or viewer, type `/dashboard/restaurant/rentabilidad` in the address bar: you are sent back to the cockpit.
- [ ] A manager can read the shared (group) fixed costs in Costos › Costos fijos.

## Fixed costs and break-even

- [ ] In Costos › Costos fijos, fill rent, payroll, utilities and taxes % and save.
- [ ] Rentabilidad now shows the profit and the day the restaurant covers its costs.
- [ ] Change one amount, save: the numbers move on Rentabilidad.

## Missing data

- [ ] A month with no fixed costs: a white card with **⚑ Falta**, and no profit number. It never shows $0.
- [ ] Fill only some fixed costs: the card names what is missing.
- [ ] Some recipes not approved: the profit still shows, with a **⚑ Falta el costo de ingredientes** flag.

## Todos los restaurantes

- [ ] Pick «Todos los restaurantes»: one line per restaurant plus a total.
- [ ] A restaurant with a missing cost shows **⚑ Falta**, and the total says it is incomplete.

## ¿Y si…?

- [ ] Move each slider: the profit and the break-even day change, showing "real → simulated".
- [ ] Move it back to zero: only the real number shows.
- [ ] Nothing you move here changes saved data (reload the page to check).

## Speed

- [ ] The page opens in under 1.5 seconds on an account with 12 months of data.
- [ ] Tapping the other months in the month picker: the page changes right away, no grey skeleton or spinner.
- [ ] Using the date box to pick an older month still works (it may take a moment).

## Phone (390 px)

- [ ] Nothing is cut off or scrolls sideways.
- [ ] The sliders can be dragged with a finger.
- [ ] The three languages (Español, English, Deutsch) read well: no raw keys, no mixed-in language.
