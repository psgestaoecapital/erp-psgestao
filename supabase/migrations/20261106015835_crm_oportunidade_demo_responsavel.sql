-- #3423 · /dashboard/projetos/oportunidades (Code: code-desenvolvedor-3)
-- Semente de DEMO (empresa Construtora Modelo, b0700000-…-006): atribui um RESPONSÁVEL real às oportunidades
-- do funil que ainda não tinham nenhum, para a tela exercitar o caminho "nome real do responsável" (o card já
-- resolve nomeResp(responsavel_id) → nome do usuário; sem id ele mostra, honestamente, "Sem responsável").
-- O auditor HBF-0.1 do #3423 pediu "nome real no campo responsável"; o DEFEITO DE CÓDIGO (contadores divergentes,
-- badge cortado, coluna sem estado vazio, "?" RD-95) já foi corrigido e está na main — aqui falta só o dado do DEMO.
--
-- Seguro e re-executável:
--   • escopo travado na empresa DEMO e só onde responsavel_id IS NULL (idempotente: re-rodar não remexe quem já tem);
--   • atribui em rodízio determinístico entre VENDEDORES REAIS da própria empresa (nunca robôs/Administrador);
--   • nunca apaga nem troca um responsável já definido; não toca nenhuma outra empresa.
UPDATE public.erp_crm_oportunidade o
   SET responsavel_id = s.uid
  FROM (
    SELECT id, (row_number() OVER (ORDER BY created_at) - 1) % 4 AS slot
      FROM public.erp_crm_oportunidade
     WHERE company_id = 'b0700000-0000-4000-a000-000000000006'
       AND deleted_at IS NULL
       AND responsavel_id IS NULL
  ) a
  JOIN (VALUES
    (0, 'f3867e65-94d6-43c0-aeb9-8da82fcfe433'::uuid),  -- André Luiz Salvi
    (1, '43ef8386-3262-4e56-b31a-6f0e41d1e21c'::uuid),  -- Jordana Carolina Richter
    (2, '666fca82-fefb-4a7c-bf35-89463a587e6b'::uuid),  -- Leonardo Caneppele Sott
    (3, '33464170-036f-4d3b-bc48-f2dc3dfde660'::uuid)   -- Rodrigo Jantsch
  ) s(slot, uid) ON s.slot = a.slot
 WHERE o.id = a.id;
