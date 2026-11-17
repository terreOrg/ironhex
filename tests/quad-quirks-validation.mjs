import assert from 'node:assert/strict';
import test from 'node:test';
import {construct, example} from '../dist/construction.js';

test('BMM quad optional quirks: reject explicit null without crashing', () => {
  for (const config of ['Biped', 'Quad']) {
    const result = construct({...structuredClone(example), config, quirks: null}, {auditQuad: config === 'Quad'});
    assert(result.errors.some(e => e.includes('особенностей')), config);
  }
});

test('BMM quad optional quirks: absent and empty objects remain compatible', () => {
  for (const config of ['Biped', 'Quad']) {
    const input = {...structuredClone(example), config};
    delete input.quirks;
    const absent = construct(input, {auditQuad: config === 'Quad'});
    const empty = construct({...input, quirks: {}}, {auditQuad: config === 'Quad'});
    assert.deepEqual(absent.errors, empty.errors);
  }
});

test('BMM quad optional quirks: malformed values reject safely', () => {
  for (const quirks of [false, 0, '', [], 'extendedTorsoTwist', {extendedTorsoTwist: 1}, {directionalTorsoMounts: {}}]) {
    const result = construct({...structuredClone(example), config: 'Quad', quirks}, {auditQuad: true});
    assert(result.errors.some(e => e.includes('особенностей')), JSON.stringify(quirks));
  }
});
