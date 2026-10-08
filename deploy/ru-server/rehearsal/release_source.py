"""Explicit source write-pause and recoverable final capture. Server use only."""
import hashlib
import json
import os
from pathlib import Path
import time

RUNTIMES=('bos_push_private','bos_hands_private','bos_avito_private','bos_control_private')
RECONNECT="""SELECT pg_terminate_backend(a.pid) FROM pg_stat_activity a JOIN pg_roles r ON r.rolname=a.usename
WHERE a.datname=current_database() AND a.pid<>pg_backend_pid() AND NOT r.rolsuper AND a.backend_type='client backend';"""
STATE_SQL="""SELECT jsonb_build_object(
 'readonly',(SELECT substring(v from position('=' in v)+1) FROM pg_db_role_setting s,
 unnest(s.setconfig) v WHERE s.setdatabase=(SELECT oid FROM pg_database WHERE datname=current_database())
 AND s.setrole=0 AND v LIKE 'default_transaction_read_only=%'),
 'cron',(SELECT jsonb_agg(jsonb_build_object('id',jobid,'active',active) ORDER BY jobid) FROM cron.job),
 'runtime',jsonb_build_object("""+', '.join("'%s',(SELECT enabled FROM %s.runtime)"%(s,s) for s in RUNTIMES)+'));'

def durable_text(path,value,mode=0o600):
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,mode)
    with os.fdopen(fd,'w') as f:
        os.fchmod(f.fileno(),mode)
        f.write(value);f.flush();os.fsync(f.fileno())
    fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
    try:os.fsync(fd)
    finally:os.close(fd)

def durable_json(path,value):
    durable_text(path,json.dumps(value,ensure_ascii=False,indent=2)+'\n')

def validate_state(state):
    if (state.get('readonly') not in (None,'off') or len(state.get('cron',[]))!=4
        or {j.get('id') for j in state['cron']}!={1,2,3,4}
        or any(type(j.get('active')) is not bool for j in state['cron'])
        or not {'bos_push_private','bos_hands_private','bos_avito_private'}<=set(state.get('runtime',{}))
        or not set(state['runtime'])<=set(RUNTIMES)
        or any(type(v) is not bool for v in state['runtime'].values())):
        raise ValueError('Unexpected source state; no freeze applied')

def flags_sql(state):
    validate_state(state)
    return '\n'.join([f"SELECT cron.alter_job(job_id:={j['id']},active:={'true' if j['active'] else 'false'});" for j in state['cron']]+
                     [f"UPDATE {s}.runtime SET enabled={'true' if active else 'false'};" for s,active in state['runtime'].items()])

def thaw_sql(state):
    validate_state(state)
    setting='RESET default_transaction_read_only' if state['readonly'] is None else 'SET default_transaction_read_only=off'
    return 'SET default_transaction_read_only=off;\nBEGIN;\nALTER DATABASE postgres '+setting+';\n'+flags_sql(state)+'\nCOMMIT;\n'+RECONNECT+'\n'

def recover_before_activation(freeze_attempted,activation_attempted,thaw):
    if not freeze_attempted:return True
    if activation_attempted:return False
    try:thaw();return True
    except (Exception,KeyboardInterrupt):return False

class Source:
    def __init__(self,runner,client,stage):
        self.runner,self.client,self.stage=runner,client,stage
        self.attempted=False;self.state=None

    def sql(self,sql,timeout=60):
        return self.runner.command(['docker','exec','-i',self.client,'psql','-X','-w','-qAt',
            '-v','ON_ERROR_STOP=1','-v','VERBOSITY=terse'],input=sql.encode(),timeout=timeout).stdout

    def preflight(self):
        info=json.loads(self.sql("SELECT jsonb_build_object('database',current_database(),'user',current_user,"
            "'version',current_setting('server_version_num')::int,'signal',pg_has_role(current_user,'pg_signal_backend','MEMBER'),"
            "'overrides',(SELECT count(*) FROM pg_db_role_setting s,unnest(s.setconfig) v WHERE s.setrole<>0 AND v='default_transaction_read_only=off'));"))
        if (info['database']!='postgres' or info['user']!='postgres' or not 170000<=info['version']<180000
            or not info['signal'] or info['overrides']):raise ValueError('Source preflight mismatch')
        self.state=json.loads(self.sql(STATE_SQL));validate_state(self.state)
        durable_json(self.stage/'source-state.json',self.state)
        durable_text(self.stage/'source-thaw.sql',thaw_sql(self.state))

    def freeze(self):
        # Persist intent BEFORE sending the first source mutation, including lost responses.
        durable_json(self.stage/'source-freeze-attempted.json',{'attempted':True})
        self.attempted=True
        disabled={**self.state,'cron':[{'id':j['id'],'active':False} for j in self.state['cron']],
                  'runtime':{s:False for s in self.state['runtime']}}
        sql='BEGIN; SET LOCAL lock_timeout=\'10s\';\n'+flags_sql(disabled)
        sql+='\nCOMMIT;'
        self.sql(sql)
        # Let already-started external Hands uploads acknowledge their outcome before readonly.
        for attempt in range(180):
            busy=int(self.sql("SELECT (SELECT count(*) FROM bos_hands_private.deliveries WHERE inflight) + "
                "(SELECT count(*) FROM public.bos_push_deliveries WHERE state='sending' AND locked_until>now());").strip())
            queued=int(self.sql('SELECT count(*) FROM net.http_request_queue;').strip())
            if not busy and not queued:break
            if attempt%30==0:print('Ожидание завершения уже начатых фоновых отправок...',flush=True)
            time.sleep(1)
        else:raise RuntimeError('Source integration work did not quiesce')
        self.sql('ALTER DATABASE postgres SET default_transaction_read_only=on;')
        # Ordinary application/database clients reconnect into readonly. Platform superusers are untouched.
        self.sql(RECONNECT)
        for _ in range(30):
            self.assert_frozen()
            if self.sql('SELECT count(*) FROM net.http_request_queue;').strip()==b'0':return
            time.sleep(1)
        raise RuntimeError('Source outgoing queue did not drain')

    def assert_frozen(self):
        value=json.loads(self.sql("SELECT jsonb_build_object('readonly',current_setting('default_transaction_read_only'),"
            "'cron',(SELECT count(*) FROM cron.job WHERE active));"))
        state=json.loads(self.sql(STATE_SQL))
        if value!={'readonly':'on','cron':0} or state['readonly']!='on' or any(state['runtime'].values()):
            raise RuntimeError('Source write-pause lost')

    def thaw(self):
        # A rejected first transaction leaves the source unchanged: verify it instead
        # of repeating the failed mutation and falsely reporting an unrecovered source.
        if json.loads(self.sql(STATE_SQL))!=self.state:
            self.sql(thaw_sql(self.state))
        if json.loads(self.sql(STATE_SQL))!=self.state:raise RuntimeError('Source state restoration mismatch')
        try:durable_json(self.stage/'source-thawed.json',{'restored':True})
        except OSError:pass  # The source state was already verified; a full disk cannot undo thaw.

    def capture(self,backup):
        self.assert_frozen()
        if not backup.is_dir() or any(backup.iterdir()):raise ValueError('Final backup destination is not empty')
        for name,command in [('source.dump',['pg_dump','-w','--format=custom']),
                             ('roles.sql',['pg_dumpall','-w','--roles-only','--no-role-passwords'])]:
            result=self.runner.command(['docker','exec',self.client,*command],timeout=600)
            if not result.stdout:raise ValueError('Empty source backup')
            (backup/name).write_bytes(result.stdout)
        vault=self.sql('COPY (SELECT id,name,description,decrypted_secret,created_at,updated_at FROM vault.decrypted_secrets ORDER BY id) TO STDOUT WITH (FORMAT csv,HEADER true);')
        (backup/'vault.csv').write_bytes(vault)
        inventory=self.sql("SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'bucket_id',bucket_id,'name',name,'version',version,"
            "'metadata',metadata,'created_at',created_at,'updated_at',updated_at) ORDER BY id),'[]'::jsonb) FROM storage.objects;")
        (backup/'storage.json').write_bytes(inventory)
        self.assert_frozen()
        return json.loads(inventory)
