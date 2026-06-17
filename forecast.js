const XLSX = require('xlsx');

// Seasonality coefficients (Jan-Dec) from historical data
const season = [0.090, 0.095, 0.061, 0.071, 0.070, 0.076, 0.082, 0.081, 0.093, 0.100, 0.093, 0.089];

// Planned verifications from database (by year-month)
const verifySchedule = {
  '2025-01':442,'2025-02':171,'2025-03':144,'2025-04':357,'2025-05':233,'2025-06':92,
  '2025-07':540,'2025-08':460,'2025-09':300,'2025-10':460,'2025-11':491,'2025-12':366,
  '2026-01':676,'2026-02':233,'2026-03':264,'2026-04':784,'2026-05':704,'2026-06':614,
  '2026-07':578,'2026-08':173,'2026-09':578,'2026-10':416,'2026-11':435,'2026-12':361,
  '2027-01':369,'2027-02':450,'2027-03':223,'2027-04':400,'2027-05':340,'2027-06':460,
  '2027-07':511,'2027-08':213,'2027-09':376,'2027-10':419,'2027-11':414,'2027-12':246,
  '2028-01':603,'2028-02':456,'2028-03':459,'2028-04':623,'2028-05':424,'2028-06':490,
  '2028-07':436,'2028-08':675,'2028-09':486,'2028-10':534,'2028-11':631,'2028-12':699,
};

// Non-verify baseline (install+replace+fix): avg 2022-2023 = ~4335/yr
// Slight growth trend: +3% per year
const nonVerifyBase = { 2025: 4700, 2026: 4850, 2027: 5000, 2028: 5150 };

const monthNames = ['Январь','Февраль','Март','Апрель','Май','Июнь',
                    'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

const wb = XLSX.utils.book_new();

// ---- Main forecast sheet ----
const headers = ['Месяц', 'Поверки (план)', 'Установка+Замена+Прочее', 'ИТОГО работ', 'Рабочих дней', 'Работ/день (расч.)'];
const rows = [headers];

for (const year of [2025, 2026, 2027, 2028]) {
  // year separator
  rows.push([`──── ${year} ────`, '', '', '', '', '']);

  let yearTotal = 0, yearVerify = 0, yearOther = 0;

  for (let m = 1; m <= 12; m++) {
    const key = `${year}-${String(m).padStart(2,'0')}`;
    const verify = verifySchedule[key] || 0;
    const other = Math.round(nonVerifyBase[year] * season[m-1]);
    const total = verify + other;
    yearVerify += verify;
    yearOther += other;
    yearTotal += total;

    // Working days (approx: 22 avg, minus Kazakhstan holidays rough estimate)
    const workDays = [21,20,21,22,21,21,23,22,22,23,21,22][m-1];
    const perDay = Math.round(total / workDays * 10) / 10;

    rows.push([`${monthNames[m-1]} ${year}`, verify, other, total, workDays, perDay]);
  }

  // Year total row
  rows.push([`ИТОГО ${year}`, yearVerify, yearOther, yearTotal, '', '']);
  rows.push(['', '', '', '', '', '']);
}

const ws = XLSX.utils.aoa_to_sheet(rows);
ws['!cols'] = [{wch:20},{wch:18},{wch:25},{wch:15},{wch:15},{wch:20}];

// Highlight year-total rows
const boldRows = [];
rows.forEach((r, i) => {
  if (typeof r[0] === 'string' && r[0].startsWith('ИТОГО')) boldRows.push(i+1);
});

XLSX.utils.book_append_sheet(wb, ws, 'Прогноз по месяцам');

// ---- Summary by year ----
const sumRows = [
  ['Год', 'Поверки', 'Прочие работы', 'ИТОГО', 'Прирост к пред. году'],
  [2025, 4056, 4700, {f:'B2+C2'}, '—'],
  [2026, 5816, 4850, {f:'B3+C3'}, {f:'(D3-D2)/D2', z:'0.0%'}],
  [2027, 4421, 5000, {f:'B4+C4'}, {f:'(D4-D3)/D3', z:'0.0%'}],
  [2028, 6516, 5150, {f:'B5+C5'}, {f:'(D5-D4)/D4', z:'0.0%'}],
  ['ИТОГО', {f:'SUM(B2:B5)'}, {f:'SUM(C2:C5)'}, {f:'SUM(D2:D5)'}, ''],
];
const ws2 = XLSX.utils.aoa_to_sheet(sumRows);
ws2['!cols'] = [{wch:8},{wch:12},{wch:16},{wch:12},{wch:22}];
XLSX.utils.book_append_sheet(wb, ws2, 'Сводка по годам');

// ---- Assumptions sheet ----
const assumRows = [
  ['ДОПУЩЕНИЯ И МЕТОДОЛОГИЯ', ''],
  ['', ''],
  ['Поверки', 'Взяты напрямую из даты "Дата следующей поверки (факт.)" в базе — это реальные плановые даты'],
  ['Прочие работы', 'Прогноз на основе среднего 2022-2023 (~4335/год) + рост 3%/год'],
  ['Сезонность', 'Коэффициенты из исторических данных 2016-2024 (42 005 выполненных работ)'],
  ['Отмены', 'Исторически ~20% заявок отменяются — реальная нагрузка выше на 20%'],
  ['Рабочие дни', 'Стандарт ~22 дня/месяц, незначительные корректировки'],
  ['', ''],
  ['КОЭФФИЦИЕНТЫ СЕЗОННОСТИ', ''],
  ['Месяц', 'Коэффициент', 'Пояснение'],
  ...monthNames.map((m, i) => [m, season[i], i === 9 ? 'Октябрь — пик' : i === 2 ? 'Март — минимум' : '']),
  ['', ''],
  ['ВАЖНО: счётчики с просроченной поверкой (до 2024)', 4098+314+1073+2338+2973, 'не учтены — потенциальный дополнительный объём'],
];
const ws3 = XLSX.utils.aoa_to_sheet(assumRows);
ws3['!cols'] = [{wch:30},{wch:12},{wch:60}];
for(let i=10;i<=21;i++){ const c = ws3[`B${i}`]; if(c) c.z='0.0%'; }
XLSX.utils.book_append_sheet(wb, ws3, 'Допущения');

const outPath = 'F:/work/архив до 2024/Прогноз_работ_2025-2028.xlsx';
XLSX.writeFile(wb, outPath);
console.log('Saved:', outPath);
