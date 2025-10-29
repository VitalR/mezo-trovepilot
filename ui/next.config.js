/** @type {import('next').NextConfig} */
const nextConfig = {
    webpack: (config) => {
      config.resolve.alias['@react-native-async-storage/async-storage'] =
        require('path').resolve(__dirname, 'src/shims/empty.js');
      return config;
    },
  };
  module.exports = nextConfig;