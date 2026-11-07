-- Onboarding guiado · Fase 1 (parte 1) — CONFIG DECLARATIVA das etapas (CEO 07/11).
-- REUSA a fundação existente (erp_onboarding_progresso, fn_onboarding_maturidade, fn_ge_onboarding_status):
-- aqui só adicionamos a CAMADA DECLARATIVA. Um motor genérico (parte seguinte) lê esta config e monta a trilha
-- por vertical — adicionar vertical/passo = adicionar LINHAS, não reescrever código.
-- ADITIVA (RD-94.1c): tabela + função NOVAS, nada é alterado/apagado no que já existe. Catálogo GLOBAL (sem dado de
-- cliente, sem company_id): RLS ligada, SELECT só para autenticado, REVOKE anon, escrita só por migration.
-- Decisões do CEO embutidas no seed: (a) a GE vem SEMPRE primeiro; (b) o de-para contábil vem PRÉ-PREENCHIDO
-- (pendência de decisão = o usuário só valida); (c) todo passo é PULÁVEL, mas a pendência FICA até resolver.

-- 1) Tabela declarativa das etapas -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.erp_onboarding_etapa_config (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vertical           text NOT NULL,                 -- ex.: 'gestao_empresarial'
  modulo             text NOT NULL,                 -- agrupa o passo (alinha com erp_onboarding_progresso.modulo)
  passo              text NOT NULL,                 -- chave do passo (alinha com erp_onboarding_progresso.passo)
  ordem              integer NOT NULL,              -- ordem na trilha
  titulo             text NOT NULL,                 -- título curto (linguagem do dono)
  orientacao         text NOT NULL,                 -- o que é / por que importa, em linguagem do dono
  rota_destino       text NOT NULL,                 -- leva DIRETO à tela que resolve o passo
  deteccao_chave     text NOT NULL,                 -- detector nomeado que o motor mapeia p/ "concluído pelo dado real"
  pulavel            boolean NOT NULL DEFAULT true,  -- CEO: todo passo é pulável
  pendencia_decisao  boolean NOT NULL DEFAULT false, -- CEO: aviso de pendência fica até resolver (ex.: de-para)
  ativo              boolean NOT NULL DEFAULT true,
  criado_em          timestamptz NOT NULL DEFAULT now(),
  atualizado_em      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT erp_onboarding_etapa_config_uq UNIQUE (vertical, modulo, passo),
  CONSTRAINT erp_onboarding_etapa_config_ordem_chk CHECK (ordem > 0)
);

COMMENT ON TABLE public.erp_onboarding_etapa_config IS
  'Config declarativa das etapas do onboarding guiado por vertical (CEO 07/11). Catálogo global, sem dado de cliente; o motor genérico lê daqui e cruza com erp_onboarding_progresso.';

CREATE INDEX IF NOT EXISTS erp_onboarding_etapa_config_vertical_idx
  ON public.erp_onboarding_etapa_config (vertical, ordem) WHERE ativo;

-- 2) Segurança (mesmo padrão do catálogo erp_ajuda_campo) --------------------------------------------------------
ALTER TABLE public.erp_onboarding_etapa_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS onboarding_etapa_config_sel ON public.erp_onboarding_etapa_config;
CREATE POLICY onboarding_etapa_config_sel ON public.erp_onboarding_etapa_config
  FOR SELECT TO authenticated USING (ativo OR public.is_admin());
REVOKE ALL ON public.erp_onboarding_etapa_config FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.erp_onboarding_etapa_config FROM authenticated;
GRANT SELECT ON public.erp_onboarding_etapa_config TO authenticated;

-- 3) Leitor do catálogo (puro: só config global, sem dado de cliente) --------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_onboarding_etapas(p_vertical text)
RETURNS TABLE (
  modulo text, passo text, ordem integer, titulo text, orientacao text,
  rota_destino text, deteccao_chave text, pulavel boolean, pendencia_decisao boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT c.modulo, c.passo, c.ordem, c.titulo, c.orientacao,
         c.rota_destino, c.deteccao_chave, c.pulavel, c.pendencia_decisao
  FROM public.erp_onboarding_etapa_config c
  WHERE c.ativo AND c.vertical = p_vertical
  ORDER BY c.ordem;
$$;
REVOKE ALL ON FUNCTION public.fn_onboarding_etapas(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_onboarding_etapas(text) TO authenticated, service_role;

-- 4) Seed do NÚCLEO GE (CEO: a GE sempre primeira) — idempotente ------------------------------------------------
INSERT INTO public.erp_onboarding_etapa_config
  (vertical, modulo, passo, ordem, titulo, orientacao, rota_destino, deteccao_chave, pulavel, pendencia_decisao)
VALUES
  ('gestao_empresarial','gestao_empresarial','dados_empresa',1,
   'Dados da empresa',
   'Confirme CNPJ, razão social, endereço e regime tributário. É a base de notas, relatórios e impostos — sem isso, nada sai certo.',
   '/dashboard/configuracoes/empresa','ge_empresa',true,false),
  ('gestao_empresarial','gestao_empresarial','usuarios_acessos',2,
   'Usuários e acessos',
   'Convide sua equipe e defina o que cada pessoa pode ver e fazer. Cada um acessa só o que precisa.',
   '/dashboard/admin/acessos','ge_usuarios',true,false),
  ('gestao_empresarial','gestao_empresarial','contas_bancarias',3,
   'Contas bancárias',
   'Cadastre as contas onde entra e sai dinheiro. É o que liga pagamentos, recebimentos e conciliação ao banco.',
   '/dashboard/cadastros/contas-bancarias','ge_contas',true,false),
  ('gestao_empresarial','gestao_empresarial','plano_contas',4,
   'Plano de contas e de-para',
   'Organize suas categorias de receita e despesa. Já trazemos uma sugestão pronta — você só confere e ajusta. É o que faz o resultado e o DRE baterem.',
   '/dashboard/cadastros/plano-contas','ge_plano_contas',true,true),
  ('gestao_empresarial','gestao_empresarial','clientes_fornecedores',5,
   'Clientes e fornecedores',
   'Cadastre quem você vende e de quem você compra. Alimenta vendas, compras, contas a pagar e a receber.',
   '/dashboard/cadastros/clientes','ge_cadastros',true,false)
ON CONFLICT (vertical, modulo, passo) DO UPDATE SET
  ordem             = EXCLUDED.ordem,
  titulo            = EXCLUDED.titulo,
  orientacao        = EXCLUDED.orientacao,
  rota_destino      = EXCLUDED.rota_destino,
  deteccao_chave    = EXCLUDED.deteccao_chave,
  pulavel           = EXCLUDED.pulavel,
  pendencia_decisao = EXCLUDED.pendencia_decisao,
  ativo             = true,
  atualizado_em     = now();
