const assert = require('node:assert/strict');
const { test } = require('node:test');

const packageJson = require('../package.json');
const {
  SMELL_PREFERENCES,
  isSmellEnabled,
} = require('../out/smellPreferences.js');

test('exposes one enabled-by-default checkbox for every supported smell', () => {
  const properties = packageJson.contributes.configuration.properties;
  const names = new Set();
  const settingKeys = new Set();

  assert.equal(SMELL_PREFERENCES.length, 21);
  for (const preference of SMELL_PREFERENCES) {
    assert.equal(names.has(preference.name), false);
    assert.equal(settingKeys.has(preference.settingKey), false);
    names.add(preference.name);
    settingKeys.add(preference.settingKey);

    const property =
      properties[`testSmellDetector.smells.${preference.settingKey}`];
    assert.ok(property, `Missing setting for ${preference.name}`);
    assert.equal(property.type, 'boolean');
    assert.equal(property.default, true);
  }

  const contributedSmellSettings = Object.keys(properties).filter((key) =>
    key.startsWith('testSmellDetector.smells.'),
  );
  assert.equal(contributedSmellSettings.length, SMELL_PREFERENCES.length);
});

test('does not report a known smell when its setting is disabled', () => {
  assert.equal(
    isSmellEnabled('Magic Number Test', (settingKey) => {
      assert.equal(settingKey, 'magicNumberTest');
      return false;
    }),
    false,
  );
});

test('reports a known smell when its setting is enabled', () => {
  assert.equal(isSmellEnabled('Magic Number Test', () => true), true);
});

test('continues reporting an unfamiliar engine smell', () => {
  assert.equal(
    isSmellEnabled('Future Smell', () => {
      throw new Error('Unknown smells must not read a nonexistent setting.');
    }),
    true,
  );
});
