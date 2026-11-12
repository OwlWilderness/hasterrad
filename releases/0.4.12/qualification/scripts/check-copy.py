from pathlib import Path
import hashlib,json
root=Path(__file__).resolve().parents[2]/'hasterrad-game/source'
for tree in ['public','api/public']:
    for name in ['index.html','asteroids.html']:
        text=(root/tree/name).read_text()
        assert 'content="Dodge. Blast. Survive. Climb the leaderboard."' in text
        assert '>v0.4.12</span>' in text
        assert (root/'public'/name).read_bytes()==(root/'api/public'/name).read_bytes()
    manifest=json.loads((root/tree/'artifact.json').read_text())
    for name,digest in manifest['files'].items():
        assert hashlib.sha256((root/tree/name).read_bytes()).hexdigest()==digest,name
print('PASS: both routes, mirrored copies, description, release label, all manifest hashes')
