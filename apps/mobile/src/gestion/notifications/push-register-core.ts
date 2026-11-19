// Pure registration logic for testing. The hook should only save the token
// and mark it registered when the server returns {registered: true}.

export interface RegisterResponse {
  registered: boolean;
}

/**
 * Should we save the token and mark it registered? Only when the server
 * explicitly confirms registration.
 */
export function shouldSaveToken(response: RegisterResponse): boolean {
  return response.registered === true;
}

/**
 * What status should we show after registration? 'saved' when registration
 * succeeded, 'unavailable' when the feature is disabled or not ready.
 */
export function statusAfterRegister(
  registered: boolean
): "saved" | "unavailable" {
  return registered ? "saved" : "unavailable";
}
