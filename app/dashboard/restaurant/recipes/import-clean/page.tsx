import { getServerSession } from "@/app/api/auth-check";
import { redirect } from "next/navigation";

export default async function ImportCleanPage() {
  const session = await getServerSession();
  if (!session?.user?.id) redirect("/login");
  if (!session.user.companyId) redirect("/dashboard");

  return (
    <div className="w-full py-8 px-6 lg:px-10">
      <div className="max-w-4xl space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            Importar recetas limpias
          </h1>
          <p className="text-base text-muted-foreground mt-2">
            Sube el archivo JSON generado por Claude Code. Este importador
            acepta un formato fijo y limpio, sin intentar parsear Excel.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-lg font-semibold mb-3">
            Formato esperado: recipes_clean.json
          </h2>
          <pre className="text-xs bg-muted p-4 rounded-md overflow-x-auto">
{`{
  "recipes": [
    {
      "dish_name": "TACOS AL PASTOR",
      "selling_price": 85.00,
      "lines": [
        {
          "ingredient": "Carne al pastor",
          "quantity": 0.15,
          "unit": "kg",
          "cost": 45.50
        }
      ],
      "excel_cost_total": 48.50
    }
  ],
  "sub_recipes": [
    {
      "name": "CARNE AL PASTOR",
      "yield_quantity": 1.0,
      "yield_unit": "kg",
      "lines": [
        {
          "ingredient": "Pork shoulder",
          "quantity": 1.2,
          "unit": "kg",
          "cost": 120.00
        }
      ],
      "excel_cost_total": 120.00
    }
  ]
}`}
          </pre>
        </div>

        <ImportCleanForm />

        <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 p-4">
          <h3 className="font-semibold mb-2">Instrucciones</h3>
          <ol className="text-sm space-y-2 list-decimal list-inside">
            <li>
              Abre el archivo{" "}
              <code className="bg-white dark:bg-gray-800 px-1 py-0.5 rounded">
                CLAUDE_CODE_PROMPT.md
              </code>{" "}
              en el repositorio
            </li>
            <li>
              Copia el prompt y ejecútalo en Claude Code (claude.ai/chat con
              @code activado)
            </li>
            <li>
              Apunta Claude al archivo Excel de costos de Federico
            </li>
            <li>
              Claude generará{" "}
              <code className="bg-white dark:bg-gray-800 px-1 py-0.5 rounded">
                recipes_clean.json
              </code>{" "}
              y{" "}
              <code className="bg-white dark:bg-gray-800 px-1 py-0.5 rounded">
                validation_report.txt
              </code>
            </li>
            <li>
              Revisa el reporte de validación. Si hay platos que no cuadran,
              decide si los editas o los aceptas
            </li>
            <li>
              Sube{" "}
              <code className="bg-white dark:bg-gray-800 px-1 py-0.5 rounded">
                recipes_clean.json
              </code>{" "}
              aquí
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
}

function ImportCleanForm() {
  return (
    <form
      action="/api/restaurant/recipes/import-clean"
      method="POST"
      encType="multipart/form-data"
      className="rounded-lg border border-border bg-card p-6 space-y-4"
    >
      <div>
        <label className="block text-sm font-medium mb-2">
          Archivo recipes_clean.json
        </label>
        <input
          type="file"
          name="file"
          accept=".json"
          required
          className="block w-full text-sm file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:file:bg-blue-900/30 dark:file:text-blue-300"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-2">
            Moneda
          </label>
          <select
            name="currency"
            defaultValue="MXN"
            className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
          >
            <option value="MXN">MXN</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-2">
            Idioma
          </label>
          <select
            name="lang"
            defaultValue="es"
            className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
          >
            <option value="es">Español</option>
            <option value="en">English</option>
          </select>
        </div>
      </div>

      <button
        type="submit"
        className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Importar recetas
      </button>
    </form>
  );
}
