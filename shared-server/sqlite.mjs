import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {readFileSync, readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

export async function openDatabase(filename = ':memory:') {
  const child = spawn('python3', [fileURLToPath(new URL('./sqlite-bridge.py', import.meta.url)), filename], {stdio:['pipe','pipe','inherit']});
  const pending = new Map();
  let serial = 0;
  const lines = createInterface({input:child.stdout});
  lines.on('line', line => {
    const value = JSON.parse(line), waiter = pending.get(value.id);
    pending.delete(value.id);
    if (value.error) waiter.reject(Error(value.error)); else waiter.resolve(value.result);
  });
  child.on('exit', () => { for (const waiter of pending.values()) waiter.reject(Error('Database closed')); pending.clear(); });
  function request(method, sql, args = []) {
    return new Promise((resolve, reject) => {
      const id = ++serial; pending.set(id, {resolve,reject});
      child.stdin.write(JSON.stringify({id,method,sql,args}) + '\n');
    });
  }
  const migrations = new URL('./drizzle/', import.meta.url);
  // Preview databases apply each checked-in schema migration once.
  await request('script', 'CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY);');
  for (const name of readdirSync(migrations).filter(x => x.endsWith('.sql')).sort()) {
    if (!await request('first', 'SELECT name FROM local_migrations WHERE name = ?', [name])) {
      await request('script', readFileSync(new URL(name, migrations), 'utf8'));
      await request('run', 'INSERT INTO local_migrations (name) VALUES (?)', [name]);
    }
  }
  return {
    prepare(sql) { return {bind(...args) { return {first:() => request('first',sql,args), run:() => request('run',sql,args)}; }}; },
    withSession() { return this; },
    close() { lines.close(); child.stdin.end(); },
  };
}
