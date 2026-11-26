// Learn more: https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// Qur'an text editions ship as plain-text assets (not JS) so they don't bloat
// the JS bundle; they are read from disk only when the reader needs them.
config.resolver.assetExts.push('qtxt');

module.exports = config;
