import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack(config) {
    // Force all instances of @solana/wallet-adapter-react to resolve to the
    // same top-level copy. Prevents duplicate React context when packages
    // vendor their own nested copy (wallet-adapter-base-ui does this).
    config.resolve.alias['@solana/wallet-adapter-react'] = path.resolve(
      __dirname,
      'node_modules/@solana/wallet-adapter-react'
    );
    return config;
  },
};

export default nextConfig;
