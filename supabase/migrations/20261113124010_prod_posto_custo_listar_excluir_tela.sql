-- Custeio por kg · fatia F3 (TELA) — leitura/exclusão dos custos do posto + "?" (RD-95) + system_screens.
-- Contexto 46b4527a (CEO 11/11), genérico para qualquer planta (bovinos, suínos, aves, serraria), RD-102.
--
-- A gravação já existe (fn_prod_posto_custo_salvar; backend dos campos gás/manutenção/depreciação vem na PR F3-backend
-- #4567). Faltava a tela poder LER o custo atual e EXCLUIR um lançamento. prod_posto_custo tem RLS ligada e NENHUMA policy
-- de SELECT — logo o cliente não lê a tabela direto. Esta migration adiciona 2 funções SECURITY DEFINER (guarda por
-- empresa do usuário) e os textos de ajuda da tela nova.
--
-- INDEPENDÊNCIA de #4567: fn_prod_posto_custo_listar devolve a linha inteira por to_jsonb(c.*) — NÃO cita gas_mes/
-- manutencao_mes/depreciacao_mes por nome, então compila e roda com ou sem essas colunas (quando #4567 entrar, elas
-- passam a aparecer no JSON sozinhas). Tudo ADITIVO: 2 funções NOVAS, nenhuma coluna/tabela nova, nenhum dado de cliente
-- alterado. RD-52: arquivo em supabase/migrations + PR, acima da main, faixa dev7 (:10).

-- ============================================================ 1) listar custos do posto (atual + histórico de vigências)
CREATE OR REPLACE FUNCTION public.fn_prod_posto_custo_listar(p_posto_id uuid)
RETURNS TABLE(id uuid, vigencia_inicio date, vigencia_fim date, atual boolean, dados jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_comp uuid;
BEGIN
  SELECT company_id INTO v_comp FROM public.prod_posto WHERE id = p_posto_id;
  IF v_comp IS NULL THEN RETURN; END IF;                                        -- posto inexistente → lista vazia
  IF NOT (v_comp IN (SELECT public.get_user_company_ids()) OR public.is_admin()) THEN RETURN; END IF;
  RETURN QUERY
    SELECT c.id,
           c.vigencia_inicio,
           c.vigencia_fim,
           (c.vigencia_fim IS NULL) AS atual,
           -- linha inteira, sem colunas de controle/pessoais; resiliente a colunas novas (gás/manut/deprec de #4567)
           (to_jsonb(c.*) - 'company_id' - 'plant_id' - 'criado_por' - 'deleted_at' - 'deleted_by') AS dados
      FROM public.prod_posto_custo c
     WHERE c.posto_id = p_posto_id
       AND c.deleted_at IS NULL
     ORDER BY c.vigencia_inicio DESC, c.created_at DESC;
END; $function$;

-- ============================================================ 2) excluir (lógico) um lançamento de custo do posto
CREATE OR REPLACE FUNCTION public.fn_prod_posto_custo_excluir(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_comp   uuid;
  v_posto  uuid;
  v_ini    date;
BEGIN
  SELECT company_id, posto_id, vigencia_inicio
    INTO v_comp, v_posto, v_ini
    FROM public.prod_posto_custo
   WHERE id = p_id AND deleted_at IS NULL;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrado'); END IF;  -- idempotente
  IF NOT (v_comp IN (SELECT public.get_user_company_ids()) OR public.is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;

  UPDATE public.prod_posto_custo
     SET deleted_at = now(), deleted_by = auth.uid()
   WHERE id = p_id;

  -- se era o lançamento vigente, reabre o anterior (tira a data-fim que o salvar tinha carimbado) — mantém histórico coerente
  UPDATE public.prod_posto_custo
     SET vigencia_fim = NULL
   WHERE posto_id = v_posto AND deleted_at IS NULL AND vigencia_fim = v_ini - 1;

  INSERT INTO public.audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior)
  VALUES (v_comp, auth.uid(), auth.jwt() ->> 'email', 'prod_posto_custo', p_id::text, 'prod_posto_custo_excluir',
          jsonb_build_object('posto_id', v_posto, 'vigencia_inicio', v_ini));

  RETURN jsonb_build_object('ok', true);
END; $function$;

-- ============================================================ grants (REVOKE anon — RD segurança)
REVOKE ALL ON FUNCTION public.fn_prod_posto_custo_listar(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_prod_posto_custo_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_posto_custo_listar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_prod_posto_custo_excluir(uuid) TO authenticated;

-- ============================================================ RD-95 · "?" de todo campo/ação da tela de Custos do posto
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
 ('prod.custos_posto.planta','/dashboard/produtividade/custos-posto','Custos do posto','Planta','A planta industrial cujos postos você vai custear (quando a empresa tem mais de uma).','Filtra os postos da planta escolhida; os custos ficam por planta.','Planta Matriz','—','industria',5,'publicado'),
 ('prod.custos_posto.posto','/dashboard/produtividade/custos-posto','Custos do posto','Posto de trabalho','O posto cujos custos de utilidades e estrutura você vai informar.','Cada posto guarda seu próprio custo mensal; é a base do custo por kg do produto (fatia F6).','Linha de embalagem','Lançar o custo no posto errado — confira o número e a atividade.','industria',10,'publicado'),
 ('prod.custos_posto.vigencia','/dashboard/produtividade/custos-posto','Custos do posto','Início da vigência','O 1º dia do mês a partir do qual estes valores valem.','Guarda o histórico: ao mudar o custo, o valor antigo é fechado e o novo passa a valer da data escolhida.','01/11/2026','Usar uma data no meio do mês — use sempre o 1º dia do mês de competência.','industria',20,'publicado'),
 ('prod.custos_posto.mao_obra','/dashboard/produtividade/custos-posto','Custos do posto','Mão de obra (R$/mês)','O custo mensal de pessoal alocado só a este posto, se você preferir informar aqui (opcional).','Entra no custo do posto quando o quadro de pessoal ainda não cobre este posto.','5.000,00','Dobrar o custo: se o Quadro de pessoal já calcula o pessoal, deixe em branco.','industria',30,'publicado'),
 ('prod.custos_posto.encargos','/dashboard/produtividade/custos-posto','Custos do posto','Encargos (%)','O percentual de encargos sobre a mão de obra informada acima.','Converte salário em custo cheio (INSS, FGTS, 13º, férias).','38,35','Esquecer os encargos — o custo de pessoal fica subestimado.','industria',40,'publicado'),
 ('prod.custos_posto.energia_modo','/dashboard/produtividade/custos-posto','Custos do posto','Como informar a energia','Escolha informar a energia em reais por mês OU em kWh consumidos × tarifa.','Deixa você usar o jeito que tiver em mãos (conta de luz em R$ ou medição em kWh).','Por kWh × tarifa','—','industria',50,'publicado'),
 ('prod.custos_posto.energia_mes','/dashboard/produtividade/custos-posto','Custos do posto','Energia (R$/mês)','O gasto mensal de energia elétrica deste posto, em reais.','Soma ao custo de utilidades do posto.','1.200,00','Informar a conta da planta inteira — aqui é só a parte deste posto.','industria',60,'publicado'),
 ('prod.custos_posto.energia_kwh','/dashboard/produtividade/custos-posto','Custos do posto','Energia (kWh/mês)','O consumo mensal do posto em kWh.','Multiplicado pela tarifa, vira o custo de energia do posto.','3.000','Confundir kWh com kW (potência) — aqui é o consumo no mês.','industria',70,'publicado'),
 ('prod.custos_posto.energia_tarifa','/dashboard/produtividade/custos-posto','Custos do posto','Tarifa (R$/kWh)','O preço do kWh na sua conta de energia.','Multiplica o consumo para dar o custo de energia.','0,65','Usar a tarifa com impostos diferente da que consta na conta.','industria',80,'publicado'),
 ('prod.custos_posto.agua','/dashboard/produtividade/custos-posto','Custos do posto','Água (R$/mês)','O gasto mensal de água/esgoto deste posto, em reais.','Soma ao custo de utilidades do posto.','300,00','—','industria',90,'publicado'),
 ('prod.custos_posto.vapor','/dashboard/produtividade/custos-posto','Custos do posto','Vapor (R$/mês)','O custo mensal de vapor (caldeira) atribuído a este posto.','Soma ao custo de utilidades de postos que usam vapor (cozimento, lavagem).','450,00','Lançar vapor em posto que não usa vapor.','industria',100,'publicado'),
 ('prod.custos_posto.frio','/dashboard/produtividade/custos-posto','Custos do posto','Frio / refrigeração (R$/mês)','O custo mensal de refrigeração (câmaras, túneis) deste posto.','Soma ao custo de utilidades de postos refrigerados.','900,00','—','industria',110,'publicado'),
 ('prod.custos_posto.ar','/dashboard/produtividade/custos-posto','Custos do posto','Ar comprimido (R$/mês)','O custo mensal de ar comprimido atribuído a este posto.','Soma ao custo de utilidades de postos que usam ar comprimido.','200,00','—','industria',120,'publicado'),
 ('prod.custos_posto.gas','/dashboard/produtividade/custos-posto','Custos do posto','Gás (R$/mês)','O custo mensal de gás (GLP/GN) deste posto.','Soma ao custo de utilidades de postos que usam gás (fornos, cozimento).','350,00','—','industria',130,'publicado'),
 ('prod.custos_posto.manutencao','/dashboard/produtividade/custos-posto','Custos do posto','Manutenção (R$/mês)','O gasto mensal médio de manutenção (peças e serviços) dos equipamentos deste posto.','Soma ao custo do posto e, na F6, ao custo por kg.','600,00','Lançar uma reforma grande de uma vez — distribua no mês ou use um valor médio.','industria',140,'publicado'),
 ('prod.custos_posto.depreciacao','/dashboard/produtividade/custos-posto','Custos do posto','Depreciação (R$/mês)','A parcela mensal de depreciação dos equipamentos deste posto (valor ÷ vida útil em meses).','Distribui o desgaste do equipamento no custo do produto.','800,00','Informar o valor de compra inteiro — aqui é só a parcela do mês.','industria',150,'publicado'),
 ('prod.custos_posto.outros','/dashboard/produtividade/custos-posto','Custos do posto','Outros (R$/mês)','Outros custos mensais do posto que não se encaixam acima.','Garante que nada fica de fora do custo do posto.','150,00','Repetir aqui um custo já informado em outro campo.','industria',160,'publicado'),
 ('prod.custos_posto.horas','/dashboard/produtividade/custos-posto','Custos do posto','Horas de operação (h/mês)','Quantas horas por mês o posto efetivamente opera.','Divide o custo mensal do posto para dar o custo por hora (base da F6, custo por kg).','352','Deixar em branco — sem as horas não dá para achar o custo por hora.','industria',170,'publicado'),
 ('prod.custos_posto.salvar','/dashboard/produtividade/custos-posto','Custos do posto','Salvar custos','Grava os custos deste posto valendo a partir da vigência escolhida (o valor anterior é mantido no histórico).','Um clique atualiza o custo do posto sem perder o que valia antes.','—','—','industria',180,'publicado'),
 ('prod.custos_posto.excluir','/dashboard/produtividade/custos-posto','Custos do posto','Excluir lançamento','Remove um lançamento de custo (exclusão rastreável). Ao excluir o vigente, o anterior volta a valer.','Corrige um lançamento errado sem apagar o histórico.','—','—','industria',190,'publicado'),
 ('prod.custos_posto.total','/dashboard/produtividade/custos-posto','Custos do posto','Custo total do posto','Soma de mão de obra, utilidades, manutenção, depreciação e outros no mês, e o custo por hora.','Mostra quanto o posto custa por mês e por hora — o insumo da F6 (custo por kg).','R$ 9.600,00 · R$ 27,27/h','—','industria',200,'publicado')
ON CONFLICT (chave) DO NOTHING;

-- ============================================================ RD-98 p3 · origem do dado (system_screens)
INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, views_consumidas, rpcs_chamadas, modulo, estado_real)
SELECT gen_random_uuid(), '/dashboard/produtividade/custos-posto', 'industria', 'Custos do posto',
       'Custos mensais de cada posto de trabalho (mão de obra, energia por R$ ou kWh×tarifa, água, vapor, frio, ar comprimido, gás, manutenção, depreciação, outros) e horas de operação, com histórico por vigência. Base do custo por hora e do custo por kg do produto final (fatia F6).',
       ARRAY['prod_posto_custo','prod_posto','industrial_plants'],
       ARRAY['fn_prod_posto_custo_listar','fn_prod_posto_custo_salvar','fn_prod_posto_custo_excluir'],
       'produtividade', 'parcial'
WHERE NOT EXISTS (SELECT 1 FROM public.system_screens WHERE rota = '/dashboard/produtividade/custos-posto');
