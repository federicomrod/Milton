# Claude Code Recipe Extraction Prompt

**Goal**: Convert Federico's Excel cost workbook into a clean, structured JSON file that Milton can import reliably.

## Context

You have access to an Excel file with recipe costs. The file is messy—headers vary, blocks are hand-formatted, yields are sometimes assumed, and formulas don't always match printed totals. Your job is to read it carefully, extract every dish and sub-recipe (prepared component), and output a clean JSON file plus a validation report.

## Instructions

1. **Read the entire Excel file** using a Python library like `openpyxl` or `pandas`.

2. **Identify recipe blocks**:
   - Look for dish names (main recipes) and sub-recipe names (prep items like "CARNE AL PASTOR", "SALSA VERDE", etc.)
   - Each recipe has a list of ingredients with quantity, unit, and cost
   - Many recipes have a printed "COSTO TOTAL" or "Total" at the bottom
   - Sub-recipes often have a yield (e.g., "Rinde 1 kg" or "Yield: 6.5 kg")

3. **Extract each recipe** into this structure:
   ```json
   {
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
           },
           {
             "ingredient": "Tortilla de maíz",
             "quantity": 3,
             "unit": "unit",
             "cost": 3.00
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
           },
           {
             "ingredient": "Adobo paste",
             "quantity": 0.3,
             "unit": "kg",
             "cost": 45.00
           }
         ],
         "excel_cost_total": 165.00
       }
     ]
   }
   ```

4. **Units**: Normalize common Spanish/English units:
   - `kg`, `g`, `l`, `ml`, `oz`, `lb`, `unit`, `portion`, `pz` (pieza)
   - If you see "ORDEN", "CONVOY", or similar portion units for a sub-recipe, use `portion`
   - Keep the unit exactly as you interpret it (don't invent new ones)

5. **Costs**:
   - For each line, compute `cost = quantity × unit_price` if both are available
   - If only a total is given, use that
   - Store the Excel's printed COSTO TOTAL as `excel_cost_total` for each recipe/sub-recipe
   - If there's no printed total, compute it as the sum of line costs

6. **Yields** (for sub-recipes only):
   - Look for "Rinde", "Yield", "Produce", or similar text near the recipe
   - Extract the quantity and unit (e.g., "Rinde 6.5 kg" → `yield_quantity: 6.5`, `yield_unit: "kg"`)
   - If no yield is found, set `yield_quantity: 1` and `yield_unit: "unit"` (Milton will flag this for review)

7. **Selling price** (for main dishes):
   - Look for "Precio", "Selling Price", "PV", etc.
   - Store as `selling_price`
   - If not found, use `null`

8. **Output two files**:
   - **`recipes_clean.json`**: The structured JSON above
   - **`validation_report.txt`**: A text report with:
     - For each recipe/sub-recipe:
       - Name
       - Sum of line costs (Milton's computed total)
       - Excel's printed COSTO TOTAL
       - Whether they match (within 2% or $0.05 tolerance)
       - If they don't match, list it as "NEEDS REVIEW"

## Validation Report Format

```
VALIDATION REPORT
=================

Recipes checked: 42
Sub-recipes checked: 18

MATCHING (within tolerance):
✓ TACOS AL PASTOR: Excel $48.50, Computed $48.50 (0% diff)
✓ ENCHILADAS VERDES: Excel $62.30, Computed $62.45 (0.2% diff)

NEEDS REVIEW:
✗ MOLE POBLANO: Excel $120.00, Computed $135.50 (12.9% diff, $15.50)
✗ SALSA ROJA: Excel $18.00, Computed $22.00 (22.2% diff, $4.00)

Sub-recipes with assumed yields (no yield found in Excel):
- CARNE ASADA (defaulted to 1 unit)
- FRIJOLES REFRITOS (defaulted to 1 unit)
```

## Important Rules

- **Do NOT skip rows** because they look messy or have missing data. Extract what you can and note any issues in the validation report.
- **Do NOT invent costs or quantities**. If a line is unclear, include it with `null` values and note it in the report.
- **Do NOT merge or split recipes on your own**. If the Excel shows 5 separate TACO recipes, output 5 separate objects.
- **Check your math**: For every recipe, compute `sum(line.cost)` and compare to `excel_cost_total`. If they differ by more than 2% or $0.05, flag it.

## Output

When you're done, save:
1. `recipes_clean.json` - The structured data
2. `validation_report.txt` - The validation report

Then tell Federico you've processed the file and show him the summary from the report (how many recipes, how many match, how many need review).

---

## How to use this prompt

**For Federico**:
1. Open https://claude.ai/chat in your browser
2. Enable @code mode (click the code icon or type @code)
3. Paste this entire prompt
4. Attach your Excel file when Claude asks
5. Claude will read it and generate two files:
   - `recipes_clean.json` - The structured recipe data
   - `validation_report.txt` - The validation report showing which recipes match and which need review
6. Review the validation report. If mismatches are small (< 2% or < $0.05), that's normal and OK. If they're large, you may need to check the Excel or hand-edit the JSON.
7. Upload `recipes_clean.json` to Milton at: `/dashboard/restaurant/recipes/import-clean`

**Note**: The Excel file never leaves your Mac. Claude Code runs locally and only sends the generated JSON to Milton when you upload it.
