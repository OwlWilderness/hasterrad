from pathlib import Path
import subprocess,time,json
root=Path(__file__).resolve().parents[2]
net='hasterrad-0411-qualification'
names=['hasterrad-0411-web-test','hasterrad-0411-api-test']
def run(args):
    return subprocess.run(args,check=True,capture_output=True,text=True).stdout
created=[]
try:
    run(['docker','network','create',net])
    run(['docker','run','-d','--platform','linux/amd64','--name',names[1],'--network',net,'--network-alias','api','--tmpfs','/data:uid=10001,gid=10001,mode=0700','-e','HASTERRAD_STATIC_DIR=/app/public','-e','HOST=0.0.0.0','-e','PORT=8090','-e','HASTERRAD_PUBLIC_ORIGIN=https://hasterrad.quantumtekh.com','-e','HASTERRAD_DB_PATH=/data/topbar-auth/auth.sqlite','-e','HASTERRAD_SCORE_DB_PATH=/data/scores.sqlite3','-e','HASTERRAD_URBIT_ENABLED=0','-e','HASTERRAD_REMILIANET_ENABLED=0','-e','HASTERRAD_WALLET_AUTH_ENABLED=0','api.hasterrad-game.public.dappnode.eth:0.4.11'])
    created.append(names[1])
    run(['docker','run','-d','--platform','linux/amd64','--name',names[0],'--network',net,'-p','127.0.0.1:18789:8088','web.hasterrad-game.public.dappnode.eth:0.4.11'])
    created.append(names[0])
    for attempt in range(20):
        p=subprocess.run(['python3',str(Path(__file__).with_name('verify-local-http.py'))],capture_output=True,text=True)
        if p.returncode==0:break
        time.sleep(1)
    assert p.returncode==0,p.stderr
    print(p.stdout.strip())
    print(run(['python3',str(Path(__file__).with_name('verify-proxy-replay.py'))]).strip())
finally:
    for name in reversed(created):
        run(['docker','rm','-f',name])
    run(['docker','network','rm',net])
print('Disposable runtime containers and network removed; no owner volumes mounted')
