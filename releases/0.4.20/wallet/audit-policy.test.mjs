import test from 'node:test';
import assert from 'node:assert/strict';
import {classify} from './audit-policy.mjs';
const clean={metadata:{vulnerabilities:{total:0}},vulnerabilities:{}};
test('accepts a clean full audit',()=>assert.deepEqual(classify(clean,[]),[]));
test('rejects formerly excluded Zod even when not emitted',()=>assert.throws(()=>classify({metadata:{vulnerabilities:{total:1}},vulnerabilities:{zod:{nodes:['node_modules/zod'],via:[{url:'https://github.com/advisories/GHSA-mrhx-c7xc-m3w5'}]}}},[]),/Audit findings/));
test('rejects nonzero audit count even without entries',()=>assert.throws(()=>classify({...clean,metadata:{vulnerabilities:{total:1}}},[]),/Audit findings/));
test('rejects malformed audit response',()=>assert.throws(()=>classify({},[]),/Invalid/));
