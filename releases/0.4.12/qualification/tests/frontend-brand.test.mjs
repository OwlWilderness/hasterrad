import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../hasterrad-game/source/public/',import.meta.url));

test('the release version is visible in both game routes',()=>{
  for(const name of ['index.html','asteroids.html']){
    const html=readFileSync(`${root}/${name}`,'utf8');
    assert.match(html,/<span class="build-version"[^>]*>v0\.4\.12<\/span>/);
  }
});

test('the Remilia icon has a genuinely transparent outer corner',()=>{
  const png=readFileSync(`${root}/assets/brands/remilia.png`);
  assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  assert.equal(png[25],6,'RGBA PNG color type');
  const idat=[];
  for(let at=8;at<png.length;){const len=png.readUInt32BE(at),type=png.toString('ascii',at+4,at+8);
    if(type==='IDAT')idat.push(png.subarray(at+8,at+8+len));at+=len+12;}
  const first=inflateSync(Buffer.concat(idat));
  assert.equal(first[4],0,'the upper-left background pixel is transparent');
});

test('compact header aligns Pause with login icons and puts site/version in the footer',()=>{
  for(const route of ['index.html','asteroids.html']){
    const html=readFileSync(`${root}/${route}`,'utf8');
    const header=html.match(/<header class="arcade-header">([\s\S]*?)<\/header>/)?.[1];
    const footer=html.match(/<footer class="arcade-footer">([\s\S]*?)<\/footer>/)?.[1];
    assert.ok(header && footer);
    assert.match(header,/^\s*<div class="account-controls"/);
    assert.match(header,/<\/div>\s*<button id="pause"/);
    assert.doesNotMatch(header,/home-link|build-version|edition/);
    assert.match(footer,/<a href="https:\/\/quantumtekh\.com\/" class="home-link">← Quantumtekh<\/a>/);
    assert.match(footer,/<span class="build-version"[^>]*>v0\.4\.12<\/span>/);
  }
  const css=readFileSync(`${root}/assets/asteroids.css`,'utf8');
  assert.match(css,/\.arcade-header\s*\{[^}]*align-items:\s*flex-start/);
  assert.match(css,/\.account-controls\s*\{[^}]*grid-template-columns:\s*repeat\(4,44px\)/);
  assert.match(css,/\.account-status\s*\{[^}]*grid-row:\s*2/);
  assert.match(css,/#account-logout\s*\{[^}]*grid-row:\s*1;[^}]*grid-column:\s*4/);
  assert.doesNotMatch(css,/@media\s*\(max-width:\s*700px\)[^}]*\.account-controls[^}]*flex-basis:\s*100%/);
});

test('sign-out icon sits immediately beside login icons, never under Pause',()=>{
  for(const route of ['index.html','asteroids.html']){
    const html=readFileSync(`${root}/${route}`,'utf8');
    const controls=html.match(/<div class="account-controls"[\s\S]*?<\/div>/)?.[0];
    assert.ok(controls);
    assert.ok(controls.indexOf('id="wallet-login"')<controls.indexOf('id="account-logout"'));
    assert.ok(controls.indexOf('id="account-logout"')<controls.indexOf('id="account-status"'));
    assert.match(controls,/<button id="account-logout"[^>]*aria-label="Sign out"[^>]*hidden><svg[^>]*aria-hidden="true"/);
  }
  const css=readFileSync(`${root}/assets/asteroids.css`,'utf8');
  assert.match(css,/#account-logout\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px/);
  const mobile=css.match(/@media \(max-width: 700px\) \{([\s\S]*?)\n\}/)?.[1];
  assert.match(mobile,/#account-logout\s*\{[^}]*grid-row:\s*1;[^}]*grid-column:\s*4;[^}]*justify-self:\s*start/);
  assert.match(mobile,/#pause\s*\{[^}]*order:\s*2/);
  const account=readFileSync(`${root}/assets/account-shell.mjs`,'utf8');
  assert.doesNotMatch(account,/logout\.textContent\s*=/);
});

test('mobile account header puts a wrapping name below the sign-in buttons',()=>{
  for(const route of ['index.html','asteroids.html']){
    const html=readFileSync(`${root}/${route}`,'utf8');
    const controls=html.match(/<div class="account-controls"[\s\S]*?<\/div>/)?.[0];
    assert.ok(controls);
    assert.ok(controls.indexOf('id="wallet-login"')<controls.indexOf('id="account-status"'));
  }
  const css=readFileSync(`${root}/assets/asteroids.css`,'utf8');
  assert.match(css,/\.account-status\s*\{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere/);
  const mobile=css.match(/@media \(max-width: 700px\) \{([\s\S]*?)\n\}/)?.[1];
  assert.match(mobile,/\.account-status\s*\{[^}]*grid-row:\s*2/);
  assert.doesNotMatch(css,/\.account-status[^}]*text-overflow:\s*ellipsis/);
});

test('Ethereum button opens the wallet chooser directly, without the explanatory wrapper',()=>{
  const account=readFileSync(`${root}/assets/account-shell.mjs`,'utf8');
  assert.match(account,/doc\.body\.append\(island\)/,'wallet island stays mounted outside the hidden fallback dialog');
  assert.match(account,/if\(embedded\(\)\)\{[^}]*show\(wallet\);return;\}/,'embedded players retain standalone guidance');
  assert.doesNotMatch(account,/heading\.textContent=embedded\(\).*?;show\(wallet\);/,'standalone selection must not open the wrapper');
  assert.match(account,/openOnMount:true/,'first click opens the wallet chooser');
  assert.doesNotMatch(account,/Optional login only\. Scores stay on this device\.|Wallet signatures prove control, not fair play\./);
});
