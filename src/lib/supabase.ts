import { createClient } from '@supabase/supabase-js'

// Hardcoded para garantir funcionamento - keys do Supabase PS Gestão
const supabaseUrl = 'https://horsymhsinqcimflrtjo.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhvcnN5bWhzaW5xY2ltZmxydGpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyODE0MjYsImV4cCI6MjA5MDg1NzQyNn0.s2GbtX69F0HtH_uhbBt3cnV8opXPJEdDQlolkhir1Mo'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
