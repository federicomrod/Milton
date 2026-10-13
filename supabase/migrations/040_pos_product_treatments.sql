-- 040_pos_product_treatments.sql
--
-- Recipe costing PR 7: how each POS product is costed (premise 8).
--
-- ⚠️  NOT ADDITIVE: this replaces one CHECK constraint
-- (pos_product_links_classification_chk) with a wider one. No table,
-- column, default, index, policy or row is dropped or changed.
--
-- New values (the only ones the app writes from now on):
--   plato_preparado        prepared dish (needs a recipe)
--   reventa                bought and sold as is (one-line recipe)
--   modificador_con_costo  modifier sold separately, with a cost
--   modificador_sin_costo  modifier with no cost
--   combo                  costed by its parts
--   excluido               not food (tips, charges, merchandise)
-- Kept: por_clasificar (default), and the three pre-040 values
-- (requiere_receta, componente, no_requiere_costeo), which existing rows
-- may hold. The app reads them as plato_preparado, modificador_con_costo
-- and excluido; this migration does not rewrite any row.
--
-- IMPORTANT: Supabase migrations are not applied from the repo by CI.
-- Paste into the Supabase SQL Editor on Milton Staging (r1-staging),
-- after 039. No production apply as part of this PR.
--
-- Rollback (only if no row uses a new value yet; otherwise map them back
-- first, e.g. plato_preparado/reventa -> requiere_receta,
-- modificador_con_costo/modificador_sin_costo -> componente,
-- excluido -> no_requiere_costeo, combo -> por_clasificar):
--
--   ALTER TABLE public.pos_product_links
--     DROP CONSTRAINT IF EXISTS pos_product_links_classification_chk;
--   ALTER TABLE public.pos_product_links
--     ADD CONSTRAINT pos_product_links_classification_chk CHECK (
--       classification IN ('por_clasificar', 'requiere_receta',
--                          'componente', 'no_requiere_costeo'));

BEGIN;

ALTER TABLE public.pos_product_links
  DROP CONSTRAINT IF EXISTS pos_product_links_classification_chk;

ALTER TABLE public.pos_product_links
  ADD CONSTRAINT pos_product_links_classification_chk
    CHECK (
      classification IN (
        'por_clasificar',
        'plato_preparado',
        'reventa',
        'modificador_con_costo',
        'modificador_sin_costo',
        'combo',
        'excluido',
        'requiere_receta',
        'componente',
        'no_requiere_costeo'
      )
    );

COMMENT ON COLUMN public.pos_product_links.classification IS
  'Treatment set by a person: por_clasificar | plato_preparado | reventa | modificador_con_costo | modificador_sin_costo | combo | excluido. Pre-040 values requiere_receta | componente | no_requiere_costeo are read as plato_preparado | modificador_con_costo | excluido.';

COMMIT;
