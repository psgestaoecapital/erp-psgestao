// Gate · P&M Social mínimo (CEO 03/10, spec aprovada com as correções do Eng. Chefe). Sem rede. Mantém:
// a) cliente do planejamento/post = erp_clientes (cadastro único), não agency_clientes; o job usa o perfil P&M via
//    fn_pm_cliente_garantir;
// b) mais de um planejamento por cliente+mês, único por empresa+cliente+mês+campanha (campanha vazia = '') entre os
//    que não estão na lixeira;
// c) redes = lista configurável da empresa (agency_config_opcao, lista rede_social, padrões semeados), conferidas pelo
//    gatilho — nunca uma lista fixa num CHECK;
// d) post aprovado (peça + publicação) vira job: prazo = publicação − antecedência (padrão 2); publicação mudou → prazo
//    acompanha; prazo depois da publicação recusado;
// e) segurança: RLS por empresa, nada para anônimo, sem DELETE; SECURITY DEFINER com search_path e REVOKE por função;
// f) menu Planejamento/Calendário, "?" em todo campo, demonstração encadeada no reset (RD-69), teste @pos-migration.
import { readFileSync, existsSync } from 'node:fs'
import {
  deInputLocal, diaSP, diasDaSemana, gradeDoMes, inicioDaSemana, intervaloISO, paraInputLocal, prazoDoPost, redesInvalidas, siglaRede, somarMeses,
} from '../../src/lib/pm/social'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }
const ler = (p: string) => readFileSync(p, 'utf8')

// ── regras puras (as mesmas do banco) ──
ok(prazoDoPost('2026-10-20T21:00:00.000Z', 2) === '2026-10-18', 'd) prazo = publicação (dia em São Paulo) − antecedência')
ok(prazoDoPost('2026-10-21T02:30:00.000Z', 2) === '2026-10-18', 'd) publicação 23:30 de São Paulo conta no dia de São Paulo (não no UTC)')
ok(prazoDoPost('2026-10-20T21:00:00.000Z', null) === '2026-10-18' && prazoDoPost('2026-10-20T21:00:00.000Z', 0) === '2026-10-20', 'd) antecedência vazia = 2; zero = dia da publicação')
ok(prazoDoPost(null, 2) === null, 'd) sem publicação não há prazo')
ok(deInputLocal('2026-10-20T18:00') === '2026-10-20T21:00:00.000Z' && paraInputLocal('2026-10-20T21:00:00.000Z') === '2026-10-20T18:00', 'campo de data/hora lê e grava na hora de São Paulo')
ok(diaSP('2026-11-01T02:59:00Z') === '2026-10-31', 'dia do calendário no fuso de São Paulo')
ok(inicioDaSemana('2026-10-15') === '2026-10-11' && diasDaSemana('2026-10-15').length === 7, 'semana de domingo a sábado')
const grade = gradeDoMes('2026-10-15')
ok(grade[0][0] === '2026-09-27' && grade[grade.length - 1][6] >= '2026-10-31' && grade.every((s) => s.length === 7), 'mês em semanas completas')
ok(somarMeses('2026-12-10', 1) === '2027-01-01', 'navegar de dezembro para janeiro')
const iv = intervaloISO('2026-10-11', '2026-10-17')
ok(iv.de === '2026-10-11T03:00:00.000Z' && iv.ate === '2026-10-18T03:00:00.000Z', 'consulta do calendário pelos limites do dia em São Paulo')
ok(redesInvalidas(['instagram', 'orkut'], ['instagram', 'facebook']).join() === 'orkut', 'c) tela avisa rede fora da lista da empresa')
ok(siglaRede('instagram') === 'IG' && siglaRede('pinterest') === 'PI', 'sigla da rede (inclusive rede criada pela empresa)')

// ── migration ──
const MIG = 'supabase/migrations/20261003120000_pm_social_planejamento.sql'
ok(existsSync(MIG), 'migration 20261003120000 existe')
const mig = ler(MIG)
const sql = mig.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
ok(/CREATE TABLE IF NOT EXISTS public\.agency_planejamentos[\s\S]{0,400}cliente_id\s+uuid NOT NULL REFERENCES public\.erp_clientes\(id\)/.test(sql), 'a) planejamento.cliente_id → erp_clientes')
ok(/CREATE TABLE IF NOT EXISTS public\.agency_posts[\s\S]{0,500}cliente_id\s+uuid NOT NULL REFERENCES public\.erp_clientes\(id\)/.test(sql), 'a) post.cliente_id → erp_clientes')
ok(!/agency_planejamentos[\s\S]{0,600}REFERENCES public\.agency_clientes/.test(sql.split('CREATE TABLE IF NOT EXISTS public.agency_posts')[0]), 'a) planejamento NÃO aponta para agency_clientes')
ok(/v_cli := public\.fn_pm_cliente_garantir\(NEW\.company_id, NEW\.cliente_id\)/.test(sql), 'a) job usa o perfil P&M do cliente (fn_pm_cliente_garantir)')
ok(/campanha\s+text,/.test(sql) && /CREATE UNIQUE INDEX IF NOT EXISTS agency_planejamentos_uk\s+ON public\.agency_planejamentos \(company_id, cliente_id, mes, lower\(COALESCE\(campanha, ''\)\)\)\s+WHERE excluido_em IS NULL/.test(sql), 'b) único por empresa+cliente+mês+campanha (vazia = \'\'), fora da lixeira')
ok(/USING ERRCODE = '23505'/.test(sql) && /Já existe um planejamento deste cliente/.test(sql), 'b) duplicata com mensagem clara')
ok(/publicar_em\s+timestamptz/.test(sql) && /redes\s+text\[\] NOT NULL DEFAULT '\{\}'/.test(sql) && /servico_id\s+uuid REFERENCES public\.agency_servico/.test(sql) && /job_id\s+uuid REFERENCES public\.agency_jobs/.test(sql), 'post: publicar_em, redes[], peça, job')
for (const c of ['arte', 'texto_arte', 'legenda', 'hashtags', 'responsavel_id', 'ordem', 'excluido_em']) ok(new RegExp(`\\n\\s+${c}\\s`).test(sql.split('CREATE TABLE IF NOT EXISTS public.agency_posts')[1] ?? ''), `post tem ${c}`)
ok(!/CHECK\s*\([^)]*redes/i.test(sql) && !/CHECK\s*\([^)]*instagram/i.test(sql), 'c) nenhuma rede fixa em CHECK')
for (const r of ['instagram', 'facebook', 'linkedin', 'tiktok', 'youtube', 'google']) ok(new RegExp(`\\('rede_social','${r}'`).test(sql), `c) padrão ${r} na lista configurável`)
ok(/o\.lista = 'rede_social' AND o\.valor = r AND o\.ativo/.test(sql) && /Rede social que não está na lista da empresa/.test(sql), 'c) gatilho confere as redes na lista ATIVA da empresa')
ok(/IF v_row\.lista = 'rede_social' THEN[\s\S]{0,200}= ANY \(redes\)/.test(sql), 'c) rede em uso não é removida')
ok(/ADD COLUMN IF NOT EXISTS antecedencia_dias integer NOT NULL DEFAULT 2/.test(sql), 'd) agency_servico.antecedencia_dias padrão 2')
ok(/v_prazo := \(NEW\.publicar_em AT TIME ZONE 'America\/Sao_Paulo'\)::date - COALESCE\(s\.antecedencia_dias, 2\)/.test(sql), 'd) prazo do job = publicação − antecedência')
ok(/NEW\.status IN \('aprovado', 'publicado'\) AND \(NEW\.servico_id IS NULL OR NEW\.publicar_em IS NULL\)/.test(sql), 'd) aprovar exige peça e publicação')
ok(/TG_OP = 'INSERT' OR v_old_status NOT IN \('aprovado', 'publicado'\)/.test(sql) && /NEW\.job_id := OLD\.job_id/.test(sql), 'd) job criado uma vez só, na passagem para aprovado; job_id não é forjável')
ok(/RETURNING id INTO NEW\.job_id/.test(sql) && /'social', 'nao_iniciada'/.test(sql), 'd) job nasce na pauta (número pelo gatilho do Bloco 1)')
ok(!/numero/.test(sql.match(/INSERT INTO agency_jobs \(([^)]*)\)/)?.[1] ?? 'numero'), 'd) número do job fica com trg_agency_job_numero')
ok(/CREATE TRIGGER trg_agency_post_sincronizar_job AFTER UPDATE ON public\.agency_posts/.test(sql) && /UPDATE agency_jobs SET data_prazo = v_prazo/.test(sql), 'd) publicação mudou → prazo do job acompanha')
ok(/CREATE TRIGGER trg_agency_job_prazo_post BEFORE UPDATE OF data_prazo ON public\.agency_jobs/.test(sql) && /NEW\.data_prazo > v_pub/.test(sql), 'd) prazo do job depois da publicação recusado')
ok(/\*\*Arte:\*\*/.test(sql) && /\*\*Texto da arte:\*\*/.test(sql) && /\*\*Legenda:\*\*/.test(sql) && /\*\*Hashtags:\*\*/.test(sql), 'd) briefing montado no job')

// segurança
for (const t of ['agency_planejamentos', 'agency_posts']) {
  ok(new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`).test(sql), `e) RLS em ${t}`)
  ok(new RegExp(`CREATE POLICY ${t}_empresa ON public\\.${t} FOR ALL TO authenticated\\s+USING \\(company_id IN \\(SELECT public\\.get_user_company_ids\\(\\)\\) OR public\\.is_admin\\(\\)\\)`).test(sql), `e) ${t}: política por empresa`)
}
ok(/REVOKE ALL ON public\.agency_planejamentos, public\.agency_posts FROM PUBLIC, anon, authenticated;/.test(sql) && /GRANT SELECT, INSERT, UPDATE ON public\.agency_planejamentos, public\.agency_posts TO authenticated;/.test(sql), 'e) nada para anônimo; usuário sem DELETE (lixeira)')
const definers = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_]+)\(([^)]*)\)[\s\S]*?\$(?:\$|function\$)/g)].filter((m) => /SECURITY DEFINER/.test(m[0]))
ok(definers.length >= 6, `e) ${definers.length} funções SECURITY DEFINER encontradas`)
for (const m of definers) {
  ok(/SET search_path TO 'public'/.test(m[0]), `e) ${m[1]}: search_path fixo`)
  ok(new RegExp(`REVOKE ALL ON FUNCTION public\\.${m[1]}\\([^)]*\\) FROM PUBLIC, anon`).test(sql), `e) ${m[1]}: REVOKE próprio de PUBLIC e anon`)
}

// menu, ajuda, demonstração
ok(/'pm_planejamento', 'Planejamento', 'pm', 'pm_producao'/.test(sql) && /'pm_calendario', 'Calendário', 'pm', 'pm_producao'/.test(sql), 'f) menu: Planejamento e Calendário no P&M')
ok(/INSERT INTO public\.plan_modules/.test(sql) && /INSERT INTO public\.system_screens/.test(sql) && /screen_route_features/.test(sql), 'f) planos e catálogo de telas (com feature ligada)')
ok(/CREATE OR REPLACE FUNCTION public\.fn_demo_seed_pm_social/.test(sql) && /'Café Serra Azul'/.test(sql) && /'Clínica Sorriso Vale'/.test(sql) && /is_demo IS TRUE/.test(sql), 'f) demonstração: 2 clientes, só na demo')
ok(/fn_demo_seed_pm_social\(p_company_id\)/.test(sql) && /ancora 28\/09 nao encontrada/.test(sql), 'f) demonstração encadeada no fn_demo_reset (RD-69)')

// telas
const PL = 'src/app/dashboard/pm/planejamento/page.tsx', CA = 'src/app/dashboard/pm/calendario/page.tsx', PF = 'src/components/pm/social/PostForm.tsx'
for (const f of [PL, CA, PF, 'src/components/pm/social/ClienteErpBusca.tsx']) ok(existsSync(f), `tela ${f}`)
const pl = ler(PL), ca = ler(CA), pf = ler(PF), cb = ler('src/components/pm/social/ClienteErpBusca.tsx')
ok(/buscarClientesErp/.test(cb) && !/fn_pm_cliente_garantir/.test(cb) && /<ClienteErpBusca[\s\S]{0,120}ajuda="pm\.planejamento\.cliente"/.test(pl), 'a) tela escolhe o cliente no cadastro (erp_clientes), sem criar perfil')
ok(/from\("agency_planejamentos"\)/.test(pl) && /from\("agency_posts"\)/.test(pl) && /fn_agency_config_listar", \{ p_company_id: empresa, p_lista: "rede_social" \}/.test(pl), 'tela usa as tabelas novas e a lista de redes da empresa')
for (const k of ['pm.planejamento.mes', 'pm.planejamento.campanha', 'pm.planejamento.titulo', 'pm.planejamento.status', 'pm.planejamento.responsavel', 'pm.planejamento.observacoes', 'pm.planejamento.filtro_mes', 'pm.planejamento.filtro_status'])
  ok(pl.includes(`"${k}"`), `"?" ${k}`)
for (const k of ['pm.post.assunto', 'pm.post.publicar_em', 'pm.post.redes', 'pm.post.peca', 'pm.post.responsavel', 'pm.post.status', 'pm.post.arte', 'pm.post.texto_arte', 'pm.post.legenda', 'pm.post.hashtags'])
  ok(pf.includes(`"${k}"`), `"?" ${k}`)
for (const k of ['pm.calendario.visao', 'pm.calendario.data', 'pm.calendario.cliente', 'pm.calendario.status']) ok(ca.includes(`"${k}"`), `"?" ${k}`)
ok(/prazoDoPost\(f\.publicar_em, peca\?\.antecedencia_dias\)/.test(pf), 'd) formulário mostra o prazo do job antes de gravar')
ok(/calendario-semana-lista/.test(ca) && /calendario-mes-celular/.test(ca) && /md:grid/.test(ca), 'calendário: semana e mês, com versão de celular')
ok(/excluido_em: new Date\(\)\.toISOString\(\)/.test(pl) && !/\.delete\(\)/.test(pl), 'tela manda para a lixeira (nunca apaga)')
ok(/'rede_social', label: 'Redes sociais'/.test(ler('src/app/dashboard/pm/configuracoes/page.tsx')), 'c) redes gerenciáveis em P&M › Configurações › Listas')
ok(/chave="pm\.servico\.antecedencia"/.test(ler('src/app/dashboard/pm/servicos/page.tsx')), 'd) antecedência editável no catálogo, com "?"')

// teste de aceitação
const SPEC = 'e2e/jornadas/aceitacao/pm-social.spec.ts'
ok(existsSync(SPEC), 'teste de aceitação existe')
const sp = existsSync(SPEC) ? ler(SPEC) : ''
ok((sp.match(/tag: '@pos-migration'/g) ?? []).length >= 2, 'teste marcado @pos-migration')
ok(/b0700000-0000-4000-a000-000000000002/.test(sp) && /is_demo/.test(sp) && /excluido_em/.test(sp), 'teste na demo da P&M, com limpeza pela lixeira')

if (falhas) { console.error(`\ncheck-pm-social: ${falhas} falha(s)`); process.exit(1) }
console.log('\nP&M Social mínimo: ok')
