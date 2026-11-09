# Costos fijos — QA after #494 (desktop/web, staging)

Synthetic data only. Do not reuse a real client's file. Run on desktop first, then 360px.

## A. Destination month (the reported failure — NOT yet reproduced)
1. Upload a file with a month/date column set to a month that is NOT the one on screen.
2. Each such line shows «⚑ Se guardará en {mes}» **before** you approve, and a link «Usar {mes en pantalla}».
3. Approve one as is → toast «1 línea aprobada · guardada en … · {mes}. Esta pantalla no cambia.» with «Ver {mes}»; cards, Total and the daily target on this screen do NOT change. «Ver {mes}» opens that month and the amount is there.
4. On another line click «Usar {mes en pantalla}» → the tag goes away; approving lands on this screen at once (card, Total, daily target) with no month change and no refresh.
5. Nothing is ever saved to a month that was not shown on the line.

## B. Counts and break-even wording
6. Approve two Servicios lines → toast «2 líneas aprobadas»; the pill says «Categorías confirmadas: 1 de 5».
7. With a category missing the side card is titled «Punto de equilibrio parcial» + «Calculado solo con los costos confirmados. Faltan categorías por confirmar.» The group share stays in Total.
8. Nothing confirmed and no group share → Total «—», daily target «— al día», no partial title.
9. All five covered (own or group) → normal heading.

## C. Copy of recurrent costs
10. October: upload Servicios with several lines, «Se repite cada mes» ON. Open November → «Copiar recurrentes de octubre» (or just open it).
11. November Servicios shows the same breakdown under the card, tagged «copiado de octubre de 2026»; the sum equals the card. Reload: same. Open December: still there, now «copiado de noviembre de 2026».
12. Copy again → «No hay costos recurrentes que copiar…» and nothing doubles.
13. Historial: «Servicios · $4,800 · copiado de octubre de 2026» + time. A copy made before this release says «repetido automáticamente» (the source month was never stored).
14. A copied total from before this release whose label has several concepts and has no stored breakdown: «Desglose no disponible para este registro.» Edit the amount by hand → breakdown hides.

## D. Stale numbers
15. Approve, then within 3 s approve another line: the first refresh never wipes the second.
16. While a non-instant save is in flight the target reads «Recalculando…» (dimmed) instead of a final-looking number.

## E. Isolation
17. Restaurant A's breakdown never shows on restaurant B or the group view.
