"""Local preview/test adapter. Production storage is the managed D1 binding."""
import json
import sqlite3
import sys

db = sqlite3.connect(sys.argv[1], isolation_level=None)
db.row_factory = sqlite3.Row
for line in sys.stdin:
    message = json.loads(line)
    try:
        if message['method'] == 'script':
            db.executescript(message['sql'])
            result = None
        else:
            cursor = db.execute(message['sql'], message.get('args', []))
            row = cursor.fetchone() if message['method'] == 'first' else None
            result = dict(row) if row is not None else None
            if message['method'] == 'run':
                result = {'meta': {'changes': max(0, cursor.rowcount)}}
        print(json.dumps({'id': message['id'], 'result': result}), flush=True)
    except Exception as error:
        print(json.dumps({'id': message['id'], 'error': str(error)}), flush=True)
