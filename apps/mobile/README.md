# Milton Cocina (Expo app)

The cook's app for Milton: join with an invite, send a photo, a voice note or a
text, and see your own sends and the location's recipes. No money anywhere.

It lives in this repo but is **separate from the web app**: its own
`package.json`, its own `node_modules`, excluded from the web build, lint,
formatting and tests. The web app talks to it only through `/api/mobile/v1`.

## Run it on your iPhone (Expo Go, no Xcode)

1. On the iPhone, install **Expo Go** from the App Store.
2. On the Mac:
   ```bash
   cd apps/mobile && npm install && npx expo start
   ```
   Mac and iPhone on the same Wi-Fi. If they are not, use
   `npx expo start --tunnel`.
3. Scan the QR code shown in the terminal with the iPhone **Camera** app. It
   opens in Expo Go.
4. On Milton staging (web), as owner, create a cook invite for a location (or
   call `POST /api/mobile/v1/kitchen/invites`), and copy the code or link.
5. In the app: paste the code, type a name, tap «Entrar». Send one photo, one
   voice note and one text.
6. On Milton staging › Cocina: the three items appear with the «App» badge.
   Telegram still works.

The app points at staging by default. No settings to change.

### Which server does it call?

`app.config.ts` → `extra.apiBaseUrl`. The default is the `r1-staging` branch
alias on Vercel. It is a plain URL, not a secret; the app never holds a Supabase
key. To use another server (for example the web app running on your Mac):

```bash
EXPO_PUBLIC_API_BASE_URL=http://<your Mac's address>:3000 npx expo start
```

> **Vercel Authentication.** Preview deployments (including the `r1-staging`
> alias) are behind Vercel's login wall unless Deployment Protection is turned
> off for them. A phone cannot pass that wall, so the app shows «No pude
> conectar con Milton». Turn protection off for the staging alias, or use the
> local address above.

## Checks

```bash
npm run type-check   # tsc --noEmit
npm run lint
npm test             # pure helpers: API client, send/retry logic, invite parsing, theme
npx expo-doctor
```

## How it works

- **Join** (`src/app/join.tsx`): the invite code or link (`https://…/k/<secret>`,
  or `milton://k/<secret>`) + your name → `POST kitchen/redeem` → the device
  token goes into the phone's secure store (`expo-secure-store`) and nowhere
  else.
- **Enviar**: every send goes through the outbox (`src/send/`). The item gets
  its `clientRef` before the first attempt; photos and voice notes are
  uploaded **straight to Supabase Storage** with a signed upload URL
  (`kitchen/uploads` → PUT → `kitchen/uploads/complete`), never through our
  server. Failed or offline items are saved on the phone and retried (on start,
  when the app comes back, every 15 s with backoff, and on «Reintentar»); the
  same `clientRef` means they are never stored twice.
- **Historial**: «Mis envíos» (`kitchen/history`) and «Recetas»
  (`kitchen/recipes`, read only).
- Colours live in `src/theme.ts` (brand palette only; a test fails on any other
  hex value).

## Not here yet

«Esto entendí» / «Milton te pregunta», push notifications, universal links,
Gestión mode, store builds (EAS / TestFlight / Play).
