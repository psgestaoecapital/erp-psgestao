// Gate (auditor 24/10 · gap "nada irreversível sem prévia e desfazer"): fechar a viagem passa por uma prévia que mostra
// o que cada obra recebe (lido da v_viagem_custo_obra, fonte do Resultado), e excluir lançamento pode ser desfeito por
// 15 min por quem excluiu, com a viagem aberta — numa função nova, só aditiva. Sem rede.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// acha a migration pelo sufixo: a fila pode renumerar a versão sem quebrar o gate
const arq = readdirSync('supabase/migrations').find(f => f.endsWith('_viagem_previa_desfazer.sql'))
if (!arq) throw new Error('migration *_viagem_previa_desfazer.sql não encontrada')
const mig = readFileSync(`supabase/migrations/${arq}`, 'utf8').replace(/--[^\n]*/g, '')
const fn = mig.slice(mig.indexOf('CREATE OR REPLACE FUNCTION public.fn_viagem_lancamento_restaurar('), mig.indexOf('$function$;'))

ok(fn.length > 0 && /SECURITY DEFINER\s+SET search_path TO 'public'/.test(fn), 'restaurar: search_path fixo')
ok(/REVOKE ALL ON FUNCTION public\.fn_viagem_lancamento_restaurar\(uuid\) FROM PUBLIC, anon;/.test(mig), 'fechada a anon')
ok(fn.includes('auth.uid() IS NULL') && fn.includes('fn__guarda_empresa(v_l.company_id)') && fn.includes('fn_viagem_pode_gravar(v_l.company_id)'), 'exige login, guarda de empresa e perfil que grava')
ok(fn.includes('v_l.excluido_por IS DISTINCT FROM auth.uid()') && fn.includes("interval '15 minutes'"), 'só quem excluiu, até 15 minutos')
ok(fn.includes("v_status <> 'aberta'"), 'viagem fechada não se altera')
ok((fn.match(/\bUPDATE public\./g) ?? []).length === 1 && fn.includes('WHERE id = p_id') && !/\b(INSERT|DELETE)\b/.test(fn), 'só desfaz a marca de exclusão do próprio lançamento')
ok(!/CREATE OR REPLACE (VIEW|FUNCTION public\.(?!fn_viagem_lancamento_restaurar\())/.test(mig) && !/ALTER TABLE/.test(mig), 'só aditivo: nada existente muda')
const chaves = ['previa_fechar', 'previa_obra', 'previa_confirmar', 'desfazer_exclusao']
ok(chaves.every((c) => mig.includes(`'projetos.viagem.${c}'`)), '"?" (RD-95) da prévia e do desfazer no banco')

const previa = readFileSync('src/app/dashboard/projetos/viagens/PreviaFechamento.tsx', 'utf8')
ok(/from\('v_viagem_custo_obra'\)/.test(previa) && !/\.(insert|update|delete|rpc)\(/.test(previa), 'prévia só lê a fonte do Resultado da obra')
ok(chaves.filter((c) => c !== 'desfazer_exclusao').every((c) => previa.includes(`chave="projetos.viagem.${c}"`)), 'prévia: "?" em tudo')
const page = readFileSync('src/app/dashboard/projetos/viagens/page.tsx', 'utf8')
ok(!/confirm\(/.test(page), 'sem confirm() do navegador: fechar tem prévia, excluir tem desfazer')
ok(page.includes("onClick={() => { setPrevia(true)") && /<PreviaFechamento [^>]*onConfirmar=\{fechar\}/.test(page), 'Fechar viagem abre a prévia; só o Confirmar fecha (3 toques: abrir, fechar, confirmar)')
ok(page.includes("rpc('fn_viagem_lancamento_restaurar'") && page.includes('chave="projetos.viagem.desfazer_exclusao"'), 'excluir mostra Desfazer, com "?"')
if (falhas) process.exit(1)
