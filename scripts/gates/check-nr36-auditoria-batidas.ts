// Gate (chamado #587 · Frioeste · CEO 01/10): auditoria de batidas. Roda no build, sem rede.
// Regra combinada: o sistema SUGERE, a responsável CONFIRMA COM JUSTIFICATIVA, NADA GRAVA SOZINHO, ANTES/DEPOIS na tela.
import { readFileSync } from 'node:fs'
import { sugerirPapeis, marcasDasPausas, diaSuspeito, type LinhaPausaDia } from '../../src/lib/ponto/pausasMarcas'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }
const fech = (l: LinhaPausaDia[]) => sugerirPapeis(marcasDasPausas(l)).pausas.filter((p) => p.situacao === 'fechada').map((p) => `${p.inicio}-${p.fim}`)

// 1) o exemplo do chamado (Claudinei 01/09): faltou uma batida na 1ª pausa, o resto desliza
const claudinei: LinhaPausaDia[] = [{ inicio_local: '09:05', fim_local: '10:40' }, { inicio_local: '11:01', fim_local: '15:10' }, { inicio_local: '15:30', fim_local: '17:04' }, { inicio_local: '17:27', fim_local: null }]
ok(diaSuspeito(claudinei), 'exemplo do chamado é apontado')
ok(JSON.stringify(sugerirPapeis(marcasDasPausas(claudinei)).faltando) === '["09:05"]', 'batida faltando = 09:05 (o par dela não foi batido)')
ok(JSON.stringify(fech(claudinei)) === '["10:40-11:01","15:10-15:30","17:04-17:27"]', 'pausas reais 10:40–11:01, 15:10–15:30, 17:04–17:27')

// 2) dia certo não é apontado; almoço (par longo original sem disputa) fica como está
const certo: LinhaPausaDia[] = [{ inicio_local: '09:19', fim_local: '09:41' }, { inicio_local: '11:09', fim_local: '11:31' }, { inicio_local: '14:29', fim_local: '14:52' }]
ok(!diaSuspeito(certo), 'dia sem batida faltando não é apontado')
const almoco: LinhaPausaDia[] = [{ inicio_local: '06:52', fim_local: '07:12' }, { inicio_local: '08:53', fim_local: '09:13' }, { inicio_local: '14:53', fim_local: '15:54' }]
ok(!diaSuspeito(almoco), 'almoço de 1h não vira batida faltando')
ok(sugerirPapeis(marcasDasPausas(almoco)).faltando.length === 0, 'par longo original sem disputa é mantido')

// 3) banco: lista só lê, confirmação exige justificativa, autoria pela sessão, histórico pela releitura
const mig = readFileSync('supabase/migrations/20261001170000_nr36_auditoria_batidas.sql', 'utf8')
ok(/fn_nr36_auditoria_batidas_dias[\s\S]*STABLE[\s\S]*fn_nr36_assert\(p_company_id\)/.test(mig), 'lista é só leitura (STABLE) e confere a empresa')
ok(/raw \? 'reler'/.test(mig) && /raw->>'inicio'/.test(mig), 'lista usa as batidas ORIGINAIS e tira dia já relido')
ok(/length\(btrim\(COALESCE\(p_justificativa, ''\)\)\) < 10/.test(mig) && /CHECK \(length\(btrim\(justificativa\)\) >= 10\)/.test(mig), 'justificativa obrigatória (função e tabela)')
ok(/public\.fn_nr36_reler_dia\(p_company_id, p_cpf, p_data, p_marcas\)/.test(mig), 'grava pelo caminho que arquiva a leitura anterior (desfazível)')
ok(/autor_id\)\s*VALUES[\s\S]*auth\.uid\(\)/.test(mig), 'autoria pela sessão')
ok(/REVOKE ALL ON public\.nr36_releitura_justificativa FROM PUBLIC, anon, authenticated/.test(mig) && !/GRANT (INSERT|UPDATE|DELETE)[^;]*nr36_releitura_justificativa/.test(mig), 'justificativa não é gravada direto pelo cliente')
ok(!/\bUPDATE public\.ind_ponto_pausa\b|\bDELETE FROM public\.ind_ponto_pausa\b/.test(mig), 'a migration não mexe em pausa existente')

// 4) tela: sugere, mostra antes/depois, exige justificativa
const tela = readFileSync('src/app/dashboard/compliance/pausas-tecnicas/page.tsx', 'utf8')
ok(/data-testid="auditoria-batidas"/.test(tela) && /fn_nr36_auditoria_batidas_dias/.test(tela), 'Conferência tem a Auditoria de batidas')
ok(/data-testid="marcas-antes"/.test(tela) && /data-testid="marcas-previa"/.test(tela), 'editor mostra ANTES e DEPOIS')
ok(/data-testid="marcas-justificativa"/.test(tela) && /fn_nr36_reler_dia_justificado/.test(tela) && !/rpc<[^>]*>\('fn_nr36_reler_dia', /.test(tela), 'gravar exige justificativa (sem atalho sem justificativa)')

if (falhas) { console.error(`\n${falhas} falha(s) na auditoria de batidas`); process.exit(1) }
console.log('\nAuditoria de batidas (#587): ok')
