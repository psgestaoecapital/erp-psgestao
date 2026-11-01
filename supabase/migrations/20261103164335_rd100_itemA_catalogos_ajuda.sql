-- RD-100 (CEO 01/11, INEGOCIÁVEL) — Item A: remover nomes de sistemas de terceiros
-- dos CATÁLOGOS e da AJUDA de campo (texto VISÍVEL ao usuário).
--
-- Escopo desta migration (colunas visíveis ao usuário):
--   module_catalog.nome, module_catalog.descricao
--   system_screens.titulo, system_screens.descricao_funcional
--   erp_ajuda_campo.rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum
--   feature_catalog.titulo
--
-- FORA DE ESCOPO (deliberado — decisão do GATE item E / Eng. Chefe):
--   - Colunas de metadados internos (não visíveis ao cliente): feature_catalog.descricao_executiva,
--     descricao_tecnica, observacao; system_screens.observacoes. Essas trazem notas de posicionamento
--     competitivo e de dev ("Diferencial vs ...", "Omie/Hooked") e UM FALSO-POSITIVO que NÃO pode ser
--     alterado: system_screens.observacoes de dashboard.financeiro.pagar cita "OMIE R$ 900 PS LTDA",
--     que é NOME DE CONTA/CLIENTE num registro de validação do CEO, não o produto Omie. Não se apaga
--     dado de cliente (RD-38/RD-100). O gate (item E) decide se e como trata essas colunas.
--   - Rotas/ids (/dashboard/pm/importar-siga, /contaazul-callback): renomeação + redirect é o item B.
--
-- Substituições por termo genérico, preservando o resto do texto. Idempotente (replace exato por frase;
-- re-rodar não encontra a frase antiga e não faz nada). Backup integral das linhas tocadas ANTES.
-- Aditiva: não apaga linha nem toca dado de cliente.

BEGIN;

-- 1) BACKUP (idempotente): guarda o valor ANTES de cada célula que ainda contém nome de terceiro
CREATE TABLE IF NOT EXISTS public.erp_rd100_catalogos_bkp (
  id          bigserial PRIMARY KEY,
  tabela      text NOT NULL,
  pk          text NOT NULL,
  coluna      text NOT NULL,
  valor_antes text,
  migrado_em  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.erp_rd100_catalogos_bkp IS
  'RD-100 item A: cópia de segurança do texto de catálogos/ajuda antes da limpeza de nomes de terceiros. Tabela global de ops (sem company_id, sem dado de cliente).';
ALTER TABLE public.erp_rd100_catalogos_bkp ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_rd100_catalogos_bkp FROM anon;
-- sem policy p/ anon/authenticated: acesso só pela conexão de serviço (ops). Sem dado de cliente.

INSERT INTO public.erp_rd100_catalogos_bkp (tabela, pk, coluna, valor_antes)
SELECT t.tabela, t.pk, t.coluna, t.valor
FROM (
  SELECT 'module_catalog' tabela, id pk, 'nome' coluna, nome valor FROM public.module_catalog
  UNION ALL SELECT 'module_catalog', id, 'descricao', descricao FROM public.module_catalog
  UNION ALL SELECT 'system_screens', id, 'titulo', titulo FROM public.system_screens
  UNION ALL SELECT 'system_screens', id, 'descricao_funcional', descricao_funcional FROM public.system_screens
  UNION ALL SELECT 'erp_ajuda_campo', chave, 'rotulo', rotulo FROM public.erp_ajuda_campo
  UNION ALL SELECT 'erp_ajuda_campo', chave, 'o_que_preencher', o_que_preencher FROM public.erp_ajuda_campo
  UNION ALL SELECT 'erp_ajuda_campo', chave, 'para_que_serve', para_que_serve FROM public.erp_ajuda_campo
  UNION ALL SELECT 'erp_ajuda_campo', chave, 'exemplo', exemplo FROM public.erp_ajuda_campo
  UNION ALL SELECT 'erp_ajuda_campo', chave, 'erro_comum', erro_comum FROM public.erp_ajuda_campo
  UNION ALL SELECT 'feature_catalog', id, 'titulo', titulo FROM public.feature_catalog
) t
WHERE (
    t.valor ~* '(Omie|Conta ?Azul|ContaAzul|Olist|Bling|Sienge|Obra Prima|Procore|Buildertrend|JobTread|CoConstruct|Knowify|Assembly|TOTVS|Protheus|Dotise|QuickBooks|Mobuss|Prevision|NIBO|Nibo|Aplix)'
    OR t.valor ~ '\m(SIGA|Siga|Senior)\M'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.erp_rd100_catalogos_bkp b
    WHERE b.tabela = t.tabela AND b.pk = t.pk AND b.coluna = t.coluna
  );

-- 2) LIMPEZA — module_catalog
UPDATE public.module_catalog SET nome = replace(nome, 'Importar do SIGA', 'Importar do sistema anterior')
  WHERE nome LIKE '%Importar do SIGA%';
UPDATE public.module_catalog SET descricao = replace(descricao, 'ao nível ContaAzul+Omie', 'ao nível de mercado')
  WHERE descricao LIKE '%ao nível ContaAzul+Omie%';
UPDATE public.module_catalog SET descricao = replace(descricao, 'origem (Omie, SIGA, ContaAzul)', 'origem (sistemas de mercado)')
  WHERE descricao LIKE '%origem (Omie, SIGA, ContaAzul)%';
UPDATE public.module_catalog SET descricao = replace(descricao, 'sync com Omie/SIGA', 'sync com sistemas de mercado')
  WHERE descricao LIKE '%sync com Omie/SIGA%';

-- 3) LIMPEZA — system_screens
UPDATE public.system_screens SET titulo = replace(titulo, 'Importar do SIGA', 'Importar do sistema anterior')
  WHERE titulo LIKE '%Importar do SIGA%';
UPDATE public.system_screens SET titulo = replace(titulo, 'ContaAzul Callback', 'Retorno de integração (callback)')
  WHERE titulo LIKE '%ContaAzul Callback%';
UPDATE public.system_screens SET descricao_funcional = replace(descricao_funcional, 'OAuth callback ContaAzul', 'OAuth callback da integração')
  WHERE descricao_funcional LIKE '%OAuth callback ContaAzul%';
UPDATE public.system_screens SET descricao_funcional = replace(descricao_funcional, 'ContaAzul-like', 'padrão de mercado')
  WHERE descricao_funcional LIKE '%ContaAzul-like%';
UPDATE public.system_screens SET descricao_funcional = replace(descricao_funcional, 'Omie/SIGA/Nibo', 'integrações de mercado')
  WHERE descricao_funcional LIKE '%Omie/SIGA/Nibo%';

-- 4) LIMPEZA — feature_catalog (titulo)
UPDATE public.feature_catalog SET titulo = replace(titulo, 'Sync Status - Omie/Nibo health', 'Sync Status - saúde da integração')
  WHERE titulo LIKE '%Sync Status - Omie/Nibo health%';
UPDATE public.feature_catalog SET titulo = replace(titulo, 'Preset Omie', 'Preset de importação (layout A)')
  WHERE titulo LIKE '%Preset Omie%';
UPDATE public.feature_catalog SET titulo = replace(titulo, 'Preset SIGA', 'Preset de importação (layout B)')
  WHERE titulo LIKE '%Preset SIGA%';

-- 5) LIMPEZA — erp_ajuda_campo (texto da ajuda, tudo visível no "?")
UPDATE public.erp_ajuda_campo SET rotulo = replace(rotulo, 'Planilha do SIGA', 'Planilha do sistema anterior')
  WHERE rotulo LIKE '%Planilha do SIGA%';
UPDATE public.erp_ajuda_campo SET rotulo = replace(rotulo, 'Sincronizar estoque com Omie', 'Sincronizar estoque com o sistema externo')
  WHERE rotulo LIKE '%Sincronizar estoque com Omie%';
UPDATE public.erp_ajuda_campo SET rotulo = replace(rotulo, 'Sincronizar contas a pagar com Omie', 'Sincronizar contas a pagar com o sistema externo')
  WHERE rotulo LIKE '%Sincronizar contas a pagar com Omie%';

UPDATE public.erp_ajuda_campo SET o_que_preencher = replace(o_que_preencher, 'jobs do SIGA', 'jobs do sistema anterior')
  WHERE o_que_preencher LIKE '%jobs do SIGA%';
UPDATE public.erp_ajuda_campo SET o_que_preencher = replace(o_que_preencher, 'estoque no Omie', 'estoque no sistema externo')
  WHERE o_que_preencher LIKE '%estoque no Omie%';
UPDATE public.erp_ajuda_campo SET o_que_preencher = replace(o_que_preencher, 'feitos pelo Omie', 'feitos pelo sistema externo')
  WHERE o_que_preencher LIKE '%feitos pelo Omie%';

UPDATE public.erp_ajuda_campo SET para_que_serve = replace(para_que_serve, 'importar do SIGA', 'importar do sistema anterior')
  WHERE para_que_serve LIKE '%importar do SIGA%';
UPDATE public.erp_ajuda_campo SET para_que_serve = replace(para_que_serve, 'nasce no Omie', 'nasce no sistema externo')
  WHERE para_que_serve LIKE '%nasce no Omie%';

UPDATE public.erp_ajuda_campo SET exemplo = replace(exemplo, 'emitida pelo OMIE', 'emitida pelo sistema externo')
  WHERE exemplo LIKE '%emitida pelo OMIE%';
UPDATE public.erp_ajuda_campo SET exemplo = replace(exemplo, 'Faturada no OMIE', 'Faturada no sistema externo')
  WHERE exemplo LIKE '%Faturada no OMIE%';

UPDATE public.erp_ajuda_campo SET erro_comum = replace(erro_comum, 'existe no SIGA', 'existe no sistema anterior')
  WHERE erro_comum LIKE '%existe no SIGA%';
UPDATE public.erp_ajuda_campo SET erro_comum = replace(erro_comum, 'os do SIGA', 'os do sistema anterior')
  WHERE erro_comum LIKE '%os do SIGA%';
UPDATE public.erp_ajuda_campo SET erro_comum = replace(erro_comum, 'com o Omie configurada', 'com o sistema externo configurada')
  WHERE erro_comum LIKE '%com o Omie configurada%';

-- 6) SELF-CHECK: nenhuma das colunas em escopo pode conter nome de terceiro depois.
DO $$
DECLARE v_rest int;
BEGIN
  SELECT count(*) INTO v_rest FROM (
    SELECT nome v FROM public.module_catalog
    UNION ALL SELECT descricao FROM public.module_catalog
    UNION ALL SELECT titulo FROM public.system_screens
    UNION ALL SELECT descricao_funcional FROM public.system_screens
    UNION ALL SELECT rotulo FROM public.erp_ajuda_campo
    UNION ALL SELECT o_que_preencher FROM public.erp_ajuda_campo
    UNION ALL SELECT para_que_serve FROM public.erp_ajuda_campo
    UNION ALL SELECT exemplo FROM public.erp_ajuda_campo
    UNION ALL SELECT erro_comum FROM public.erp_ajuda_campo
    UNION ALL SELECT titulo FROM public.feature_catalog
  ) q
  WHERE v ~* '\m(Omie|Conta ?Azul|ContaAzul|Olist|Bling|Sienge|Obra Prima|Procore|Buildertrend|JobTread|CoConstruct|Knowify|Assembly|TOTVS|Protheus|Dotise|QuickBooks|Mobuss|Prevision|NIBO|Nibo|Aplix)\M'
     OR v ~ '\m(SIGA|Siga|Senior)\M';
  IF v_rest > 0 THEN
    RAISE EXCEPTION 'RD-100 item A: ainda restam % célula(s) com nome de terceiro nas colunas em escopo', v_rest;
  END IF;
END $$;

COMMIT;
