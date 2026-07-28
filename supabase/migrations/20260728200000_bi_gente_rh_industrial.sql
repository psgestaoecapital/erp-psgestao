-- BI de Gente para o papel rh_industrial: LIBERA o módulo `inteligencia` (BI) para o RH industrial.
-- Hoje permissoes_nivel tem (inteligencia, rh_industrial, pode_ver=false) → a RPC do sidebar esconde o BI.
-- O RECORTE (RH vê só o card/aba GENTE, nunca Produção/Abate) é filtro de VISTA no front, por papel
-- (users.role='rh_industrial') — genérico, sem hardcode de empresa/usuário. RLS de dados intacto.
-- Preserva o princípio "RH cuida de GENTE": ganha o recorte de Gente do BI, não o BI inteiro.

UPDATE public.permissoes_nivel
SET pode_ver = true
WHERE modulo_id = 'inteligencia' AND nivel = 'rh_industrial';
