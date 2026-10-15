"use client";

// The error boundary body of the restaurant routes (error.tsx): a short
// Spanish message and «Reintentar», inside the shell (the sidebar stays). The
// real error goes to the console (and the server logs have its digest).

import { useEffect } from "react";

export function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(
      "[restaurant route error]",
      error.digest ?? "",
      error.message
    );
  }, [error]);
  return (
    <div
      role="alert"
      className="w-full px-[26px] pt-6 pb-10"
      data-testid="route-error"
    >
      <div className="max-w-xl rounded-[14px] border border-[#dbe3f7] bg-white px-5 py-4">
        <h1 className="text-[16px] font-bold text-[#151c2c]">Algo salió mal</h1>
        <p className="mt-1 text-[13px] text-[#6b7385]">
          No pudimos cargar esta pantalla. Tus datos están a salvo. Inténtalo de
          nuevo; si sigue igual, avísanos.
        </p>
        {error.digest ? (
          <p className="mt-1 text-[11px] text-[#8a92a3]">
            Código: {error.digest}
          </p>
        ) : null}
        <button
          type="button"
          onClick={reset}
          className="mt-3 rounded-lg bg-[#1b40c8] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#1535a6]"
        >
          Reintentar
        </button>
      </div>
    </div>
  );
}
