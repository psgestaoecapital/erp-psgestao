// Gate (CEO 01/10 · SPEC P&M · Pauta · fase P1 — banco): as tabelas novas nascem com company_id, RLS e nada aberto a
// quem não está logado; anotação é privada do autor; visão compartilhada só gestor; as listas de situação/motivo vêm da
// configuração (com "Aguardando"); o contador das abas roda com a RLS de quem chama; nada se apaga (RD-30). Sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const bruto = readFileSync('supabase/migrations/20261001200000_pauta_p1_banco.sql', 'utf8')
const mig = bruto.replace(/--[^\n]*/g, '')
const corpoDe = (fn: string): string => {
  const i = mig.search(new RegExp(String.raw`CREATE OR REPLACE FUNCTION public\.` + fn + String.raw`\(`))
  if (i < 0) return ''
  const fim = mig.indexOf('$function$;', i)
  return mig.slice(i, fim < 0 ? undefined : fim)
}
const tabelaDe = (t: string): string => {
  const i = mig.indexOf(`CREATE TABLE IF NOT EXISTS public.${t} (`)
  return i < 0 ? '' : mig.slice(i, mig.indexOf(');', i))
}

const novas = ['agency_grupos_clientes', 'agency_campanhas', 'agency_job_rodadas', 'agency_aprovacoes', 'agency_job_comentarios', 'agency_anotacoes', 'agency_visoes_pauta']
for (const t of novas) {
  ok(/company_id\s+uuid NOT NULL REFERENCES public\.companies\(id\)/.test(tabelaDe(t)), `${t}: company_id obrigatório`)
  ok(mig.includes(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`), `${t}: RLS ligada`)
  ok(new RegExp(String.raw`REVOKE ALL ON [^;]*public\.` + t + String.raw`\b[^;]*FROM PUBLIC, anon;`).test(mig), `${t}: fechada a quem não está logado`)
}
ok(!/\bDELETE\b/i.test(mig.replace(/ON DELETE (CASCADE|SET NULL)/g, '')), 'nenhum DELETE e nenhum GRANT de DELETE (exclusão lógica · RD-30)')
ok(!/\bTO anon\b/.test(mig), 'nada concedido a anon')

// campos do job (rodada, aguardando com motivo, nota, lixeira, campanha) e limite de ajustes no contrato
for (const c of ['rodada_ajuste', 'aguardando_motivo', 'aguardando_de', 'aguardando_desde', 'nota', 'excluido_em', 'excluido_por']) {
  ok(new RegExp(String.raw`ADD COLUMN IF NOT EXISTS ` + c + String.raw`\b`).test(mig), `agency_jobs.${c}`)
}
ok(/agency_jobs ADD COLUMN IF NOT EXISTS campanha_id uuid REFERENCES public\.agency_campanhas/.test(mig), 'agency_jobs.campanha_id')
ok(/agency_contrato_itens\s+ADD COLUMN IF NOT EXISTS ajustes_limite integer/.test(mig) && !/ajustes_limite integer[^,;]*NOT NULL/.test(mig),
  'limite de ajustes no contrato é opcional (vazio = sem limite, só contar)')
ok(/aprovacao_prazo_dias_uteis integer/.test(mig) && /prazo_em\s+timestamptz NOT NULL/.test(tabelaDe('agency_aprovacoes')), 'aprovação com prazo')
ok(/UNIQUE \(job_id, rodada\)/.test(tabelaDe('agency_job_rodadas')), 'uma linha por rodada do job')

// RLS: anotação privada (nem gestor), visão compartilhada só gestor, comentário em nome próprio
ok(/POLICY agency_anotacoes_autor ON public\.agency_anotacoes FOR ALL TO authenticated\s+USING \(user_id = auth\.uid\(\)\)/.test(mig),
  'anotação: só o autor lê e altera (sem is_admin)')
ok(/agency_visoes_pauta_criar[\s\S]*?NOT compartilhada OR public\.fn_acessos_pode_gerir\(company_id\)/.test(mig)
  && /agency_visoes_pauta_alterar[\s\S]*?NOT compartilhada OR public\.fn_acessos_pode_gerir\(company_id\)/.test(mig), 'visão compartilhada: só gestor cria/altera')
ok(/agency_job_comentarios_criar[\s\S]*?autor_id = auth\.uid\(\)[\s\S]*?j\.company_id = agency_job_comentarios\.company_id/.test(mig),
  'comentário: em nome próprio e só em job da mesma empresa')
ok(/GRANT UPDATE \(texto, excluido_em\) ON public\.agency_job_comentarios/.test(mig), 'comentário: só texto e exclusão lógica são alteráveis')
ok(/GRANT SELECT ON public\.agency_job_rodadas, public\.agency_aprovacoes TO authenticated;/.test(mig)
  && !/GRANT[^;]*(INSERT|UPDATE)[^;]*agency_(job_rodadas|aprovacoes)/.test(mig), 'rodadas e aprovações: só leitura direta (gravação pelas funções da P3)')

// listas configuráveis
const opcoes = corpoDe('fn_pauta_opcoes')
ok(/SECURITY DEFINER/.test(opcoes) && opcoes.indexOf('PERFORM public.fn__guarda_empresa(p_company_id)') > 0
  && opcoes.indexOf('PERFORM public.fn__guarda_empresa(p_company_id)') < opcoes.indexOf('INSERT INTO'), 'fn_pauta_opcoes: confere a empresa antes de gravar a semente')
for (const v of ['nao_iniciada', 'em_producao', 'aguardando', 'em_aprovacao', 'concluida', 'publicado']) ok(opcoes.includes(`'situacao_job', '${v}'`), `situação ${v}`)
ok((opcoes.match(/'motivo_aguardando', '/g) ?? []).length === 5, '5 motivos de espera')
ok(/WHERE company_id = p_company_id AND lista = 'situacao_job'\) THEN/.test(opcoes), 'semente não sobrescreve lista já configurada')

// contador das abas
const cont = corpoDe('fn_pauta_contadores')
ok(/SECURITY INVOKER/.test(cont) && !/SECURITY DEFINER/.test(cont), 'fn_pauta_contadores roda com a RLS de quem chama')
ok(cont.includes('j.excluido_em IS NULL'), 'contador ignora job na lixeira')
ok(cont.includes("regexp_replace(f.f->>'codigo', '[A-Za-z]+$', '')"), 'código com ou sem a letra da rodada')
for (const a of ['meus', 'atrasados', 'hoje', 'esperando_cliente']) ok(cont.includes(`WHEN '${a}'`), `atalho ${a}`)
for (const fn of ['fn_pauta_opcoes(uuid)', 'fn_pauta_contadores(uuid, jsonb)']) {
  ok(mig.includes(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC, anon;`), `${fn}: fechada a quem não está logado`)
}

// comentários antigos: cópia única, sem apagar o campo
ok(/'migrado_campo_antigo'\s+FROM public\.agency_jobs j/.test(mig) && /NOT EXISTS \(SELECT 1 FROM public\.agency_job_comentarios k WHERE k\.job_id = j\.id AND k\.origem = 'migrado_campo_antigo'\)/.test(mig)
  && !/DROP COLUMN/i.test(mig), 'comentários antigos copiados uma vez; campo antigo preservado')

if (falhas) { console.error(`\ncheck-pauta-p1-banco: ${falhas} falha(s)`); process.exit(1) }
console.log('\nPauta P1 · banco: ok')
