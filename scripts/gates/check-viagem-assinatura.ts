// Gate (auditor 24/10 · gap "Adiantamento e prestação de contas … aprovação do gestor … assinatura eletrônica do
// colaborador"): a assinatura do acerto mora numa tabela NOVA só de leitura para o app (grava só a função), a função exige
// usuário logado, perfil que grava, nome do colaborador da viagem, gestor com perfil de gestão e diferente de quem
// registrou o colaborador, e invalida a assinatura quando o acerto muda (hash). Sem rede.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// acha a migration pelo sufixo: a fila pode renumerar a versão sem quebrar o gate
const arq = readdirSync('supabase/migrations').find(f => f.endsWith('_viagem_assinatura_acerto.sql'))
if (!arq) throw new Error('migration *_viagem_assinatura_acerto.sql não encontrada')
const mig = readFileSync(`supabase/migrations/${arq}`, 'utf8').replace(/--[^\n]*/g, '')
const trecho = (ini: string) => mig.slice(mig.indexOf(ini), mig.indexOf('$function$;', mig.indexOf(ini)))
const assinar = trecho('CREATE OR REPLACE FUNCTION public.fn_viagem_assinar(')
const ler = trecho('CREATE OR REPLACE FUNCTION public.fn_viagem_assinaturas(')

ok(/CREATE TABLE IF NOT EXISTS public\.erp_viagem_assinatura/.test(mig) && /ENABLE ROW LEVEL SECURITY/.test(mig), 'tabela nova com RLS')
ok(/REVOKE ALL ON public\.erp_viagem_assinatura FROM PUBLIC, anon, authenticated;/.test(mig) && /GRANT SELECT ON public\.erp_viagem_assinatura TO authenticated;/.test(mig), 'app só lê a tabela (grava só a função)')
ok(!/FOR (INSERT|UPDATE|DELETE|ALL)/.test(mig), 'nenhuma policy de gravação')
ok(/trg_viagem_trava_viewer BEFORE INSERT OR UPDATE OR DELETE ON public\.erp_viagem_assinatura/.test(mig), 'perfil de consulta barrado no banco')
ok(!/ALTER TABLE public\.(?!erp_viagem_assinatura)/.test(mig) && !/CREATE OR REPLACE VIEW/.test(mig)
  && !/CREATE OR REPLACE FUNCTION public\.(?!fn__viagem_acerto_hash\(|fn_viagem_assinar\(|fn_viagem_assinaturas\()/.test(mig), 'só aditivo: nada existente muda')
ok(!/\b(UPDATE|DELETE)\b/.test(assinar) && !/erp_pagar|erp_receber/.test(mig), 'não altera dado nem toca o financeiro')
ok(/SECURITY DEFINER\s+SET search_path TO 'public'/.test(assinar) && /REVOKE ALL ON FUNCTION public\.fn_viagem_assinar\(uuid, text, text\) FROM PUBLIC, anon;/.test(mig), 'fn_viagem_assinar: search_path fixo e fechada a anon')
ok(assinar.includes('IF auth.uid() IS NULL THEN') && assinar.includes('fn__guarda_empresa(v_v.company_id)') && assinar.includes('fn_viagem_pode_gravar(v_v.company_id)'), 'exige usuário logado, empresa e perfil que grava')
ok(assinar.includes('lower(v_nome) <> lower(btrim(v_v.colaborador_nome))'), 'colaborador assina com o nome da viagem')
ok(assinar.includes("'owner', 'socio', 'admin', 'adm', 'acesso_total'") && assinar.includes('v_col.usuario_id = auth.uid()'), 'gestor com perfil de gestão e diferente de quem registrou o colaborador')
ok(assinar.includes('v_col.acerto_hash <> v_hash'), 'gestor só aprova o acerto que o colaborador assinou')
ok(/STABLE SECURITY INVOKER/.test(ler) && ler.includes("'desatualizada'") && ler.includes('u.acerto_hash = h.atual'), 'situação lida com a RLS de quem lê e invalida quando o acerto muda')
const hash = trecho('CREATE OR REPLACE FUNCTION public.fn__viagem_acerto_hash(')
ok(['l.valor', 'l.obra_id', 'l.forma_pagamento', 'l.pago_colaborador', 'v.adiantamento', 'l.excluido_em IS NULL'].every((c) => hash.includes(c)), 'hash cobre cupom, obra, forma, quem pagou e adiantamento')

const chaves = ['assin_situacao', 'assin_colaborador', 'assin_gestor', 'assin_nome']
ok(chaves.every((c) => mig.includes(`'projetos.viagem.${c}'`)), '"?" (RD-95) no banco')
const tela = readFileSync('src/app/dashboard/projetos/viagens/AssinaturaAcerto.tsx', 'utf8')
ok(/rpc\('fn_viagem_assinar'/.test(tela) && /rpc\('fn_viagem_assinaturas'/.test(tela) && !/\.(insert|update|delete|from)\(/.test(tela), 'tela só chama as funções')
ok(chaves.every((c) => tela.includes(`chave="projetos.viagem.${c}"`)), 'tela: "?" em todo campo')
ok(/<AssinaturaAcerto /.test(readFileSync('src/app/dashboard/projetos/viagens/page.tsx', 'utf8')), 'ligada na tela de Viagens')
if (falhas) process.exit(1)
