-- PDCA automático de qualidade das telas (CEO 09/10, opção A) · fatia P: JORNADAS por vertical.
-- Aditiva: 2 tabelas novas (erp_pdca_jornada, erp_pdca_jornada_passo), RLS ligada, sem acesso a anon/authenticated
-- (só service_role: o robô D e o motor C/A rodam com a conexão de serviço). Nenhum dado de cliente é tocado.
-- consulta_sql do passo: SELECT só-leitura que recebe :company_id e devolve 1 linha (valor numérico "esperado_sql" vs "obtido").
-- O robô (fatia D) executa os passos nas DEMO; a fatia C compara tela × banco; a fatia A abre mensagem na caixa do Code dono.

CREATE TABLE IF NOT EXISTS public.erp_pdca_jornada (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vertical      text NOT NULL,
  codigo        text NOT NULL,
  nome          text NOT NULL,
  empresa_demo  uuid,                       -- companies.id (is_demo) onde o robô executa
  code_dono     text NOT NULL,              -- identificador da caixa que recebe a falha (fatia A)
  ativa         boolean NOT NULL DEFAULT true,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vertical, codigo)
);

CREATE TABLE IF NOT EXISTS public.erp_pdca_jornada_passo (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jornada_id      uuid NOT NULL REFERENCES public.erp_pdca_jornada(id) ON DELETE CASCADE,
  ordem           int  NOT NULL,
  passo           text NOT NULL,            -- o que o usuário quer fazer
  rota            text NOT NULL,            -- rota do ERP
  acao            text NOT NULL,            -- o que o robô clica/salva
  deve_aparecer   text NOT NULL,            -- o que tem de estar na tela depois
  consulta_sql    text,                     -- SELECT só-leitura (:company_id) do número que tem de bater
  regras          jsonb NOT NULL DEFAULT '{}'::jsonb,  -- ex.: {"ajuda_campo":true,"viewports":[1366,1920,390]}
  UNIQUE (jornada_id, ordem),
  CONSTRAINT erp_pdca_passo_sql_select CHECK (consulta_sql IS NULL OR consulta_sql ~* '^\s*select\M')
);

ALTER TABLE public.erp_pdca_jornada ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_pdca_jornada_passo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_pdca_jornada, public.erp_pdca_jornada_passo FROM anon, authenticated;
GRANT ALL ON public.erp_pdca_jornada, public.erp_pdca_jornada_passo TO service_role;

-- Jornada 1 · Hub: cliente → oportunidade → proposta → ganha → obra → compra → resultado (Construtora Modelo - DEMO)
INSERT INTO public.erp_pdca_jornada (vertical, codigo, nome, empresa_demo, code_dono)
VALUES ('hub','HUB-J1','Do cliente ao resultado da obra','b0700000-0000-4000-a000-000000000006','gilberto-chamados'),
       ('ge','GE-J1','Do contas a pagar à DRE', NULL,'gilberto-chamados')
ON CONFLICT (vertical, codigo) DO NOTHING;

INSERT INTO public.erp_pdca_jornada_passo (jornada_id, ordem, passo, rota, acao, deve_aparecer, consulta_sql, regras)
SELECT j.id, p.ordem, p.passo, p.rota, p.acao, p.deve_aparecer, p.consulta_sql, '{"ajuda_campo":true,"viewports":[1366,1920,390]}'::jsonb
FROM public.erp_pdca_jornada j
JOIN (VALUES
 ('HUB-J1',1,'Cadastrar o cliente','/dashboard/projetos/clientes','Novo cliente, preencher e salvar','Cliente na lista, sem erro de console',
   'select count(*)::numeric from erp_clientes where company_id = :company_id'),
 ('HUB-J1',2,'Abrir a oportunidade','/dashboard/projetos/oportunidades','Nova oportunidade ligada ao cliente','Oportunidade no funil',
   'select count(*)::numeric from erp_crm_oportunidade where company_id = :company_id'),
 ('HUB-J1',3,'Montar a proposta com itens','/dashboard/projetos/propostas','Nova proposta, adicionar itens do catálogo, salvar','Proposta com total = soma dos itens',NULL),
 ('HUB-J1',4,'Marcar como ganha','/dashboard/projetos/oportunidades','Mover a oportunidade para Ganha','Obra criada a partir da oportunidade',
   'select count(*)::numeric from projetos_obras where company_id = :company_id'),
 ('HUB-J1',5,'Lançar a compra da obra','/dashboard/projetos/obras','Abrir a obra, lançar compra de insumo','Compra no custo da obra',NULL),
 ('HUB-J1',6,'Ver o resultado','/dashboard/projetos/painel','Abrir o painel','Números do painel iguais ao banco (nada zerado sem explicação)',NULL),
 ('GE-J1',1,'Lançar conta a pagar','/dashboard/financeiro/contas-pagar','Nova conta a pagar, salvar','Conta na lista com status aberto',NULL),
 ('GE-J1',2,'Baixar a conta','/dashboard/financeiro/contas-pagar','Baixar a conta lançada','Status pago e saldo do caixa reduzido',NULL),
 ('GE-J1',3,'Conciliar','/dashboard/financeiro/conciliacao','Conciliar o lançamento com o extrato','Lançamento conciliado',NULL),
 ('GE-J1',4,'Conferir a DRE','/dashboard/financeiro/dre','Abrir a DRE do mês','Despesa lançada aparece na linha certa da DRE',NULL)
) AS p(jc, ordem, passo, rota, acao, deve_aparecer, consulta_sql) ON p.jc = j.codigo
ON CONFLICT (jornada_id, ordem) DO NOTHING;
