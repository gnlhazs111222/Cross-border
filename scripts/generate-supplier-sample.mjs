import { readFileSync, writeFileSync } from 'node:fs';
import { read, utils, write } from 'xlsx';

// CSV is the editable source of the shipped XLSX fixture. No business API is called.
const csvPath = new URL('../public/demo/prismlaunch-supplier-demo.csv', import.meta.url);
const parsed = read(readFileSync(csvPath, 'utf8'), { type: 'string', raw: true, FS: ',' });
const workbook = utils.book_new();
utils.book_append_sheet(workbook, parsed.Sheets[parsed.SheetNames[0]], 'Products');
writeFileSync(new URL('../public/demo/prismlaunch-supplier-demo.xlsx', import.meta.url), write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true }));
console.log('Created public/demo/prismlaunch-supplier-demo.xlsx from the CSV sample.');
