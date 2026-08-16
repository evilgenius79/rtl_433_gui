'use strict';
// Unit tests for the settings -> rtl_433 argv translation.
// Run with: node --test gui/test/  (no dependencies needed)
const { test } = require('node:test');
const assert = require('node:assert');
const { buildArgs, freqToHz } = require('../main/rtl433.js');
const { DEFAULTS } = require('../main/settings.js');

function settingsWith(patch) {
  return { ...DEFAULTS, ...patch };
}

test('default settings produce json output on the default frequency', () => {
  const args = buildArgs(settingsWith({}));
  assert.deepStrictEqual(args.slice(-2), ['-F', 'json']);
  assert.ok(args.includes('-f'));
  assert.strictEqual(args[args.indexOf('-f') + 1], '433.92M');
  // level + protocol metadata on by default
  assert.ok(args.includes('level'));
  assert.ok(args.includes('protocol'));
  // no device/gain/sample-rate flags unless set
  assert.ok(!args.includes('-d'));
  assert.ok(!args.includes('-g'));
  assert.ok(!args.includes('-s'));
});

test('custom protocol mode enables only the selected decoders', () => {
  const args = buildArgs(settingsWith({ protocolMode: 'custom', enabledProtocols: [40, 73] }));
  const rIdx = args.reduce((acc, a, i) => (a === '-R' ? [...acc, args[i + 1]] : acc), []);
  assert.deepStrictEqual(rIdx, ['40', '73']);
});

test('default protocol mode disables decoders with negative numbers', () => {
  const args = buildArgs(settingsWith({ disabledProtocols: [8, 12] }));
  const rIdx = args.reduce((acc, a, i) => (a === '-R' ? [...acc, args[i + 1]] : acc), []);
  assert.deepStrictEqual(rIdx, ['-8', '-12']);
});

test('multiple frequencies add a hop interval', () => {
  const args = buildArgs(settingsWith({ frequencies: ['433.92M', '868.3M'], hopInterval: 300 }));
  assert.strictEqual(args.filter((a) => a === '-f').length, 2);
  assert.strictEqual(args[args.indexOf('-H') + 1], '300');
});

test('a single frequency adds no hop interval', () => {
  const args = buildArgs(settingsWith({ frequencies: ['868.3M'], hopInterval: 300 }));
  assert.ok(!args.includes('-H'));
});

test('extra arguments split on whitespace but keep quoted strings intact', () => {
  const args = buildArgs(settingsWith({ extraArgs: '-Y autolevel -X "n=door,m=OOK_PWM,s=400" -M noise' }));
  assert.ok(args.includes('autolevel'));
  assert.strictEqual(args[args.indexOf('-X') + 1], 'n=door,m=OOK_PWM,s=400');
  assert.ok(args.includes('noise'));
});

test('tuner options appear when configured', () => {
  const args = buildArgs(settingsWith({ device: ':10443', sampleRate: '1024k', gain: '28.0', ppmError: 12 }));
  assert.strictEqual(args[args.indexOf('-d') + 1], ':10443');
  assert.strictEqual(args[args.indexOf('-s') + 1], '1024k');
  assert.strictEqual(args[args.indexOf('-g') + 1], '28.0');
  assert.strictEqual(args[args.indexOf('-p') + 1], '12');
});

test('freqToHz parses rtl_433-style frequency strings', () => {
  assert.strictEqual(freqToHz('915M'), 915e6);
  assert.strictEqual(freqToHz('433.92M'), 433.92e6);
  assert.strictEqual(freqToHz('1024k'), 1024e3);
  assert.strictEqual(freqToHz('433920000'), 433920000);
  assert.ok(Number.isNaN(freqToHz('nonsense')));
});

test('tuning above 600 MHz with no explicit rate defaults to 1024k', () => {
  // rtl_433's 250k default cannot decode 868/915 MHz signals (verified by
  // replaying reference ERT captures) — the app must widen the window
  const a915 = buildArgs(settingsWith({ frequencies: ['915M'], sampleRate: '' }));
  assert.strictEqual(a915[a915.indexOf('-s') + 1], '1024k');
  const a868 = buildArgs(settingsWith({ frequencies: ['868.3M'], sampleRate: '' }));
  assert.strictEqual(a868[a868.indexOf('-s') + 1], '1024k');
  // hopping between a low and a high band also needs the wide window
  const hop = buildArgs(settingsWith({ frequencies: ['433.92M', '915M'], sampleRate: '' }));
  assert.strictEqual(hop[hop.indexOf('-s') + 1], '1024k');
});

test('low bands keep the rtl_433 default rate; explicit rates always win', () => {
  const low = buildArgs(settingsWith({ frequencies: ['315M'], sampleRate: '' }));
  assert.ok(!low.includes('-s'));
  const explicit = buildArgs(settingsWith({ frequencies: ['912.6M'], sampleRate: '2359k' }));
  assert.strictEqual(explicit[explicit.indexOf('-s') + 1], '2359k');
});

test('native units add no -C flag; si and customary do', () => {
  assert.ok(!buildArgs(settingsWith({ units: 'native' })).includes('-C'));
  const si = buildArgs(settingsWith({ units: 'si' }));
  assert.strictEqual(si[si.indexOf('-C') + 1], 'si');
  const cu = buildArgs(settingsWith({ units: 'customary' }));
  assert.strictEqual(cu[cu.indexOf('-C') + 1], 'customary');
});
