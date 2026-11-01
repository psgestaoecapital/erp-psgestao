// Gate (HB0 · HBF-0.5) — a OS de obra tem diário do dia (RDO): clima, se deu para trabalhar, efetivo, o que foi feito,
// ocorrências e fotos. Um RDO por OS e por dia; grava só pela função com guarda; fotos só na pasta da empresa da OS no
// bucket projetos-plantas (policy já isola por empresa — esta PR não mexe em storage). Sem rede: lê a migration e a tela.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const mig = readFileSync('supabase/migrations/20261024190000_hb0_os_obra_rdo.sql', 'utf8')
const corpo = mig.split('\n').filter(l => !l.trimStart().startsWith('--')).join('\n')
const tela = readFileSync('src/app/dashboard/projetos/obras/os/page.tsx', 'utf8')

// migration aditiva: tabela nova com RLS de leitura por empresa, função nova, nada de dado existente
ok(corpo.includes('CREATE TABLE IF NOT EXISTS public.projetos_obra_rdo ('), 'tabela nova projetos_obra_rdo')
ok(!/\b(DELETE FROM|TRUNCATE|DROP TABLE|DROP FUNCTION|DROP COLUMN)\b/i.test(corpo) && !/ALTER TABLE public\.(?!projetos_obra_rdo\b)/.test(corpo), 'sem DELETE/TRUNCATE/DROP nem ALTER de tabela existente')
ok((corpo.match(/\bUPDATE public\.(\w+)/g) ?? []).every(u => u === 'UPDATE public.projetos_obra_rdo'), 'UPDATE só no RDO novo (corrigir o diário do dia)')
ok(corpo.includes('ALTER TABLE public.projetos_obra_rdo ENABLE ROW LEVEL SECURITY'), 'RLS ligada')
ok(/REVOKE ALL ON public\.projetos_obra_rdo FROM PUBLIC, anon/.test(corpo), 'anon sem acesso à tabela')
ok(/FOR SELECT TO authenticated\s+USING \(public\.is_admin\(\) OR company_id IN \(SELECT public\.get_user_company_ids\(\)\)\)/.test(corpo), 'leitura só da empresa do usuário')
ok(!/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*projetos_obra_rdo/i.test(corpo), 'sem escrita direta na tabela (só pela função)')
ok(/UNIQUE INDEX IF NOT EXISTS projetos_obra_rdo_os_dia_uq\s+ON public\.projetos_obra_rdo \(os_id, data\) WHERE excluido_em IS NULL/.test(corpo), 'um diário por OS e por dia')
ok((corpo.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length === 1 && corpo.includes('FUNCTION public.fn_obra_rdo_salvar(p_os_id uuid, p_dados jsonb)'), 'só uma função, e nova')
ok(corpo.includes('PERFORM public.fn__guarda_empresa(v_company)'), 'guarda de empresa pela empresa da OS')
ok(/REVOKE ALL ON FUNCTION public\.fn_obra_rdo_salvar\(uuid, jsonb\) FROM PUBLIC, anon/.test(corpo), 'anon sem EXECUTE')
ok(/v_status NOT IN \('aberta', 'em_execucao'\)/.test(corpo), 'só OS aberta ou em execução recebe diário')
ok(corpo.includes('IF v_data > current_date THEN'), 'data futura recusada')
ok(corpo.includes("f NOT LIKE v_company::text || '/rdo/' || p_os_id::text || '/%'"), 'foto só da pasta da empresa e da OS')
ok(corpo.includes('cardinality(v_fotos) > 10') && corpo.includes('cardinality(fotos) <= 10'), 'no máximo 10 fotos por dia')
ok(/SELECT id INTO v_id FROM public\.projetos_obra_rdo WHERE os_id = p_os_id AND data = v_data AND excluido_em IS NULL/.test(corpo), 'dia que já tem diário é atualizado, não duplica')

// RD-95: cada "?" da tela tem chave em migration
const base = ['20261023180535_hub_os_obra.sql', '20261024180000_hb0_os_obra_apontar_horas.sql',
  // HB4 (quantidade do diário) lida pelo sufixo: a fila pode renumerar a versão
  ...readdirSync('supabase/migrations').filter(f => f.endsWith('_hb4_rdo_quantidade_avanco.sql')),
  // filtro por responsável (migration posterior ao HB0): mesma leitura por sufixo (renomeável pela fila)
  ...readdirSync('supabase/migrations').filter(f => f.endsWith('_hub_os_obra_ajuda_filtro_responsavel.sql'))]
  .map(f => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n')
const chaves = [...tela.matchAll(/AjudaCampo chave="([^"]+)"/g)].map(m => m[1])
const novas = ['rdo', 'rdo_registrados', 'rdo_data', 'rdo_clima', 'rdo_praticavel', 'rdo_efetivo', 'rdo_atividades', 'rdo_ocorrencias', 'rdo_fotos', 'rdo_salvar']
  .map(c => `projetos.os_obra.${c}`)
for (const c of novas) ok(chaves.includes(c) && corpo.includes(`'${c}'`), `"?" ${c} na tela e no banco`)
ok(chaves.every(c => corpo.includes(`'${c}'`) || base.includes(`'${c}'`)), 'todo "?" da tela tem chave em migration')

// tela: grava pela função, fotos na pasta da empresa/OS, botão só em OS ativa, celular abre a câmera
ok(tela.includes("rpc('fn_obra_rdo_salvar'"), 'tela grava pela função com guarda')
ok(tela.includes('`${o.company_id}/rdo/${o.id}/${crypto.randomUUID()}.${ext}`'), 'foto enviada para a pasta da empresa e da OS')
ok(tela.includes("const BUCKET = 'projetos-plantas'"), 'bucket existente (sem policy nova)')
ok(/o\.status === 'aberta' \|\| o\.status === 'em_execucao'\) && <span style=\{rot\}><button[^\n]*abrirDiario\(o\)/.test(tela), 'botão Diário do dia só em OS ativa')
ok(tela.includes('accept="image/*" capture="environment" multiple'), 'no celular o campo de fotos abre a câmera')
ok(tela.includes(".from('projetos_obra_rdo').select(") && tela.includes(".is('excluido_em', null).order('data', { ascending: false })"), 'lista ignora excluídos, do mais novo ao mais antigo')

if (falhas) { console.error(`\n${falhas} falha(s) — check-hub-os-rdo`); process.exit(1) }
console.log('\ncheck-hub-os-rdo: verde')
