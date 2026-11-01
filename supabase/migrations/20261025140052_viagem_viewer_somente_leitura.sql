-- Viagem · perfil CONSULTA (viewer) só lê — auditor_pdca_g 24/10 (insight #3587) · desenvolvedor_4_g (faixa 52).
-- O viewer via o botão "Nova viagem" e a gravação passava (as fn_viagem_* só checam a empresa). Esconder o botão não
-- basta: a trava fica NO BANCO, num gatilho BEFORE INSERT/UPDATE/DELETE nas 4 tabelas da viagem, que vale para toda
-- função de gravação (atual ou futura) sem reescrever nenhuma delas.
-- ADITIVA: só função NOVA + gatilhos NOVOS + textos NOVOS de "?" (RD-95). Nenhuma função, view ou policy existente muda.
-- Conexão de serviço (auth.uid() nulo: fila do GE, sementes, rotinas) e admin não são barrados.

-- Quem pode gravar viagem nesta empresa: tem acesso à empresa e NÃO é só 'viewer' nela. A tela usa a mesma função.
CREATE OR REPLACE FUNCTION public.fn_viagem_pode_gravar(p_company_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NULL OR public.is_admin() OR EXISTS (
    SELECT 1 FROM public.user_companies uc
     WHERE uc.user_id = auth.uid() AND uc.company_id = p_company_id
       AND lower(COALESCE(uc.role, '')) NOT IN ('viewer', 'visualizador'))
$function$;

REVOKE ALL ON FUNCTION public.fn_viagem_pode_gravar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_viagem_pode_gravar(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn__viagem_trava_viewer()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.company_id ELSE NEW.company_id END;
BEGIN
  IF NOT public.fn_viagem_pode_gravar(v_company) THEN
    RAISE EXCEPTION 'Seu perfil é de consulta: você pode ver as viagens, mas não abrir, lançar ou fechar. Peça ao administrativo.'
      USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $function$;

REVOKE ALL ON FUNCTION public.fn__viagem_trava_viewer() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_viagem_trava_viewer ON public.erp_viagem;
CREATE TRIGGER trg_viagem_trava_viewer BEFORE INSERT OR UPDATE OR DELETE ON public.erp_viagem
  FOR EACH ROW EXECUTE FUNCTION public.fn__viagem_trava_viewer();
DROP TRIGGER IF EXISTS trg_viagem_trava_viewer ON public.erp_viagem_lancamento;
CREATE TRIGGER trg_viagem_trava_viewer BEFORE INSERT OR UPDATE OR DELETE ON public.erp_viagem_lancamento
  FOR EACH ROW EXECUTE FUNCTION public.fn__viagem_trava_viewer();
DROP TRIGGER IF EXISTS trg_viagem_trava_viewer ON public.erp_viagem_obra;
CREATE TRIGGER trg_viagem_trava_viewer BEFORE INSERT OR UPDATE OR DELETE ON public.erp_viagem_obra
  FOR EACH ROW EXECUTE FUNCTION public.fn__viagem_trava_viewer();
DROP TRIGGER IF EXISTS trg_viagem_trava_viewer ON public.erp_viagem_config;
CREATE TRIGGER trg_viagem_trava_viewer BEFORE INSERT OR UPDATE OR DELETE ON public.erp_viagem_config
  FOR EACH ROW EXECUTE FUNCTION public.fn__viagem_trava_viewer();

-- "?" (RD-95) do que faltava na tela: botões, contador, status e os cartões do acerto.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/viagens', 'hub_construcao', 'publicado'
FROM (VALUES
  ('projetos.viagem.nova', 'Ações', 'Nova viagem', 'Abre o formulário para registrar uma viagem que vai começar ou acabou de voltar.', 'Cada viagem junta o adiantamento e os cupons de um colaborador num acerto só.', 'Viagem do João para a obra 0153', 'Abrir uma viagem nova para cada cupom: lance os cupons dentro da mesma viagem.', 30),
  ('projetos.viagem.contador_abertas', 'Lista', 'Viagens abertas', 'Calculado: quantas viagens ainda não foram fechadas.', 'Mostra quantos acertos estão pendentes de conferência e fechamento.', '2 aberta(s)', 'Esquecer viagem aberta: o custo não chega ao financeiro da obra.', 31),
  ('projetos.viagem.status', 'Lista', 'Situação da viagem', 'Calculado: aberta (aceita cupons) ou fechada (acerto concluído, não muda mais).', 'Só a viagem fechada manda o acerto para o financeiro (GE).', 'aberta', 'Fechar antes de lançar todos os cupons: depois não dá para incluir.', 32),
  ('projetos.viagem.card_viagem', 'Lista', 'Viagem', 'Toque na viagem para ver os cupons e o acerto.', 'Mostra número, colaborador, período e a obra principal.', 'Viagem 3 · João · 05/10 a 09/10', 'Procurar pela data de hoje: a lista é pela data de saída.', 33),
  ('projetos.viagem.resumo_total', 'Acerto', 'Total da viagem', 'Calculado: a soma de todos os cupons lançados.', 'É o custo da viagem que vai para as obras.', 'R$ 2.340,00', 'Cupom lançado duas vezes: o total dobra.', 34),
  ('projetos.viagem.resumo_adiantamento', 'Acerto', 'Adiantamento', 'Calculado: o valor entregue ao colaborador antes de viajar (5.01).', 'É abatido dos gastos pagos por ele para dar o saldo.', 'R$ 1.500,00', 'Adiantamento não informado na abertura: o saldo sai como reembolso a mais.', 35),
  ('projetos.viagem.resumo_pago_colaborador', 'Acerto', 'Pago pelo colaborador', 'Calculado: a soma dos cupons marcados como pagos pelo colaborador.', 'É o que ele gastou do adiantamento ou do próprio bolso.', 'R$ 1.720,00', 'Cupom de cartão da empresa marcado como pago pelo colaborador.', 36),
  ('projetos.viagem.resumo_saldo', 'Acerto', 'Saldo do acerto', 'Calculado: adiantamento menos o que o colaborador pagou.', 'Positivo: o colaborador devolve. Negativo: a empresa reembolsa (5.02).', 'R$ 220,00 a reembolsar', 'Ler o saldo sem ver a frase abaixo: ela diz quem paga quem.', 37),
  ('projetos.viagem.novo_lancamento', 'Ações', 'Novo lançamento', 'Abre o formulário para lançar um cupom (despesa ou abastecimento).', 'Cada cupom entra no total da viagem e na obra escolhida.', 'Almoço de R$ 45,00', 'Juntar vários cupons num lançamento só: perde a conferência.', 38),
  ('projetos.viagem.fechar', 'Ações', 'Fechar viagem', 'Conclui o acerto depois de lançar todos os cupons.', 'A viagem fica travada e o acerto segue para o financeiro (GE) por obra.', 'Fechar a viagem 3', 'Fechar com cupom faltando: depois de fechada não se altera.', 39),
  ('projetos.viagem.excluir_lancamento', 'Ações', 'Excluir lançamento', 'Remove um cupom lançado por engano (só em viagem aberta).', 'Tira o valor do total e do acerto; o registro fica guardado no histórico.', 'Cupom repetido', 'Excluir para corrigir o valor: exclua e lance de novo com o valor certo.', 40)
) v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
