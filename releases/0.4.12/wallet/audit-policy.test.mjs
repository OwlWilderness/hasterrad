import test from 'node:test';
import assert from 'node:assert/strict';
import {classify} from './audit-policy.mjs';
const report=(name,url)=>({vulnerabilities:{[name]:{nodes:[`node_modules/${name}`],via:[{url}]}}});
const zod='https://github.com/advisories/GHSA-mrhx-c7xc-m3w5';
test('known excluded Zod advisory is recorded, not hidden',()=>assert.equal(classify(report('zod',zod),['src/index.jsx'])[0].disposition,'not-emitted'));
test('fails if vulnerable input enters output',()=>assert.throws(()=>classify(report('zod',zod),['node_modules/zod/index.js']),/emitted/));
test('fails on new advisory even if not emitted',()=>assert.throws(()=>classify(report('zod','https://github.com/advisories/UNKNOWN'),[]),/Unreviewed/));
test('fails on malformed audit response',()=>assert.throws(()=>classify({},[]),/Invalid/));
