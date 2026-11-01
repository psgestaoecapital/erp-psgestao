-- #116 Frioeste · CEO 15/10 (OK registrado pelo Eng. Chefe, caixa ac87aead): os 27 desligamentos da lista da técnica de
-- segurança (chamado de 02/10, datas informadas em 30/09) vão para o ARQUIVO MORTO: ativo=false + data_demissao.
-- NADA é apagado (treinamentos, EPIs, pausas, ASO ficam ligados ao mesmo id). Lauri, Felipe e Victor NÃO entram.
-- O trigger trg_audit_compliance_funcionarios grava o antes/depois no audit log; o motivo fica também em observacoes.
-- Trava: se não forem exatamente 27 ativos casando por id, aborta tudo (idempotente: reexecução não acha ativos → 0 → ok).
DO $$
DECLARE
  v_company constant uuid := '975365cc-9e5a-4251-9022-68c6bfde10d8';
  v_ativos int;
  v_ja int;
  v_n int;
  v_motivo constant text := 'Desligamento informado pela técnica de segurança em 02/10, aplicado com autorização do CEO em 15/10 (chamado #116). Registro mantido no arquivo morto; histórico preservado.';
BEGIN
  CREATE TEMP TABLE _lista116(id uuid, dt date) ON COMMIT DROP;
  INSERT INTO _lista116(id, dt) VALUES
   ('8eb4f226-3448-4cd6-b90c-385f03ff464d','2026-07-16'),('2e509126-3717-4560-bf43-8bbd5c1c4745','2026-07-08'),
   ('162d807c-e4ac-4c9b-8058-17bc965e23be','2026-06-08'),('f377785d-d911-429b-9172-777cd2dc2b8a','2026-07-21'),
   ('ff0b08aa-36ed-448b-bba2-c806a2cd55e5','2026-07-23'),('c06f796d-1aaf-4a9d-b43c-d8858a96fede','2026-07-27'),
   ('6e676a77-65a1-4479-99c7-5f3764591860','2026-07-22'),('d70c1940-1048-4e59-94dc-5ee978a00f94','2026-07-13'),
   ('903af52a-2be3-486e-a203-ac4c1742f0b2','2026-07-24'),('7fe37dd9-fc69-4673-9fef-9b1b63078cd7','2026-07-30'),
   ('2b454c84-c2c6-45f9-a949-f88094a7b25c','2026-07-07'),('814f93d7-d4df-43da-9bf7-7a0e5ce8d7e8','2026-08-07'),
   ('51977f6b-0178-4e9d-b513-0aa53849d45c','2026-07-20'),('39cdea1a-62c5-419b-8f46-4090b6a775ca','2026-07-13'),
   ('10d6e94b-7516-4923-96a9-bb233fa650f5','2026-07-15'),('df77f318-0b02-49cb-991d-749023e8a03a','2026-07-24'),
   ('0cc49d9a-bafd-43f7-9b73-77b722a5428d','2026-07-07'),('8b9924ac-158f-4c95-8872-c126570f3334','2026-07-20'),
   ('8360e1d6-a5fe-40e9-b932-29f62dc9d4f1','2026-07-20'),('53ada94c-dd39-46a0-b198-2cb6cafc7245','2026-07-24'),
   ('22935df5-0d6c-46d8-853c-d759bbebea14','2026-07-28'),('8bc912e1-0fab-431f-a9e7-fbb537131c67','2026-07-09'),
   ('8504ef34-161d-4513-82c8-a5ef6d8e3f82','2026-07-13'),('ee204ed7-dff9-4d9d-b13d-97f92751edaa','2026-07-22'),
   ('23976bae-911b-46a9-a339-d183c00a40db','2026-07-30'),('84a44a9b-2f0a-454f-9c19-341f0947ff34','2026-07-15'),
   ('72a35b47-7ffa-443d-8e4a-12e3bbb982f6','2026-07-17');

  SELECT count(*) FILTER (WHERE f.ativo), count(*) FILTER (WHERE NOT f.ativo AND f.data_demissao = l.dt)
    INTO v_ativos, v_ja
    FROM _lista116 l JOIN public.compliance_funcionarios f ON f.id = l.id AND f.company_id = v_company;

  IF v_ativos + v_ja <> 27 THEN
    RAISE EXCEPTION '#116: esperava 27 cadastros da Frioeste na lista, achei % ativos + % já inativos — abortado', v_ativos, v_ja;
  END IF;

  UPDATE public.compliance_funcionarios f
     SET ativo = false,
         data_demissao = l.dt,
         observacoes = concat_ws(E'\n', nullif(f.observacoes, ''), v_motivo)
    FROM _lista116 l
   WHERE f.id = l.id AND f.company_id = v_company AND f.ativo;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> v_ativos THEN RAISE EXCEPTION '#116: atualizou % de % — abortado', v_n, v_ativos; END IF;
END $$;

-- "?" (RD-95) do filtro novo "Mostrar desligados" (arquivo morto)
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
('compliance.funcionarios.mostrar_desligados', 'Funcionários', 'Mostrar desligados',
 'Marque para ver também quem já saiu da empresa. Desmarcado, a lista mostra só quem está ativo.',
 'Quem sai fica no arquivo morto: nada é apagado, e treinamentos, EPIs, pausas e ASO continuam guardados. Os painéis e as listas oficiais contam só os ativos.',
 'Marcar para consultar a ficha de EPI de quem foi desligado em julho.', 'Achar que o desligado foi excluído: ele só deixa de aparecer na lista oficial.', 10, '/dashboard/compliance/funcionarios', 'compliance', 'publicado')
ON CONFLICT (chave) DO NOTHING;
