# QA · Subir costos fijos: entry points (#409)

Roles: owner, admin, manager (they see Costos fijos). Demo data only.

1. Costos › Costos fijos, **group view** («Costos compartidos del grupo»): «⇪ Subir archivo» is above the categories without scrolling or opening a menu.
2. Same in a **restaurant view**, and in a **month with no costs** (empty).
3. With a category missing, the blue «⚑ Falta cargar costos fijos de este mes» box shows. Tap **«Sube tus costos fijos»**: the file picker opens (same as «⇪ Subir archivo»). It no longer just moves the cursor to Planilla.
4. Pick a file: the draft review appears as before (nothing is saved until approved).
5. Rentabilidad, month with a fixed cost missing: tap **«Sube tus costos fijos»**: Costos fijos opens for the same restaurant and month, and the picker opens. Some browsers block a picker that opens by itself after a page change; then tap «⇪ Subir archivo» (one tap).
6. After step 5 the address no longer has `subir=1`; reload does not reopen the picker.
7. 390 px: both buttons fit on one line or wrap, no horizontal scroll. No yellow box.
8. es / en / de: the button texts are the same as before in each language.
