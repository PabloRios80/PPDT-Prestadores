require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

const keywords = [
  'Topicación con flúor',
  'Enseñanza técnica H.O.',
  'Práctica bioquímica',
  'SOMF',
  'papanicolau',
  'Módulo Día Preventivo',
  'Módulo Seguimiento',
  'Telereceta',
];

const filtro = keywords.map((k) => `descripcion_practica.ilike.%${k}%`).join(',');

console.log('FILTRO GENERADO:');
console.log(filtro);
console.log('');

supabase
  .from('practicas_autorizadas')
  .select('*')
  .eq('dni', '18040813')
  .or(filtro)
  .then((r) => {
    console.log('RESULTADO:');
    console.log(JSON.stringify(r, null, 2));
  });