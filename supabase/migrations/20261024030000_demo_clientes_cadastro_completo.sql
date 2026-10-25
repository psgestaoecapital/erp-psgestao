-- Hub · tela Clientes de obra (/dashboard/projetos/clientes) — caixa 5263327d (Eng. Chefe 23/10, auditor PDCA 24/10 01:03):
-- "funcional 50 · 4 clientes DEMO sem CNPJ/telefone/e-mail (100% cadastro incompleto) — vem do seed".
-- Os 4 clientes DEMO-C01..C04 da Construtora DEMO nascem em fn_gold_hub_seed_reparar (chamada pelo fn_demo_seed_construtora,
-- que o fn_demo_reset roda) só com nome, cidade e UF. A tela conta "Cadastro incompleto" quando falta documento ou contato.
--
-- 1) fn_gold_hub_seed_reparar: patch por âncora (corpo vigente preservado — RD-69; aborta se a âncora sumir; idempotente):
--    logo depois do laço que cria os clientes, completa o cadastro de cada um — CNPJ válido (fn_demo_cnpj_valido,
--    dígitos conferidos), telefone, celular, e-mail, CEP/endereço e origem 'indicacao' (a mesma das oportunidades).
--    Dados fictícios: e-mails em domínio exemplo.com.br, telefones de ramal fixo da demo.
-- 2) Aplica o mesmo cadastro agora nos 4 clientes que já existem (só a 006 e só se is_demo; só códigos DEMO-C0x),
--    sem rodar a semente inteira.
-- RD-55: nenhuma empresa real é tocada (a função recusa outra empresa; o UPDATE filtra a 006 + is_demo + DEMO-C).
-- Plano de volta: CREATE OR REPLACE do fn_gold_hub_seed_reparar pelo arquivo 20261009083310 (corpo anterior).

DO $do$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef('public.fn_gold_hub_seed_reparar(uuid)'::regprocedure) INTO v_def;
  IF v_def ~ 'cadastro completo dos clientes da demo' THEN RETURN; END IF;
  v_new := replace(v_def,
    $a$    v_cli := v_cli || v_id;
  END LOOP;
$a$,
    $b$    v_cli := v_cli || v_id;
  END LOOP;
  -- cadastro completo dos clientes da demo (tela Clientes de obra: documento + contato + endereço)
  UPDATE erp_clientes k SET
    cpf_cnpj = d.doc, cnpj_cpf = d.doc, telefone = d.tel, celular = d.cel, email = d.mail,
    cep = d.cep, logradouro = d.logr, numero = d.num, bairro = d.bai, origem = 'indicacao'
  FROM (
    SELECT v.cod,
           regexp_replace(fn_demo_cnpj_valido(v.base), '^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$', '\1.\2.\3/\4-\5') AS doc,
           v.tel, v.cel, v.mail, v.cep, v.logr, v.num, v.bai
    FROM (VALUES
      ('DEMO-C01', 487651230001::bigint, '(49) 3322-4101', '(49) 99901-4101', 'contato@vistaverde.exemplo.com.br',  '89801-000', 'Rua Marechal Deodoro', '1250', 'Centro'),
      ('DEMO-C02', 213450870001::bigint, '(49) 3433-4102', '(49) 99902-4102', 'administracao@bemviver.exemplo.com.br', '89820-000', 'Avenida Brasil', '480', 'Centro'),
      ('DEMO-C03', 335120440001::bigint, '(49) 3442-4103', '(49) 99903-4103', 'compras@mercadocentral.exemplo.com.br', '89700-000', 'Rua Marechal Floriano', '77', 'Centro'),
      ('DEMO-C04', 179830560001::bigint, '(49) 3322-4104', '(49) 99904-4104', 'escritorio@horizonte.exemplo.com.br',  '89802-000', 'Avenida Getúlio Vargas', '2010', 'Jardim Itália')
    ) AS v(cod, base, tel, cel, mail, cep, logr, num, bai)
  ) d
  WHERE k.company_id = c AND k.codigo = d.cod;
$b$);
  IF v_new = v_def THEN RAISE EXCEPTION 'fn_gold_hub_seed_reparar: ancora do laco de clientes nao encontrada'; END IF;
  EXECUTE v_new;
END $do$;

-- os 4 clientes que já existem na Construtora DEMO recebem o mesmo cadastro agora
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.companies WHERE id = 'b0700000-0000-4000-a000-000000000006' AND is_demo IS TRUE) THEN
    UPDATE public.erp_clientes k SET
      cpf_cnpj = d.doc, cnpj_cpf = d.doc, telefone = d.tel, celular = d.cel, email = d.mail,
      cep = d.cep, logradouro = d.logr, numero = d.num, bairro = d.bai, origem = 'indicacao'
    FROM (
      SELECT v.cod,
             regexp_replace(public.fn_demo_cnpj_valido(v.base), '^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$', '\1.\2.\3/\4-\5') AS doc,
             v.tel, v.cel, v.mail, v.cep, v.logr, v.num, v.bai
      FROM (VALUES
        ('DEMO-C01', 487651230001::bigint, '(49) 3322-4101', '(49) 99901-4101', 'contato@vistaverde.exemplo.com.br',  '89801-000', 'Rua Marechal Deodoro', '1250', 'Centro'),
        ('DEMO-C02', 213450870001::bigint, '(49) 3433-4102', '(49) 99902-4102', 'administracao@bemviver.exemplo.com.br', '89820-000', 'Avenida Brasil', '480', 'Centro'),
        ('DEMO-C03', 335120440001::bigint, '(49) 3442-4103', '(49) 99903-4103', 'compras@mercadocentral.exemplo.com.br', '89700-000', 'Rua Marechal Floriano', '77', 'Centro'),
        ('DEMO-C04', 179830560001::bigint, '(49) 3322-4104', '(49) 99904-4104', 'escritorio@horizonte.exemplo.com.br',  '89802-000', 'Avenida Getúlio Vargas', '2010', 'Jardim Itália')
      ) AS v(cod, base, tel, cel, mail, cep, logr, num, bai)
    ) d
    WHERE k.company_id = 'b0700000-0000-4000-a000-000000000006' AND k.codigo = d.cod;
  END IF;
END $$;
