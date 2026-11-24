// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    rules: {
      // TypeScript already verifies namespace members; the plugin can't follow
      // expo-notifications' `export *` of enum modules and reports false positives.
      'import/namespace': 'off',
    },
  },
]);
