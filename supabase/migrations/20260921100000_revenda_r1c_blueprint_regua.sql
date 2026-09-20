-- Revenda R1c · A RÉGUA no banco (DOCUMENTO VIVO V7, Parte III = 17 telas / 96 requisitos)
--
-- Fonte da verdade do que a Revenda DEVE ter, e onde ela está. Duas tabelas:
--   • blueprint_tela_requisito — a régua (o que cada tela precisa entregar), com o estado-baseline
--     auditado à mão pelo Eng. Chefe em 20/09/2026 (status_baseline + evidencia_baseline);
--   • blueprint_tela_cobertura — o que o JUIZ (R1d) grava a cada execução por requisito.
-- fn_blueprint_cobertura(vertical) devolve % por tela e geral, usando a avaliação MAIS RECENTE de
-- cada requisito (senão o baseline). Placar: atendido 1 · parcial 0,5 · ausente/travado/quebrado 0.
--
-- RLS: leitura só PS_ADMIN (área interna, Central de Desenvolvimento). Sem anon. Escrita: service_role
-- (o juiz/endpoint) bypassa RLS; nenhum papel authenticated escreve pela UI.
--
-- Prova (RD-38), só com o baseline (nenhuma cobertura ainda): geral 34,4% · essenciais 44,9% ·
-- por tela T1 40 · T2 20 · T3 27 · T4 50 · T5 40 · T6 62,5 · T7 20 · T8 35 · T9 17 · T10 36 ·
-- T11 0 · T12 0 · T13 50 · T14 17 · T15 67 · T16 0 · T17 0. (Conferido em rollback antes do merge.)

-- ── Régua ─────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.blueprint_tela_requisito (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vertical            text NOT NULL DEFAULT 'revenda_veiculos',
  tela_num            int  NOT NULL,
  tela_nome           text NOT NULL,
  rota_padrao         text,
  requisito           text NOT NULL,
  tipo                text,                                   -- kpi | bloco | campo | regra | guard | tela | visual
  prioridade          text NOT NULL DEFAULT 'essencial',      -- essencial | diferencial
  status_baseline     text NOT NULL DEFAULT 'ausente',        -- atendido | parcial | ausente | travado
  evidencia_baseline  text,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT blueprint_tela_requisito_uk UNIQUE (vertical, tela_num, requisito),
  CONSTRAINT blueprint_tela_requisito_prioridade_chk CHECK (prioridade IN ('essencial','diferencial')),
  CONSTRAINT blueprint_tela_requisito_status_chk CHECK (status_baseline IN ('atendido','parcial','ausente','travado'))
);
CREATE INDEX IF NOT EXISTS blueprint_tela_requisito_vertical_tela_idx
  ON public.blueprint_tela_requisito (vertical, tela_num);

-- ── Cobertura (o que o juiz grava) ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.blueprint_tela_cobertura (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requisito_id  uuid NOT NULL REFERENCES public.blueprint_tela_requisito(id) ON DELETE CASCADE,
  status        text NOT NULL,                                -- atendido | parcial | ausente | quebrado
  evidencia     text,
  foto_url      text,
  execucao_id   uuid,
  avaliado_em   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT blueprint_tela_cobertura_status_chk CHECK (status IN ('atendido','parcial','ausente','quebrado'))
);
CREATE INDEX IF NOT EXISTS blueprint_tela_cobertura_req_idx
  ON public.blueprint_tela_cobertura (requisito_id, avaliado_em DESC);
CREATE INDEX IF NOT EXISTS blueprint_tela_cobertura_execucao_idx
  ON public.blueprint_tela_cobertura (execucao_id);

-- ── RLS: leitura só PS_ADMIN, sem anon ──────────────────────────────────────────────────────────────
ALTER TABLE public.blueprint_tela_requisito ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blueprint_tela_cobertura ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS blueprint_tela_requisito_sel_ps_admin ON public.blueprint_tela_requisito;
CREATE POLICY blueprint_tela_requisito_sel_ps_admin ON public.blueprint_tela_requisito
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.system_role IN ('PS_ADMIN','PS_ADMIN_CVM')));

DROP POLICY IF EXISTS blueprint_tela_cobertura_sel_ps_admin ON public.blueprint_tela_cobertura;
CREATE POLICY blueprint_tela_cobertura_sel_ps_admin ON public.blueprint_tela_cobertura
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.system_role IN ('PS_ADMIN','PS_ADMIN_CVM')));

-- ── Carga da régua (baseline auditado 20/09/2026) ────────────────────────────────────────────────────
INSERT INTO public.blueprint_tela_requisito (tela_num, tela_nome, rota_padrao, requisito, tipo, prioridade, status_baseline, evidencia_baseline) VALUES
(1,'Painel do dono','/dashboard/revenda','Lucro real do mês (bruta ao lado, menor)','kpi','essencial','ausente','foto 20/09: não existe'),
(1,'Painel do dono','/dashboard/revenda','Capital no pátio','kpi','essencial','atendido','R$ 681.500'),
(1,'Painel do dono','/dashboard/revenda','Ponto de equilíbrio (vendidos ÷ necessários)','kpi','essencial','ausente',''),
(1,'Painel do dono','/dashboard/revenda','Bloco Sangria do pátio (R$/dia e 30 dias, aberto em ocupação/capital/depreciação)','bloco','diferencial','ausente',''),
(1,'Painel do dono','/dashboard/revenda','Bloco Vira prejuízo em breve (lista por data de virada, clique → ficha)','bloco','diferencial','ausente',''),
(1,'Painel do dono','/dashboard/revenda','Semáforo de pátio em faixas configuráveis, em dinheiro além da contagem','bloco','essencial','parcial','faixas e R$ sim; sangria/dia não'),
(1,'Painel do dono','/dashboard/revenda','Pendências como fila clicável (sem foto, sem preço, sem custo, sem nota, anúncio)','bloco','essencial','parcial','existe; faltam sem custo e anúncio'),
(1,'Painel do dono','/dashboard/revenda','Ranking por ROI anualizado','bloco','diferencial','ausente',''),
(1,'Painel do dono','/dashboard/revenda','Giro (vendas e dias médios)','kpi','essencial','atendido',''),
(1,'Painel do dono','/dashboard/revenda','Alerta COAF sem limite configurado','regra','essencial','atendido','aviso visível'),
(2,'Configuração da garagem','/dashboard/revenda/config','Tela própria /revenda/config','tela','essencial','ausente','só painel dentro da precificação'),
(2,'Configuração da garagem','/dashboard/revenda/config','Estrutura: vagas, área, endereço','campo','essencial','ausente',''),
(2,'Configuração da garagem','/dashboard/revenda/config','Custo fixo rateável por contas do plano (média 3 meses sugerida)','campo','diferencial','ausente',''),
(2,'Configuração da garagem','/dashboard/revenda/config','Capital: taxa % a.a., floor plan','campo','essencial','ausente',''),
(2,'Configuração da garagem','/dashboard/revenda/config','Depreciação: fonte e curva','campo','essencial','ausente',''),
(2,'Configuração da garagem','/dashboard/revenda/config','Garantia, comissão, impostos (%)','campo','essencial','atendido','painel encargos na precificação'),
(2,'Configuração da garagem','/dashboard/revenda/config','Semáforo (faixas de dias) e margem alvo','campo','essencial','parcial','margem sim; faixas sem tela'),
(2,'Configuração da garagem','/dashboard/revenda/config','Vistoria padrão (rápida/completa)','campo','essencial','parcial','no banco; sem campo na tela'),
(2,'Configuração da garagem','/dashboard/revenda/config','Custo de ocupação por veículo/dia calculado na hora','kpi','diferencial','ausente',''),
(2,'Configuração da garagem','/dashboard/revenda/config','Guard RD-51: sem config, indicadores de carrego = "não configurado" (nunca R$ 0)','guard','essencial','ausente',''),
(3,'Pátio','/dashboard/revenda/patio','Cards com foto, placa, modelo, ano, KM','bloco','essencial','parcial','sem foto e sem placa na demo'),
(3,'Pátio','/dashboard/revenda/patio','Dias no pátio com semáforo','campo','essencial','atendido',''),
(3,'Pátio','/dashboard/revenda/patio','Piso hoje e anunciado no card','campo','essencial','ausente',''),
(3,'Pátio','/dashboard/revenda/patio','Vira prejuízo em DD/MM no card','campo','diferencial','ausente',''),
(3,'Pátio','/dashboard/revenda/patio','Sangria R$/dia no card','campo','diferencial','ausente',''),
(3,'Pátio','/dashboard/revenda/patio','Alertas no card (sem custo, sem foto, sem vistoria, completude)','campo','essencial','atendido','sem vistoria e faltam campos'),
(3,'Pátio','/dashboard/revenda/patio','Modo lista densa (mobile)','bloco','essencial','ausente',''),
(3,'Pátio','/dashboard/revenda/patio','Mapa de calor do pátio','bloco','diferencial','ausente',''),
(3,'Pátio','/dashboard/revenda/patio','Filtros PS (vira prejuízo, sem custo, abaixo do piso, sem nota, ROI)','bloco','essencial','parcial','situação e completude apenas'),
(3,'Pátio','/dashboard/revenda/patio','Busca por modelo/placa','bloco','essencial','ausente',''),
(3,'Pátio','/dashboard/revenda/patio','Ações em massa com contagem antes/depois','bloco','diferencial','ausente',''),
(4,'Ficha do veículo','/dashboard/revenda/veiculo/[id]','Faixa "A conta deste carro" (comprei, custos, sobrepreço, carrego, piso, anunciado, lucro real, ROI)','bloco','essencial','parcial','entrada, aquisição, custo, preço mínimo'),
(4,'Ficha do veículo','/dashboard/revenda/veiculo/[id]','Preço mínimo da fonte única','regra','essencial','atendido','R$ 57.763,98 = precificação'),
(4,'Ficha do veículo','/dashboard/revenda/veiculo/[id]','Trilha de estado (entrada→…→garantia) com motivo da trava','bloco','essencial','ausente',''),
(4,'Ficha do veículo','/dashboard/revenda/veiculo/[id]','Abas por assunto','bloco','essencial','parcial','seções empilhadas'),
(4,'Ficha do veículo','/dashboard/revenda/veiculo/[id]','Barra de completude para emitir nota','bloco','essencial','atendido','5 de 7 campos'),
(4,'Ficha do veículo','/dashboard/revenda/veiculo/[id]','Detalhes gravam e limpam (#49)','regra','essencial','atendido','prova em ROLLBACK'),
(4,'Ficha do veículo','/dashboard/revenda/veiculo/[id]','Linha do tempo do valor (piso × mercado)','bloco','diferencial','ausente',''),
(4,'Ficha do veículo','/dashboard/revenda/veiculo/[id]','Histórico CRIOU/ALTEROU/EXCLUIU','bloco','essencial','ausente',''),
(5,'Ficha técnica','/dashboard/revenda/completar','Campos fiscais (placa, Renavam, chassi, combustível, potência, cilindradas, cor, portas, anos)','campo','essencial','atendido','ficha + completar em lista'),
(5,'Ficha técnica','/dashboard/revenda/completar','Tipo carro/moto/caminhão/máquina','campo','essencial','ausente','CB 500 na lista de carros'),
(5,'Ficha técnica','/dashboard/revenda/completar','Catálogo de modelos (cadastra uma vez, herda)','bloco','diferencial','atendido',''),
(5,'Ficha técnica','/dashboard/revenda/completar','Leitura do CRLV por IA com confirmação humana','bloco','diferencial','ausente',''),
(5,'Ficha técnica','/dashboard/revenda/completar','Upload do CRLV com visualizador','bloco','essencial','ausente',''),
(6,'Vistoria','/dashboard/revenda/veiculo/[id]/vistoria','Estado do item em 4 níveis','regra','essencial','atendido',''),
(6,'Vistoria','/dashboard/revenda/veiculo/[id]/vistoria','Mobile-first, uma pergunta por tela','bloco','essencial','atendido',''),
(6,'Vistoria','/dashboard/revenda/veiculo/[id]/vistoria','Rápida (9) padrão + completa opcional; abrir não cria','regra','essencial','atendido','auditado 20/09 08:46'),
(6,'Vistoria','/dashboard/revenda/veiculo/[id]/vistoria','Foto obrigatória (rápida: só reparo/troca) bloqueia conclusão','guard','essencial','parcial','no banco; clique não auditado'),
(6,'Vistoria','/dashboard/revenda/veiculo/[id]/vistoria','Previsão de gastos alimenta a precificação','regra','essencial','atendido','Corolla R$ 900'),
(6,'Vistoria','/dashboard/revenda/veiculo/[id]/vistoria','Checklist cadastrável por empresa e tipo de veículo','bloco','diferencial','ausente',''),
(6,'Vistoria','/dashboard/revenda/veiculo/[id]/vistoria','Sugestão de custo pelo histórico','bloco','diferencial','parcial','fn_insp_sugestao_gasto existe'),
(6,'Vistoria','/dashboard/revenda/veiculo/[id]/vistoria','Previsto × realizado por item','bloco','diferencial','ausente',''),
(7,'Custos','/dashboard/revenda/veiculo/[id]/custos','Lançamento por categoria com entra_base_fiscal','bloco','essencial','parcial','custos lançados existem; sem tela própria'),
(7,'Custos','/dashboard/revenda/veiculo/[id]/custos','Disparo para erp_pagar da GE','regra','essencial','parcial','fn_veic_custo_gerar_pagar existe'),
(7,'Custos','/dashboard/revenda/veiculo/[id]/custos','Previsto × realizado lado a lado','bloco','diferencial','ausente',''),
(7,'Custos','/dashboard/revenda/veiculo/[id]/custos','Bloco carrego calculado (ocupação, capital, depreciação) com badge honesto','bloco','essencial','ausente',''),
(7,'Custos','/dashboard/revenda/veiculo/[id]/custos','Alerta de custo fora da curva','bloco','diferencial','ausente',''),
(8,'Precificação','/dashboard/revenda/veiculo/[id]/precificacao','Custo total (aquisição + custos + previsão)','bloco','essencial','atendido',''),
(8,'Precificação','/dashboard/revenda/veiculo/[id]/precificacao','Encargos e preço mínimo por dentro (fonte única) + piso sem margem','regra','essencial','atendido','R0.1'),
(8,'Precificação','/dashboard/revenda/veiculo/[id]/precificacao','Simulador reverso (preço → margem → teto de compra)','bloco','essencial','atendido','quero vender por / teto'),
(8,'Precificação','/dashboard/revenda/veiculo/[id]/precificacao','Simulador com carrego','bloco','essencial','ausente',''),
(8,'Precificação','/dashboard/revenda/veiculo/[id]/precificacao','Três cenários 30/60/120 dias','bloco','diferencial','ausente',''),
(8,'Precificação','/dashboard/revenda/veiculo/[id]/precificacao','Giro do modelo → recomendação','bloco','diferencial','ausente',''),
(8,'Precificação','/dashboard/revenda/veiculo/[id]/precificacao','Comparação com o próprio estoque do modelo','bloco','essencial','ausente',''),
(8,'Precificação','/dashboard/revenda/veiculo/[id]/precificacao','Recusar item da avaliação','bloco','essencial','ausente',''),
(8,'Precificação','/dashboard/revenda/veiculo/[id]/precificacao','Histórico de precificação','bloco','essencial','parcial','campo historico no retorno'),
(8,'Precificação','/dashboard/revenda/veiculo/[id]/precificacao','Selo de frescor da fonte de valor (FIPE ou manual)','regra','essencial','ausente',''),
(9,'Negociação','/dashboard/revenda/negociacao/[id]','Tela própria de negociação','tela','essencial','ausente',''),
(9,'Negociação','/dashboard/revenda/negociacao/[id]','Composição real do negócio (sobrepreço embutido na troca)','bloco','essencial','parcial','desconto da troca aparece na venda'),
(9,'Negociação','/dashboard/revenda/negociacao/[id]','Simulador de fechamento ao vivo com alçada','bloco','diferencial','ausente',''),
(9,'Negociação','/dashboard/revenda/negociacao/[id]','Financiamento com retorno do banco como receita','regra','essencial','parcial','banco deve aparece'),
(9,'Negociação','/dashboard/revenda/negociacao/[id]','Alerta COAF na operação em espécie','regra','essencial','ausente',''),
(9,'Negociação','/dashboard/revenda/negociacao/[id]','Débitos, agendamento, contratos, notas de entrada/saída','bloco','essencial','ausente',''),
(10,'Venda e entrega','/dashboard/revenda/vendas','Recebimentos por parte (cliente, banco)','bloco','essencial','atendido','HB20 12.000/50.000'),
(10,'Venda e entrega','/dashboard/revenda/vendas','Trava de entrega sem nota (exceção PS_ADMIN justificada)','guard','essencial','atendido','R0.2'),
(10,'Venda e entrega','/dashboard/revenda/vendas','Checklist de entrega','bloco','essencial','ausente',''),
(10,'Venda e entrega','/dashboard/revenda/vendas','Termo de entrega assinado','bloco','essencial','ausente',''),
(10,'Venda e entrega','/dashboard/revenda/vendas','Acerto de contas previsto × realizado ao fechar','bloco','diferencial','ausente',''),
(10,'Venda e entrega','/dashboard/revenda/vendas','Venda entregue não cancela sem regra de devolução','guard','essencial','ausente','Compass entregue oferece cancelar'),
(10,'Venda e entrega','/dashboard/revenda/vendas','Disparo para erp_receber da GE','regra','essencial','parcial','títulos existem'),
(11,'Fiscal do usado','/dashboard/revenda/fiscal','PIS/COFINS sobre a diferença, redução ICMS, CFOP/CST, livros','tela','essencial','travado','questionário do contador'),
(12,'Garantia','/dashboard/revenda/garantia','Vigência, provisão, acionamento com OS, sinistro por modelo','tela','diferencial','travado','plano de contas/D'),
(13,'Preparação (OS)','/dashboard/revenda/preparacao','Kanban A fazer | Fazendo | Finalizado reusando a OS da Oficina','bloco','essencial','atendido','2 OS demo'),
(13,'Preparação (OS)','/dashboard/revenda/preparacao','Custo da OS volta para veic_custo','regra','essencial','parcial','texto da tela; não auditado'),
(13,'Preparação (OS)','/dashboard/revenda/preparacao','OS aberta trava o anúncio','guard','diferencial','ausente',''),
(13,'Preparação (OS)','/dashboard/revenda/preparacao','Dias em oficina no carrego','regra','diferencial','ausente',''),
(13,'Preparação (OS)','/dashboard/revenda/preparacao','Paleta PS (sem cor decorativa)','visual','essencial','atendido','R0.6'),
(14,'Fotos e anúncio','/dashboard/revenda/veiculo/[id]/fotos','Upload de fotos que persiste (#1580)','regra','essencial','parcial','correção no ar; prova pendente'),
(14,'Fotos e anúncio','/dashboard/revenda/veiculo/[id]/fotos','Ordem, capa, marca d’água, bucket privado','bloco','essencial','ausente',''),
(14,'Fotos e anúncio','/dashboard/revenda/veiculo/[id]/fotos','Publicação em portais e custo por lead','bloco','diferencial','ausente',''),
(15,'CRM / O que comprar','/dashboard/revenda/demanda','Procura registrada cruzada com o pátio','bloco','diferencial','atendido','4 procuras × pátio'),
(15,'CRM / O que comprar','/dashboard/revenda/demanda','Pátio por marca e o que já vendeu','bloco','essencial','atendido',''),
(15,'CRM / O que comprar','/dashboard/revenda/demanda','Kanban de leads reusando o CRM da GE com veículo de interesse','bloco','essencial','ausente',''),
(16,'Consulta veicular','—','Provedor configurável, custo rateado no veículo (desligado por padrão)','tela','diferencial','travado','decisão FIPE/custo'),
(17,'Relatórios','/dashboard/revenda/relatorios','Lucro real por veículo e por vendedor, comissão sobre lucro','tela','essencial','ausente',''),
(17,'Relatórios','/dashboard/revenda/relatorios','Sangria por mês, curva de encalhe, ROI por modelo, acerto de precificação','tela','diferencial','ausente','')
ON CONFLICT (vertical, tela_num, requisito) DO NOTHING;

-- ── fn_blueprint_cobertura(vertical) ────────────────────────────────────────────────────────────────
-- % por tela e geral. Efetivo = avaliação mais recente do requisito (senão o baseline).
-- Placar: atendido 1 · parcial 0,5 · ausente/travado/quebrado 0. Só PS_ADMIN (área interna).
CREATE OR REPLACE FUNCTION public.fn_blueprint_cobertura(p_vertical text DEFAULT 'revenda_veiculos')
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_out jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND system_role IN ('PS_ADMIN','PS_ADMIN_CVM')) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'apenas_ps_admin');
  END IF;

  WITH efetivo AS (
    SELECT r.id, r.tela_num, r.tela_nome, r.prioridade,
      COALESCE(
        (SELECT c.status FROM blueprint_tela_cobertura c
           WHERE c.requisito_id = r.id ORDER BY c.avaliado_em DESC LIMIT 1),
        r.status_baseline
      ) AS status_efetivo
    FROM blueprint_tela_requisito r
    WHERE r.vertical = p_vertical
  ),
  scored AS (
    SELECT tela_num, tela_nome, prioridade, status_efetivo,
      CASE status_efetivo WHEN 'atendido' THEN 1.0 WHEN 'parcial' THEN 0.5 ELSE 0 END AS score
    FROM efetivo
  ),
  por_tela AS (
    SELECT tela_num, min(tela_nome) AS tela_nome,
      count(*) AS requisitos,
      count(*) FILTER (WHERE status_efetivo IN ('atendido','parcial')) AS com_algo,
      round(100.0*avg(score), 1) AS pct,
      round(100.0*avg(score) FILTER (WHERE prioridade='essencial'), 1) AS pct_essenciais
    FROM scored GROUP BY tela_num
  )
  SELECT jsonb_build_object(
    'ok', true,
    'vertical', p_vertical,
    'gerado_em', now(),
    'total_requisitos', (SELECT count(*) FROM scored),
    'geral_pct', (SELECT round(100.0*avg(score),1) FROM scored),
    'essenciais_pct', (SELECT round(100.0*avg(score) FILTER (WHERE prioridade='essencial'),1) FROM scored),
    'por_tela', (SELECT jsonb_agg(jsonb_build_object(
        'tela_num', tela_num, 'tela_nome', tela_nome, 'pct', pct,
        'pct_essenciais', pct_essenciais, 'requisitos', requisitos, 'com_algo', com_algo
      ) ORDER BY tela_num) FROM por_tela)
  ) INTO v_out;
  RETURN v_out;
END $function$;

REVOKE ALL ON FUNCTION public.fn_blueprint_cobertura(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_blueprint_cobertura(text) TO authenticated, service_role;
