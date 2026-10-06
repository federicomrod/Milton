# Milton auth email templates

Milton-branded templates for Supabase Auth emails. Each one is bilingual (Spanish first, then English), uses table-based HTML with inline CSS, and has one blue button plus a plain fallback link.

- **Sender:** `Milton <no-reply@miltonlabs.ai>`, set in the project's SMTP settings, not here.
- **Logo:** `public/email/milton-logo.png` (320×84, shown at 160×42), loaded from `https://raw.githubusercontent.com/federicomrod/Milton/r1-db-baseline/public/email/milton-logo.png`. **That URL is staging-only.** Production will switch to a stable miltonlabs.ai URL.

The templates use only Supabase's standard variables: `{{ .ConfirmationURL }}`, `{{ .Email }}` and `{{ .NewEmail }}` (email change only). They never build custom `token_hash` links, because the app's `/auth/callback` flow expects the default ConfirmationURL.

## Dashboard template → subject → file

| Dashboard template | Subject | File | config.toml key |
|---|---|---|---|
| Confirm signup | `Confirma tu cuenta de Milton / Confirm your Milton account` | `confirmation.html` | `[auth.email.template.confirmation]` |
| Invite user | `Te han invitado a Milton / You're invited to Milton` | `invite.html` | `[auth.email.template.invite]` |
| Magic Link | `Tu enlace para entrar en Milton / Your Milton sign-in link` | `magic_link.html` | `[auth.email.template.magic_link]` |
| Reset Password | `Restablece tu contraseña de Milton / Reset your Milton password` | `recovery.html` | `[auth.email.template.recovery]` |
| Change Email Address | `Confirma tu nuevo correo en Milton / Confirm your new Milton email` | `email_change.html` | `[auth.email.template.email_change]` |

## How to paste (hosted project)

1. In the Supabase Dashboard, open the project (e.g. **Milton Staging**), then **Authentication → Emails → Templates**.
2. For each row above, select the dashboard template and:
   - paste the subject into **Subject heading**;
   - switch the body to the source/HTML view and replace everything with the full contents of the file.
3. Save each template. Then send yourself a test (sign up, reset password, etc.) and check it in Gmail and Outlook.
4. Local dev (`supabase start`) picks these up automatically from `supabase/config.toml`.

## Notes

- Supabase renders these with Go `html/template`, which strips HTML comments. So there are no Outlook conditional comments, and the 560px column relies on `width="560"` plus `max-width:560px`.
- The Change Email Address template is sent to both the old and the new address, because `double_confirm_changes` is on. Its copy works for both.
- The app's own workspace-invite email (Resend, `lib/restaurant/email/send.ts` on r1-item2-invite-password) uses the same layout. It is separate from Supabase's "Invite user" template.
