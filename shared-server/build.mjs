import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
// The deploy checkout contains exact copies of the engine and history from the
// main repository. Development builds read those files directly from public/.
const source = existsSync('./inputs/room-engine.js') ? './inputs/' : '../public/';
mkdirSync('dist/server', {recursive:true});
const engine = readFileSync(source + 'room-engine.js', 'utf8');
const history = JSON.parse(readFileSync(source + 'history.json', 'utf8'));
writeFileSync('dist/server/index.js', engine + '\nconst HISTORY = ' + JSON.stringify(history) + ';\n' +
  readFileSync('service.mjs', 'utf8') + '\nexport default createService(HISTORY);\n');
if (existsSync('.openai/hosting.json')) {
  mkdirSync('dist/.openai', {recursive:true});
  copyFileSync('.openai/hosting.json', 'dist/.openai/hosting.json');
}
