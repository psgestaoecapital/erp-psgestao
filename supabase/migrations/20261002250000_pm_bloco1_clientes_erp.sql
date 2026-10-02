-- P&M · Bloco 1 (Pdois em teste, CEO 02/10): clientes = erp_clientes (regra do blueprint) + textos do "?".
--
-- Achado (Pdois 36b69d77…, 02/10): Briefing, Pauta e Novo Job listavam agency_clientes (20 linhas, 12 ligadas ao cadastro,
-- com duplicatas: "DECO…" e "Mauricio Atacado" aparecem 2x), enquanto os clientes reais estão em erp_clientes (765).
-- Jobs, briefings, campanhas e contratos apontam para agency_clientes (FK) — o "perfil P&M" do cliente (fee, grupo,
-- prazo de aprovação). Nada disso muda: a tela passa a BUSCAR em erp_clientes e esta função devolve o perfil P&M do
-- cliente escolhido, criando-o (ligado) só quando ele ainda não existe. Sem tabela nova, sem apagar nada (RD-30).
--
--   fn_pm_cliente_garantir(company, erp_cliente) → agency_clientes.id
--     1) perfil já ligado a esse erp_cliente → ele (o mais antigo, se houver mais de um);
--     2) senão, perfil SEM ligação com o mesmo nome (e só um cliente do cadastro com esse nome) → liga e devolve;
--     3) senão, cria o perfil ligado (nome = nome fantasia ou razão social).
--   Guarda: só quem é da empresa (fn__guarda_empresa) e o erp_cliente tem de ser da mesma empresa.

CREATE OR REPLACE FUNCTION public.fn_pm_cliente_garantir(p_company_id uuid, p_erp_cliente_id uuid)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_nome text; v_id uuid; v_iguais int;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  SELECT COALESCE(NULLIF(btrim(nome_fantasia), ''), NULLIF(btrim(razao_social), ''))
    INTO v_nome FROM erp_clientes WHERE id = p_erp_cliente_id AND company_id = p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cliente não encontrado nesta empresa' USING ERRCODE = '42501'; END IF;
  v_nome := COALESCE(v_nome, 'Cliente sem nome');

  SELECT id INTO v_id FROM agency_clientes
   WHERE company_id = p_company_id AND erp_cliente_id = p_erp_cliente_id ORDER BY created_at NULLS LAST, id LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  SELECT count(*) INTO v_iguais FROM erp_clientes
   WHERE company_id = p_company_id AND lower(COALESCE(NULLIF(btrim(nome_fantasia), ''), btrim(razao_social))) = lower(v_nome);
  IF v_iguais = 1 THEN
    SELECT id INTO v_id FROM agency_clientes
     WHERE company_id = p_company_id AND erp_cliente_id IS NULL
       AND lower(COALESCE(NULLIF(btrim(nome_fantasia), ''), btrim(nome))) = lower(v_nome)
     ORDER BY created_at NULLS LAST, id LIMIT 1;
    IF v_id IS NOT NULL THEN
      UPDATE agency_clientes SET erp_cliente_id = p_erp_cliente_id WHERE id = v_id;
      RETURN v_id;
    END IF;
  END IF;

  INSERT INTO agency_clientes (company_id, nome, nome_fantasia, erp_cliente_id, status)
  VALUES (p_company_id, v_nome, v_nome, p_erp_cliente_id, 'ativo') RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.fn_pm_cliente_garantir(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pm_cliente_garantir(uuid, uuid) TO authenticated, service_role;

-- "?" dos campos do briefing, do job e da Pauta vazia
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'pm', 'publicado'
FROM (VALUES
 ('pm.cliente.busca', 'Cliente', 'Cliente', 'Digite parte do nome, da razão social ou do CNPJ e escolha da lista.', 'A lista vem do cadastro de clientes da empresa — o mesmo do financeiro e das notas.', '"lorenz" acha Lorenzini Madeiras.', 'Cadastrar o cliente de novo com outro nome: procure antes pelo CNPJ.', 50, '/dashboard/pm/briefings'),
 ('pm.briefing.titulo', 'Briefing', 'Título', 'Um nome curto para a demanda.', 'É o nome que aparece na lista e vira o título do job.', 'Campanha Dia das Crianças — Findler.', 'Título genérico como "Post" — ninguém acha depois.', 51, '/dashboard/pm/briefings'),
 ('pm.briefing.objetivo', 'Briefing', 'Objetivo', 'O resultado que o cliente quer com a peça ou campanha.', 'Guia todas as decisões de criação e é a primeira coisa que o job mostra.', 'Aumentar as visitas à loja nos 10 dias antes do Dia das Crianças.', 'Escrever o que vai ser feito ("3 posts") em vez do resultado esperado.', 52, '/dashboard/pm/briefings'),
 ('pm.briefing.texto', 'Briefing', 'Briefing', 'Contexto (o que está acontecendo), mensagem principal, entregáveis e formatos (ex.: carrossel 1080×1350, reels 30 s), prazos e o que evitar. Use negrito, listas e links.', 'É o que a equipe de criação lê para produzir — vai inteiro para o job.', 'Contexto: loja nova no centro. Mensagem: "agora mais perto de você". Entregáveis: 1 carrossel + 2 stories. Evitar: preço na arte.', 'Briefing de uma linha ou "conforme conversado": a criação volta com dúvida e o prazo estoura.', 53, '/dashboard/pm/briefings'),
 ('pm.briefing.publico', 'Briefing', 'Público-alvo', 'Quem precisa ver a peça.', 'Define linguagem, imagem e onde publicar.', 'Mães de 25 a 40 anos de Chapecó.', 'Responder "todo mundo".', 54, '/dashboard/pm/briefings'),
 ('pm.briefing.tipo', 'Briefing', 'Tipo de serviço', 'Social, design, vídeo, mídia…', 'Separa a demanda na pauta e no relatório.', 'Social.', 'Deixar em branco: a peça cai como "social" no job.', 55, '/dashboard/pm/briefings'),
 ('pm.briefing.referencias', 'Briefing', 'Referências', 'Links ou descrições de exemplos que o cliente gostou (ou não).', 'Alinha o estilo antes da primeira versão.', 'https://instagram.com/… — gostou das cores; não quer fundo preto.', 'Mandar referência por WhatsApp e não registrar aqui.', 56, '/dashboard/pm/briefings'),
 ('pm.briefing.prazo', 'Briefing', 'Prazo desejado', 'Quando o cliente precisa da peça pronta.', 'Vira o prazo do job ao transformar em job.', '10/10.', 'Pôr a data de publicação: o job precisa ficar pronto antes, para aprovar.', 57, '/dashboard/pm/briefings'),
 ('pm.job.briefing', 'Job', 'Briefing do job', 'O que precisa ser feito, com contexto, entregáveis, formatos, prazos e o que evitar. Use negrito, listas e links.', 'É o que a pessoa responsável lê antes de produzir.', 'Carrossel 3 cards 1080×1350; card 1 com a foto da fachada; CTA "Vem conhecer".', 'Deixar vazio e explicar por mensagem: some do histórico do job.', 58, '/dashboard/producao'),
 ('pm.job.responsavel', 'Job', 'Responsável', 'Escolha quem vai executar — a lista são os usuários ativos da empresa.', 'O job aparece na pauta e no "Meus" dessa pessoa.', 'Marciana.', 'Deixar sem responsável: o job não aparece para ninguém.', 59, '/dashboard/producao'),
 ('pm.pauta.vazia', 'Pauta', 'Pauta vazia', 'Crie o primeiro job ou peça a importação dos jobs do SIGA.', 'A pauta mostra todos os jobs da agência com prazo e situação.', 'Novo job → cliente → peça → título → prazo → responsável → briefing.', 'Achar que os jobs sumiram: os do SIGA ainda não foram trazidos.', 60, '/dashboard/pm/pauta')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;

-- Número do job (achado no ensaio, 02/10): agency_jobs.numero não tinha padrão nem gatilho — todo job criado pelo
-- Briefing ou pelo Novo Job nascia SEM número (o código na Pauta ficava vazio). Agora, se vier vazio, recebe o próximo
-- número da empresa (maior número numérico + 1; trava por empresa contra corrida). Os jobs importados do SIGA mantêm o
-- número deles e a sequência continua a partir do maior.
CREATE OR REPLACE FUNCTION public.trg_agency_job_numero() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
-- ci-sem-guarda: trg_agency_job_numero — gatilho de numeração do próprio job que está sendo gravado (a RLS de agency_jobs já decide quem grava)
BEGIN
  IF NEW.numero IS NULL OR btrim(NEW.numero) = '' THEN
    PERFORM pg_advisory_xact_lock(hashtext('agency_jobs_numero:' || NEW.company_id::text));
    SELECT (COALESCE(max(numero::bigint), 0) + 1)::text INTO NEW.numero
      FROM agency_jobs WHERE company_id = NEW.company_id AND numero ~ '^\d{1,15}$';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.trg_agency_job_numero() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_agency_job_numero ON public.agency_jobs;
CREATE TRIGGER trg_agency_job_numero BEFORE INSERT ON public.agency_jobs
  FOR EACH ROW EXECUTE FUNCTION public.trg_agency_job_numero();
