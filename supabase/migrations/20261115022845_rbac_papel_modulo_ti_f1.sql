-- F1 (menu por papel) — liberação por ITEM (module_id) além do subgrupo.
-- Emergência de permissões/LGPD: hoje rbac_papel_acesso só libera por SUBGRUPO, e
-- todos os itens de "Administração" dividem o subgrupo "administracao". O papel
-- "TI / Suporte" (ind_ti_suporte) precisa ver SÓ 3 itens de Administração
-- (Conectores, Abastecimento de dados, Notificações no celular), nunca Cofre,
-- Acessos, Vendedores, Fiscal, Conexões bancárias, etc.
--
-- Esta migration é ADITIVA (tabela + função novas; nada é alterado/apagado) e é a
-- camada de dados que o menu e o bloqueio de rota (fatias seguintes da F1) vão ler.
-- NÃO altera as 11 funções de guarda (RD-91) nem o menu ainda.
-- Pedido do Eng. Chefe (caixa 952727d5, 12/11).

BEGIN;

-- 1) Tabela de liberação por item (papel -> módulo específico do module_catalog)
CREATE TABLE IF NOT EXISTS public.rbac_papel_modulo (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  papel_slug text        NOT NULL REFERENCES public.rbac_papel(slug)   ON DELETE CASCADE,
  module_id  text        NOT NULL REFERENCES public.module_catalog(id) ON DELETE CASCADE,
  nivel      text        NOT NULL DEFAULT 'ver' CHECK (nivel IN ('ver','editar')),
  criado_em  timestamptz NOT NULL DEFAULT now(),
  criado_por text,
  CONSTRAINT rbac_papel_modulo_unico UNIQUE (papel_slug, module_id)
);

COMMENT ON TABLE  public.rbac_papel_modulo IS
  'F1 permissões: libera um papel (rbac_papel) a ver/editar um ITEM específico do menu (module_catalog.id), com granularidade maior que o subgrupo (rbac_papel_acesso). Lida pelo menu e pelo bloqueio de rota. Aditiva — papel sem linha aqui cai na regra de subgrupo/atual.';
COMMENT ON COLUMN public.rbac_papel_modulo.nivel IS 'ver | editar';

CREATE INDEX IF NOT EXISTS idx_rbac_papel_modulo_papel ON public.rbac_papel_modulo (papel_slug);

-- 2) RLS — espelha o padrão de rbac_papel_acesso (dado de referência global,
--    legível por qualquer usuário autenticado; sem acesso anônimo; escrita só service_role).
ALTER TABLE public.rbac_papel_modulo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rbac_papel_modulo_select_authenticated ON public.rbac_papel_modulo;
CREATE POLICY rbac_papel_modulo_select_authenticated
  ON public.rbac_papel_modulo
  FOR SELECT
  TO authenticated
  USING (true);

REVOKE ALL   ON public.rbac_papel_modulo FROM anon, public;
GRANT  SELECT ON public.rbac_papel_modulo TO   authenticated;
-- INSERT/UPDATE/DELETE ficam só com a conexão de serviço (seed por migration / tela de Acessos via RPC guardada).

-- 3) Resolver read-only que o menu e o bloqueio de rota vão consumir.
CREATE OR REPLACE FUNCTION public.fn_rbac_modulos_do_papel(p_papel_slug text)
RETURNS TABLE(module_id text, nivel text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT rpm.module_id, rpm.nivel
  FROM public.rbac_papel_modulo rpm
  WHERE rpm.papel_slug = p_papel_slug;
$$;

COMMENT ON FUNCTION public.fn_rbac_modulos_do_papel(text) IS
  'F1: módulos (itens de menu) liberados por ITEM para um papel. Fonte para menu + bloqueio de rota.';

REVOKE ALL     ON FUNCTION public.fn_rbac_modulos_do_papel(text) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.fn_rbac_modulos_do_papel(text) TO   authenticated;

-- 4) Seed do papel TI / Suporte (ind_ti_suporte) — SÓ estes 3 itens de Administração.
--    conectores = editar (precisa testar a conexão); os outros = ver.
INSERT INTO public.rbac_papel_modulo (papel_slug, module_id, nivel, criado_por)
VALUES
  ('ind_ti_suporte', 'admin_conectores_erp',        'editar', 'desenvolvedor_5_g'),
  ('ind_ti_suporte', 'abastecimento_dados',         'ver',    'desenvolvedor_5_g'),
  ('ind_ti_suporte', 'admin_notificacoes_celular',  'ver',    'desenvolvedor_5_g')
ON CONFLICT (papel_slug, module_id) DO NOTHING;

COMMIT;
