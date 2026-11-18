from pathlib import Path
import subprocess,time,os,uuid
images = {s: os.environ.get('HASTERRAD_' + s.upper() + '_IMAGE', f'{s}.hasterrad-game.public.dappnode.eth:0.4.13') for s in ('web','api')}

net='hasterrad-0413-qualification-'+uuid.uuid4().hex[:10]
names=[net+'-web',net+'-api']
hardening=['--cap-drop=ALL','--security-opt=no-new-privileges:true']
def run(args):
    return subprocess.run(args,check=True,capture_output=True,text=True).stdout
created=[]
network_created=False
try:
    run(['docker','network','create',net])
    network_created=True
    run(['docker','run','-d','--platform','linux/amd64',*hardening,'--name',names[1],'--network',net,'--network-alias','api','--tmpfs','/data:uid=10001,gid=10001,mode=0700','-e','HASTERRAD_STATIC_DIR=/app/public','-e','HOST=0.0.0.0','-e','PORT=8090','-e','HASTERRAD_PUBLIC_ORIGIN=https://game.example.invalid','-e','HASTERRAD_DB_PATH=/data/topbar-auth/auth.sqlite','-e','HASTERRAD_SCORE_DB_PATH=/data/scores.sqlite3','-e','HASTERRAD_URBIT_ENABLED=0','-e','HASTERRAD_REMILIANET_ENABLED=0','-e','HASTERRAD_WALLET_AUTH_ENABLED=0',images['api']])
    created.append(names[1])
    run(['docker','run','-d','--platform','linux/amd64',*hardening,'--name',names[0],'--network',net,'-p','127.0.0.1:18789:8088',images['web']])
    created.append(names[0])
    for attempt in range(20):
        for name in created:
            assert run(['docker','inspect','--format','{{.State.Running}}',name]).strip()=='true', f'{name} exited during startup'
        p=subprocess.run(['python3',str(Path(__file__).with_name('verify-local-http.py'))],capture_output=True,text=True)
        if p.returncode==0:break
        time.sleep(1)
    assert p.returncode==0,p.stderr
    print(p.stdout.strip())
    print(run(['python3',str(Path(__file__).with_name('verify-proxy-replay.py'))]).strip())
    for service, name in zip(('web','api'),names):
        run(['docker','stop','-t','10',name])
        image, state = run(['docker','inspect','--format','{{.Image}} {{.State.Status}}',name]).split()
        assert state=='exited'
        assert image==run(['docker','image','inspect','--format','{{.Id}}',images[service]]).strip()
        print(f'{service}: exact stopped-container image {image}')
finally:
    for name in reversed(created):
        run(['docker','rm','-f',name])
    if network_created:
        run(['docker','network','rm',net])
print('Disposable runtime containers and network removed; no owner volumes mounted')
