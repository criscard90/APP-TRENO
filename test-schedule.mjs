// Verifica: prossime 3 partenze da schedule-555.json per il giorno corrente
import fs from 'node:fs';
const j = JSON.parse(fs.readFileSync(new URL('./schedule-555.json', import.meta.url), 'utf8'));
const now = new Date();
const dow = now.getDay();
const svc = dow === 0 ? '30' : (dow === 6 ? '20' : '10');
const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
const next = j.departures.filter(d => d.s.includes(svc) && d.t >= hhmm).slice(0, 3).map(d => d.t);
console.log(`Servizio oggi: ${svc} | ora: ${hhmm} | prossime 3 partenze da Ponte Di Nona: ${next.join(' - ')}`);