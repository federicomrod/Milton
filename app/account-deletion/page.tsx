// app/account-deletion/page.tsx
//
// Public page explaining how to delete an account in the Milton mobile app.
// App Store Connect requires this URL when submitting the app (guideline 5.1.1(v)).

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Eliminar cuenta - Milton",
  description: "Cómo eliminar tu cuenta de Milton desde la aplicación móvil",
  robots: "noindex",
};

// This page is public (no auth required) - check middleware.ts if needed

export default function AccountDeletionPage() {
  return (
    <main className="min-h-screen bg-white px-6 py-16 flex items-center justify-center">
      <div className="max-w-2xl w-full">
        <h1 className="text-3xl font-bold text-gray-900 mb-6">
          Eliminar tu cuenta de Milton
        </h1>

        <div className="prose prose-gray max-w-none">
          <p className="text-lg text-gray-700 mb-8">
            Puedes eliminar tu cuenta de Milton directamente desde la aplicación
            móvil. Este proceso es permanente y elimina tus datos personales de
            nuestros sistemas.
          </p>

          <h2 className="text-2xl font-semibold text-gray-900 mb-4">
            Qué se elimina
          </h2>
          <ul className="list-disc pl-6 mb-8 text-gray-700 space-y-2">
            <li>Tu perfil de usuario y datos personales</li>
            <li>Tu cuenta de acceso a Milton</li>
            <li>Tus membresías en empresas</li>
          </ul>

          <h2 className="text-2xl font-semibold text-gray-900 mb-4">
            Qué se mantiene
          </h2>
          <ul className="list-disc pl-6 mb-8 text-gray-700 space-y-2">
            <li>
              Los datos de la empresa (ventas, costos, recetas, facturas)
              pertenecen a la empresa, no a tu cuenta personal, y se mantienen
              intactos
            </li>
            <li>
              Los reportes y contenido que hayas creado quedan como registros
              del negocio
            </li>
          </ul>

          <h2 className="text-2xl font-semibold text-gray-900 mb-4">
            Cómo eliminar tu cuenta
          </h2>

          <div className="bg-gray-50 rounded-lg p-6 mb-8">
            <h3 className="text-xl font-semibold text-gray-900 mb-3">
              Desde Gestión (dueños y gerentes)
            </h3>
            <ol className="list-decimal pl-6 space-y-2 text-gray-700">
              <li>Abre la app de Milton en tu teléfono</li>
              <li>Toca tu foto de perfil en la parte superior derecha</li>
              <li>
                Baja hasta el final y toca{" "}
                <span className="font-semibold">Eliminar cuenta</span>
              </li>
              <li>Confirma la eliminación siguiendo los pasos en pantalla</li>
            </ol>
          </div>

          <div className="bg-gray-50 rounded-lg p-6 mb-8">
            <h3 className="text-xl font-semibold text-gray-900 mb-3">
              Desde Cocina (equipo de cocina)
            </h3>
            <ol className="list-decimal pl-6 space-y-2 text-gray-700">
              <li>Abre la app de Milton en tu teléfono</li>
              <li>
                Toca el icono de cuenta en la esquina superior derecha (o accede
                desde el menú)
              </li>
              <li>
                Baja hasta el final y toca{" "}
                <span className="font-semibold">Eliminar cuenta</span>
              </li>
              <li>Confirma la eliminación siguiendo los pasos en pantalla</li>
            </ol>
          </div>

          <h2 className="text-2xl font-semibold text-gray-900 mb-4">
            Importante
          </h2>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-8">
            <p className="text-gray-800 mb-3">
              <span className="font-semibold">Si eres el único dueño</span> de
              una empresa, no podrás eliminar tu cuenta directamente para evitar
              dejar la empresa sin dueño.
            </p>
            <p className="text-gray-800">
              En ese caso, escríbenos a{" "}
              <a
                href="mailto:hello@miltonlabs.ai"
                className="text-blue-600 hover:underline"
              >
                hello@miltonlabs.ai
              </a>{" "}
              para cerrar la empresa o transferir la propiedad.
            </p>
          </div>

          <h2 className="text-2xl font-semibold text-gray-900 mb-4">
            ¿Necesitas ayuda?
          </h2>
          <p className="text-gray-700 mb-3">
            Si tienes preguntas sobre la eliminación de tu cuenta, escríbenos a{" "}
            <a
              href="mailto:hello@miltonlabs.ai"
              className="text-blue-600 hover:underline"
            >
              hello@miltonlabs.ai
            </a>
          </p>
          <p className="text-gray-700">
            <span className="font-semibold">
              Forma alternativa de eliminar tu cuenta:
            </span>{" "}
            Si prefieres, también puedes solicitar la eliminación de tu cuenta
            enviando un correo electrónico a hello@miltonlabs.ai desde tu
            dirección registrada.
          </p>
        </div>

        <div className="mt-12 pt-8 border-t border-gray-200">
          <a
            href="https://app.miltonlabs.ai"
            className="text-blue-600 hover:underline"
          >
            ← Volver a Milton
          </a>
        </div>
      </div>
    </main>
  );
}
