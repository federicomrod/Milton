// Pulls the invite secret out of what a cook pastes: the raw code, the invite
// link (https://…/k/<secret>) or the app link (milton://k/<secret>).

const SECRET = /^[A-Za-z0-9_-]{16,200}$/;
const IN_LINK = /(?:^|\/)k\/([A-Za-z0-9_-]{16,200})(?:[/?#]|$)/;

export function extractInviteSecret(
  input: string | null | undefined
): string | null {
  const text = (input ?? "").trim();
  if (!text) return null;
  const fromLink = IN_LINK.exec(text);
  if (fromLink) return fromLink[1];
  return SECRET.test(text) ? text : null;
}
