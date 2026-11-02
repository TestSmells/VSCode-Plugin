/** A tsDetect smell and the VS Code setting used to enable its reporting. */
export interface SmellPreference {
  name: string;
  settingKey: string;
}

/** Every smell exposed as a checkbox in Test Smell Detector settings. */
export const SMELL_PREFERENCES: readonly SmellPreference[] = [
  { name: 'Assertion Roulette', settingKey: 'assertionRoulette' },
  { name: 'Conditional Test Logic', settingKey: 'conditionalTestLogic' },
  {
    name: 'Constructor Initialization',
    settingKey: 'constructorInitialization',
  },
  { name: 'Default Test', settingKey: 'defaultTest' },
  { name: 'Dependent Test', settingKey: 'dependentTest' },
  { name: 'Duplicate Assert', settingKey: 'duplicateAssert' },
  { name: 'Eager Test', settingKey: 'eagerTest' },
  { name: 'Empty Test', settingKey: 'emptyTest' },
  {
    name: 'Exception Catching Throwing',
    settingKey: 'exceptionCatchingThrowing',
  },
  { name: 'General Fixture', settingKey: 'generalFixture' },
  { name: 'Ignored Test', settingKey: 'ignoredTest' },
  { name: 'Lazy Test', settingKey: 'lazyTest' },
  { name: 'Magic Number Test', settingKey: 'magicNumberTest' },
  { name: 'Mystery Guest', settingKey: 'mysteryGuest' },
  { name: 'Redundant Assertion', settingKey: 'redundantAssertion' },
  { name: 'Redundant Print', settingKey: 'redundantPrint' },
  { name: 'Resource Optimism', settingKey: 'resourceOptimism' },
  { name: 'Sensitive Equality', settingKey: 'sensitiveEquality' },
  { name: 'Sleepy Test', settingKey: 'sleepyTest' },
  { name: 'Unknown Test', settingKey: 'unknownTest' },
  { name: 'Verbose Test', settingKey: 'verboseTest' },
];

const SETTING_KEYS_BY_SMELL = new Map(
  SMELL_PREFERENCES.map(({ name, settingKey }) => [name, settingKey]),
);

/** Return the setting key used to enable or disable a known smell. */
export function getSmellSettingKey(smellName: string): string | undefined {
  return SETTING_KEYS_BY_SMELL.get(smellName);
}

/** Whether a finding should be reported for the current settings. */
export function isSmellEnabled(
  smellName: string,
  readSetting: (settingKey: string) => boolean,
): boolean {
  const settingKey = getSmellSettingKey(smellName);

  // Preserve unfamiliar engine findings until a preference exists for them.
  return settingKey === undefined || readSetting(settingKey);
}
